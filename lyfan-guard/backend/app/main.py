"""Servidor local de LyFan Guard (solo 127.0.0.1): chat con LyFan, detector de estafas y la interfaz web."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Literal

from contextlib import asynccontextmanager
from urllib.parse import quote

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import boveda, detector, llm, voz

BASE = Path(__file__).resolve().parents[1]          # lyfan-guard/backend
UI_DIR = BASE.parent / "ui"                          # lyfan-guard/ui
log = logging.getLogger("lyfan")


def _cargar_env() -> None:
    """Lee backend/.env (CLAVE=valor) sin depender de librerías externas."""
    archivo = BASE / ".env"
    if not archivo.exists():
        return
    for linea in archivo.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#") and "=" in linea:
            k, v = linea.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


_cargar_env()
HOST = "127.0.0.1"   # fijo: el servicio nunca se expone a la red
PUERTO = int(os.environ.get("LYFAN_PUERTO", "8765"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
MODELO = os.environ.get("LYFAN_MODELO", "qwen3.5:4b")

@asynccontextmanager
async def _vida(_app: FastAPI):
    if os.environ.get("LYFAN_STT_PRECARGA", "1") == "1":
        voz.precargar_transcriptor()      # el modelo de escucha se carga en segundo plano
    yield


app = FastAPI(title="LyFan Guard", version="0.2.0", lifespan=_vida)


class Mensaje(BaseModel):
    rol: Literal["usuario", "lyfan"]
    texto: str = Field(max_length=4000)


class ChatIn(BaseModel):
    mensaje: str = Field(min_length=1, max_length=4000)
    historial: list[Mensaje] = Field(default_factory=list, max_length=20)
    analizar: bool = False   # True = el usuario pidió expresamente revisar este texto


class AnalizarIn(BaseModel):
    texto: str = Field(min_length=1, max_length=6000)


class ConfigVozIn(BaseModel):
    elevenlabs_clave: str | None = Field(default=None, max_length=300)
    elevenlabs_voice_id: str | None = Field(default=None, max_length=60)
    elevenlabs_modelo: str | None = Field(default=None, max_length=60)
    borrar_clave: bool = False


class HablarIn(BaseModel):
    texto: str = Field(min_length=1, max_length=2000)
    proveedor: Literal["edge", "elevenlabs", "piper"] = "edge"
    voz: str = Field(default=voz.VOZ_RESPALDO, max_length=60)
    tono: int = Field(default=0, ge=-50, le=50)          # Hz, solo voces Edge
    velocidad: int = Field(default=0, ge=-50, le=50)     # %, solo voces Edge


def _error_voz(e: "voz.ErrorVoz") -> JSONResponse:
    return JSONResponse({"error": e.mensaje}, status_code=e.codigo)


@app.get("/api/voz/config")
async def voz_config():
    return voz.config_publica()


@app.post("/api/voz/config")
async def voz_config_guardar(c: ConfigVozIn):
    try:
        return voz.guardar_config(c.elevenlabs_clave, c.elevenlabs_voice_id, c.elevenlabs_modelo, c.borrar_clave)
    except voz.ErrorVoz as e:
        return _error_voz(e)


class DescargaPiperIn(BaseModel):
    id: str = Field(max_length=60)


@app.post("/api/voz/piper/descargar")
async def voz_piper_descargar(c: DescargaPiperIn):
    """Descarga una voz sin internet (una sola vez, ~60 a 115 MB)."""
    try:
        return {"voces_piper": await voz.descargar_piper(c.id)}
    except voz.ErrorVoz as e:
        return _error_voz(e)


@app.post("/api/voz/hablar")
async def voz_hablar(c: HablarIn):
    """Devuelve el audio (mp3). Cabeceras: X-Proveedor = quién habló; X-Aviso = por qué se cambió de voz."""
    try:
        audio, usado, aviso, mime = await voz.hablar(c.texto, c.proveedor, c.voz, c.tono, c.velocidad)
    except voz.ErrorVoz as e:
        return _error_voz(e)
    cab = {"X-Proveedor": usado, "Cache-Control": "no-store"}
    if aviso:
        cab["X-Aviso"] = quote(aviso)
    return Response(content=audio, media_type=mime, headers=cab)


@app.post("/api/voz/transcribir")
async def voz_transcribir(request: Request):
    """Recibe el audio grabado (cuerpo en bruto, p. ej. audio/webm) y devuelve {texto}."""
    datos = await request.body()
    if len(datos) > 10 * 1024 * 1024:
        return JSONResponse({"error": "El audio es demasiado largo."}, status_code=413)
    try:
        return await voz.transcribir(datos, request.headers.get("content-type", "audio/webm"))
    except voz.ErrorVoz as e:
        return _error_voz(e)


# ------------------------------------------------------------------ bóveda (archivos cifrados)
class ClaveIn(BaseModel):
    clave: str = Field(min_length=1, max_length=200)


class ArchivoIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=260)
    borrar_original: bool = True


def _error_boveda(e: "boveda.ErrorBoveda") -> JSONResponse:
    return JSONResponse({"error": e.mensaje}, status_code=e.codigo)


@app.get("/api/boveda")
async def boveda_estado():
    return boveda.estado()


@app.post("/api/boveda/crear")
async def boveda_crear(c: ClaveIn):
    try:
        return await asyncio.to_thread(boveda.crear, c.clave)
    except boveda.ErrorBoveda as e:
        return _error_boveda(e)


@app.post("/api/boveda/desbloquear")
async def boveda_desbloquear(c: ClaveIn):
    try:
        return await asyncio.to_thread(boveda.desbloquear, c.clave)
    except boveda.ErrorBoveda as e:
        return _error_boveda(e)


@app.post("/api/boveda/bloquear")
async def boveda_bloquear():
    return boveda.bloquear()


@app.post("/api/boveda/subir")
async def boveda_subir(request: Request, nombre: str):
    """Recibe un archivo arrastrado (cuerpo en bruto) y lo guarda en la carpeta de la bóveda. Máximo 500 MB."""
    try:
        ruta = boveda.reservar_destino(nombre)
    except boveda.ErrorBoveda as e:
        return _error_boveda(e)
    total = 0
    try:
        with open(ruta, "wb") as f:
            async for trozo in request.stream():
                total += len(trozo)
                if total > 500 * 1024 * 1024:
                    raise boveda.ErrorBoveda("El archivo supera los 500 MB.", 413)
                f.write(trozo)
    except boveda.ErrorBoveda as e:
        ruta.unlink(missing_ok=True)
        return _error_boveda(e)
    except Exception:  # noqa: BLE001
        ruta.unlink(missing_ok=True)
        return JSONResponse({"error": "No pude recibir el archivo."}, status_code=400)
    return {"nombre": ruta.name, **boveda.estado()}


@app.post("/api/boveda/cifrar")
async def boveda_cifrar(c: ArchivoIn):
    try:
        return {**await asyncio.to_thread(boveda.cifrar, c.nombre, c.borrar_original), **boveda.estado()}
    except boveda.ErrorBoveda as e:
        return _error_boveda(e)


class DescifrarIn(BaseModel):
    nombres: list[str] = Field(min_length=1, max_length=200)
    clave: str = Field(min_length=1, max_length=200)     # siempre se pide la contraseña para descifrar


@app.post("/api/boveda/descifrar")
async def boveda_descifrar(c: DescifrarIn):
    try:
        return {**await asyncio.to_thread(boveda.descifrar_con_clave, c.nombres, c.clave), **boveda.estado()}
    except boveda.ErrorBoveda as e:
        return _error_boveda(e)


@app.post("/api/boveda/analizar")
async def boveda_analizar(c: ArchivoIn):
    try:
        return await asyncio.to_thread(boveda.analizar, c.nombre)
    except boveda.ErrorBoveda as e:
        return _error_boveda(e)


@app.post("/api/boveda/leer")
async def boveda_leer(c: ArchivoIn):
    try:
        return await asyncio.to_thread(boveda.leer, c.nombre)
    except boveda.ErrorBoveda as e:
        return _error_boveda(e)


@app.post("/api/boveda/abrir-carpeta")
async def boveda_abrir_carpeta():
    await asyncio.to_thread(boveda.abrir_carpeta)
    return {"ok": True}


@app.get("/api/salud")
async def salud():
    return {"servicio": "LyFan Guard", "version": app.version, **await llm.salud(OLLAMA_URL, MODELO)}


@app.post("/api/analizar")
async def analizar(cuerpo: AnalizarIn):
    return detector.analizar(cuerpo.texto).a_dict()


def _linea(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False) + "\n"


@app.post("/api/chat")
async def chat(cuerpo: ChatIn):
    """Respuesta en streaming (una línea JSON por evento):
    {"tipo":"analisis","datos":{...}}  resultado del detector (si corresponde)
    {"tipo":"modo","valor":"modelo"|"plantilla"}
    {"tipo":"token","texto":"..."}     trozos de la respuesta
    {"tipo":"fin"}
    """
    async def generar():
        texto = cuerpo.mensaje.strip()
        resultado = None
        if cuerpo.analizar or detector.hay_senales(texto):
            resultado = detector.analizar(texto).a_dict()
            yield _linea({"tipo": "analisis", "datos": resultado})

        historial = [
            {"role": "user" if m.rol == "usuario" else "assistant", "content": m.texto}
            for m in cuerpo.historial[-6:]
        ]
        contenido = llm.mensaje_de_analisis(texto, resultado) if resultado else texto
        mensajes = historial + [{"role": "user", "content": contenido}]

        estado = await llm.salud(OLLAMA_URL, MODELO)
        if estado["ollama"] and estado["modelo_disponible"]:
            try:
                yield _linea({"tipo": "modo", "valor": "modelo"})
                hubo_texto = False
                async for trozo in llm.stream_chat(mensajes, OLLAMA_URL, MODELO):
                    hubo_texto = True
                    yield _linea({"tipo": "token", "texto": trozo})
                if hubo_texto:
                    yield _linea({"tipo": "fin"})
                    return
            except Exception as e:  # noqa: BLE001
                log.warning("Ollama falló, uso la plantilla: %s", type(e).__name__)

        # Respaldo: el MVP sigue funcionando aunque el modelo no esté disponible
        yield _linea({"tipo": "modo", "valor": "plantilla"})
        respuesta = (llm.respuesta_plantilla_analisis(resultado) if resultado
                     else llm.respuesta_plantilla_chat(estado))
        palabras = respuesta.split(" ")
        for i in range(0, len(palabras), 4):
            yield _linea({"tipo": "token", "texto": " ".join(palabras[i:i + 4]) + " "})
            await asyncio.sleep(0.03)
        yield _linea({"tipo": "fin"})

    return StreamingResponse(generar(), media_type="application/x-ndjson")


# La interfaz va al final para que /api/* tenga prioridad
if UI_DIR.exists():
    class EstaticosSinCache(StaticFiles):
        """La interfaz se revalida siempre: así los cambios aparecen al abrir LyFan, sin esperar a que caduque una caché."""
        def file_response(self, *args, **kwargs):
            resp = super().file_response(*args, **kwargs)
            resp.headers["Cache-Control"] = "no-cache"
            return resp

    app.mount("/", EstaticosSinCache(directory=str(UI_DIR), html=True), name="ui")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PUERTO, log_level="info")

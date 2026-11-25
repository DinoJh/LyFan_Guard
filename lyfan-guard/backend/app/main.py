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
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import antivirus, boveda, correo, cuarentena, detector, llm, navegador, voz

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
    if os.environ.get("LYFAN_LLM_PRECARGA", "1") == "1":
        asyncio.create_task(llm.precalentar(OLLAMA_URL, MODELO))   # carga el modelo de IA en memoria antes de la primera pregunta
    yield


app = FastAPI(title="LyFan Guard", version="0.2.0", lifespan=_vida)


@app.post("/api/liberar")
async def liberar_modelo():
    """La ventana de escritorio lo llama al salir: el modelo deja libre la memoria de video."""
    return {"liberado": await llm.liberar(OLLAMA_URL, MODELO)}


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
    emocion: Literal["neutro", "alegre", "curioso", "alerta", "calma"] = "neutro"   # voces sin internet (Piper)


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
        audio, usado, aviso, mime = await voz.hablar(c.texto, c.proveedor, c.voz, c.tono, c.velocidad, c.emocion)
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


class CambiarClaveIn(BaseModel):
    actual: str = Field(min_length=1, max_length=200)
    nueva: str = Field(min_length=1, max_length=200)


@app.post("/api/boveda/cambiar-clave")
async def boveda_cambiar_clave(c: CambiarClaveIn):
    try:
        return await asyncio.to_thread(boveda.cambiar_clave, c.actual, c.nueva)
    except boveda.ErrorBoveda as e:
        return _error_boveda(e)


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


# ------------------------------------------------------------------ antivirus y cuarentena
class EscanearIn(BaseModel):
    solo_nuevos: bool = False


class IdIn(BaseModel):
    id: str = Field(min_length=1, max_length=40)


def _error_cuarentena(e) -> JSONResponse:
    return JSONResponse({"error": e.mensaje}, status_code=e.codigo)


@app.post("/api/antivirus/escanear")
async def antivirus_escanear(c: EscanearIn):
    """Escanea la carpeta de la bóveda (solo lo nuevo o lo que cambió desde la última vez)."""
    return await asyncio.to_thread(antivirus.escanear, c.solo_nuevos)


@app.get("/api/cuarentena")
async def cuarentena_lista():
    return {"elementos": await asyncio.to_thread(cuarentena.listar)}


@app.post("/api/cuarentena/poner")
async def cuarentena_poner(c: ArchivoIn):
    try:
        return await asyncio.to_thread(cuarentena.poner, c.nombre)
    except boveda.ErrorBoveda as e:
        return _error_boveda(e)
    except cuarentena.ErrorCuarentena as e:
        return _error_cuarentena(e)


@app.post("/api/cuarentena/restaurar")
async def cuarentena_restaurar(c: IdIn):
    try:
        return await asyncio.to_thread(cuarentena.restaurar, c.id)
    except cuarentena.ErrorCuarentena as e:
        return _error_cuarentena(e)


@app.post("/api/cuarentena/eliminar")
async def cuarentena_eliminar(c: IdIn):
    try:
        return await asyncio.to_thread(cuarentena.eliminar, c.id)
    except cuarentena.ErrorCuarentena as e:
        return _error_cuarentena(e)


# ------------------------------------------------------------------ correo (Gmail, solo lectura)
class CredencialesIn(BaseModel):
    contenido: str = Field(min_length=10, max_length=20000)


class RevisarCorreoIn(BaseModel):
    cantidad: int = Field(default=15, ge=1, le=30)
    solo_nuevos: bool = False


def _error_correo(e) -> JSONResponse:
    return JSONResponse({"error": e.mensaje}, status_code=e.codigo)


@app.get("/api/correo")
async def correo_estado():
    return correo.estado()


@app.post("/api/correo/credenciales")
async def correo_credenciales(c: CredencialesIn):
    try:
        return correo.guardar_credenciales(c.contenido)
    except correo.ErrorCorreo as e:
        return _error_correo(e)


@app.post("/api/correo/conectar")
async def correo_conectar():
    """Abre en el navegador la página oficial de Google para dar permiso de solo lectura."""
    import webbrowser  # noqa: PLC0415
    try:
        url = correo.url_autorizacion(f"http://127.0.0.1:{PUERTO}/api/correo/oauth")
    except correo.ErrorCorreo as e:
        return _error_correo(e)
    webbrowser.open(url)
    return {"url": url}


_PAGINA_OAUTH = """<!doctype html><html lang="es"><meta charset="utf-8"><title>LyFan Guard</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0a1016;color:#e8eef3;font:16px Segoe UI,system-ui,sans-serif">
<div style="max-width:440px;padding:32px;border:1px solid #1f2d38;border-radius:18px;background:#0f171e;text-align:center">
<div style="font-size:42px">{icono}</div><h1 style="font-size:22px;margin:8px 0">{titulo}</h1><p style="color:#93a7b5">{texto}</p></div></body></html>"""


@app.get("/api/correo/oauth", response_class=HTMLResponse)
async def correo_oauth(code: str = "", state: str = "", error: str = ""):
    if error or not code:
        return HTMLResponse(_PAGINA_OAUTH.format(icono="✋", titulo="No se conectó", texto="No se dio el permiso. Puede cerrar esta pestaña e intentarlo otra vez desde LyFan."))
    try:
        est = await asyncio.to_thread(correo.completar, code, state)
    except correo.ErrorCorreo as e:
        return HTMLResponse(_PAGINA_OAUTH.format(icono="⚠️", titulo="No se pudo conectar", texto=e.mensaje), status_code=e.codigo)
    cuenta = est.get("cuenta") or "su cuenta"
    return HTMLResponse(_PAGINA_OAUTH.format(icono="🛡️", titulo="¡Listo! LyFan está conectado",
                                             texto=f"LyFan ya puede revisar los correos de {cuenta} con permiso de solo lectura. Puede cerrar esta pestaña."))


@app.post("/api/correo/revisar")
async def correo_revisar(c: RevisarCorreoIn):
    try:
        return await asyncio.to_thread(correo.revisar, c.cantidad, c.solo_nuevos)
    except correo.ErrorCorreo as e:
        return _error_correo(e)
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": "No pude conectarme con Gmail (¿hay internet?)."}, status_code=502)


@app.post("/api/correo/desconectar")
async def correo_desconectar():
    return await asyncio.to_thread(correo.desconectar)


# ------------------------------------------------------------------ ¿esta página es segura?
class PaginaIn(BaseModel):
    url: str | None = Field(default=None, max_length=4000)


@app.post("/api/navegador/revisar")
async def navegador_revisar(c: PaginaIn):
    """Sin url: lee la pestaña activa del navegador. Analiza el dominio y el código de la página (sin ejecutarlo)."""
    try:
        return await asyncio.to_thread(navegador.revisar, c.url)
    except navegador.ErrorNavegador as e:
        return JSONResponse({"error": e.mensaje}, status_code=e.codigo)


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

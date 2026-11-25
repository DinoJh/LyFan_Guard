"""Cuarentena de LyFan: aísla archivos sospechosos para que no puedan ejecutarse.

El archivo se saca de su carpeta y se guarda «neutralizado» (sus bytes se mezclan con una clave fija), así ni Windows
ni nadie puede abrirlo o ejecutarlo por accidente. Si fue una falsa alarma, se devuelve tal cual estaba a su carpeta
y su huella queda como permitida para no volver a marcarlo. También se puede eliminar para siempre.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import time
from pathlib import Path

from . import antivirus, boveda

_CLAVE = hashlib.sha256(b"lyfan-cuarentena-v1").digest()   # no es seguridad: solo deja el archivo inservible mientras está aislado


class ErrorCuarentena(Exception):
    def __init__(self, mensaje: str, codigo: int = 400):
        super().__init__(mensaje)
        self.mensaje, self.codigo = mensaje, codigo


def carpeta() -> Path:
    from .voz import DIR_DATOS  # noqa: PLC0415
    d = DIR_DATOS / "cuarentena"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _mezclar(datos: bytes) -> bytes:
    k = _CLAVE
    return bytes(b ^ k[i % len(k)] for i, b in enumerate(datos))


def _meta(id_: str) -> Path:
    return carpeta() / f"{id_}.json"


def _cuerpo(id_: str) -> Path:
    return carpeta() / f"{id_}.q"


def _id_valido(id_: str) -> str:
    if not isinstance(id_, str) or len(id_) != 12 or any(c not in "0123456789abcdef" for c in id_):
        raise ErrorCuarentena("Ese elemento no está en cuarentena.", 404)
    return id_


def poner(nombre: str) -> dict:
    """Aísla un archivo (sin cifrar) de la carpeta de la bóveda."""
    from .analisis_archivo import analizar_archivo  # noqa: PLC0415
    ruta = boveda._ruta_revisable(nombre)            # solo archivos de la bóveda, sin rutas raras
    if ruta.stat().st_size > 200 * 1024 * 1024:
        raise ErrorCuarentena("El archivo es demasiado grande para la cuarentena (más de 200 MB).")
    try:
        r = analizar_archivo(ruta)
        g = r.get("riesgo") or {}
    except Exception:  # noqa: BLE001
        g = {}
    datos = ruta.read_bytes()
    id_ = secrets.token_hex(6)
    meta = {
        "id": id_, "nombre": ruta.name, "origen": str(ruta.parent), "fecha": time.time(), "bytes": len(datos),
        "sha256": hashlib.sha256(datos).hexdigest(), "nivel": g.get("nivel", "desconocido"), "puntaje": g.get("puntaje", 0),
        "razones": (g.get("razones") or [])[:3], "deteccion": g.get("deteccion"),
    }
    cuerpo = _cuerpo(id_)
    cuerpo.write_bytes(_mezclar(datos))
    if _mezclar(cuerpo.read_bytes()) != datos:          # se verifica antes de quitar el original
        cuerpo.unlink(missing_ok=True)
        raise ErrorCuarentena("No pude aislar el archivo; lo dejé donde estaba.", 500)
    _meta(id_).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    ruta.unlink()
    return meta


def listar() -> list[dict]:
    salida = []
    for m in sorted(carpeta().glob("*.json")):
        try:
            d = json.loads(m.read_text(encoding="utf-8"))
            if _cuerpo(d["id"]).exists():
                salida.append(d)
        except Exception:  # noqa: BLE001
            continue
    return sorted(salida, key=lambda d: -d.get("fecha", 0))


def _cargar(id_: str) -> dict:
    m = _meta(_id_valido(id_))
    if not m.exists() or not _cuerpo(id_).exists():
        raise ErrorCuarentena("Ese elemento no está en cuarentena.", 404)
    return json.loads(m.read_text(encoding="utf-8"))


def restaurar(id_: str) -> dict:
    """Falsa alarma: lo devuelve a su carpeta y no se vuelve a marcar."""
    meta = _cargar(id_)
    destino_dir = Path(meta.get("origen") or boveda.DIR_BOVEDA)
    if not destino_dir.is_dir():
        destino_dir = boveda.DIR_BOVEDA
    destino = boveda._nombre_libre(destino_dir, boveda._limpiar_nombre(meta["nombre"]))
    datos = _mezclar(_cuerpo(id_).read_bytes())
    if hashlib.sha256(datos).hexdigest() != meta["sha256"]:
        raise ErrorCuarentena("El archivo en cuarentena está dañado; no lo devolví.", 500)
    temporal = destino.with_name("." + destino.name + ".tmp")
    temporal.write_bytes(datos)
    os.replace(temporal, destino)
    antivirus.permitir(meta["sha256"])
    _cuerpo(id_).unlink(missing_ok=True)
    _meta(id_).unlink(missing_ok=True)
    return {"restaurado": destino.name, "carpeta": str(destino_dir)}


def eliminar(id_: str) -> dict:
    meta = _cargar(id_)
    _cuerpo(id_).unlink(missing_ok=True)
    _meta(id_).unlink(missing_ok=True)
    return {"eliminado": meta["nombre"]}

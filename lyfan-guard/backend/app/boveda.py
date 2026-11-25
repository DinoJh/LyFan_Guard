"""Bóveda de LyFan: una carpeta donde los archivos se guardan cifrados (AES-256-GCM) con una contraseña maestra.

- La contraseña NUNCA se guarda: solo una sal y una «prueba» cifrada para saber si la contraseña es correcta.
- La clave derivada (scrypt) vive solo en memoria y se borra sola a los pocos minutos o al bloquear.
- Cada archivo cifrado (.lyfan) usa su propia sal y se cifra por bloques de 1 MiB autenticados (si alguien lo toca, no abre).
- El nombre original va cifrado dentro del archivo.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import struct
import threading
import time
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

DIR_BOVEDA = Path(os.environ.get("LYFAN_BOVEDA", Path.home() / "Documents" / "LyFan Bóveda"))
ARCHIVO_CONFIG = ".lyfan-boveda.json"
EXT = ".lyfan"
MAGIA = b"LYFANV1\x00"
BLOQUE = 1024 * 1024
MIN_CLAVE = 8
AUTOBLOQUEO_S = 10 * 60
MAX_ANALIZAR = 40_000          # caracteres de texto que se revisan al analizar
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2 ** 15, 8, 1
_PRUEBA = b"LYFAN-BOVEDA-OK"

_bloqueo = threading.RLock()
_clave: bytes | None = None
_expira = 0.0


class ErrorBoveda(Exception):
    def __init__(self, mensaje: str, codigo: int = 400):
        super().__init__(mensaje)
        self.mensaje, self.codigo = mensaje, codigo


# ------------------------------------------------------------------ clave y estado
def _derivar(clave: str, sal: bytes) -> bytes:
    return Scrypt(salt=sal, length=32, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P).derive(clave.encode("utf-8"))


def _ruta_config() -> Path:
    return DIR_BOVEDA / ARCHIVO_CONFIG


def existe() -> bool:
    return _ruta_config().exists()


def desbloqueada() -> bool:
    global _clave
    with _bloqueo:
        if _clave is not None and time.monotonic() > _expira:
            _clave = None
        return _clave is not None


def _requerir_clave() -> bytes:
    if not existe():
        raise ErrorBoveda("Aún no ha creado su bóveda.", 409)
    if not desbloqueada():
        raise ErrorBoveda("La bóveda está bloqueada. Ingrese su contraseña maestra.", 423)
    return _clave  # type: ignore[return-value]


def crear(clave: str) -> dict:
    if existe():
        raise ErrorBoveda("La bóveda ya existe.", 409)
    if len(clave) < MIN_CLAVE:
        raise ErrorBoveda(f"La contraseña debe tener al menos {MIN_CLAVE} caracteres.")
    DIR_BOVEDA.mkdir(parents=True, exist_ok=True)
    sal = secrets.token_bytes(16)
    maestra = _derivar(clave, sal)
    nonce = secrets.token_bytes(12)
    prueba = AESGCM(maestra).encrypt(nonce, _PRUEBA, b"prueba")
    _ruta_config().write_text(json.dumps({
        "version": 1, "kdf": "scrypt", "n": _SCRYPT_N, "r": _SCRYPT_R, "p": _SCRYPT_P,
        "sal": sal.hex(), "nonce": nonce.hex(), "prueba": prueba.hex(),
    }), encoding="utf-8")
    _fijar(maestra)
    return estado()


def _fijar(maestra: bytes) -> None:
    global _clave, _expira
    with _bloqueo:
        _clave = maestra
        _expira = time.monotonic() + AUTOBLOQUEO_S


def desbloquear(clave: str) -> dict:
    _fijar(_verificar(clave))
    return estado()


def _verificar(clave: str) -> bytes:
    """Comprueba la contraseña maestra y devuelve la clave derivada (o lanza 401)."""
    if not existe():
        raise ErrorBoveda("Aún no ha creado su bóveda.", 409)
    cfg = json.loads(_ruta_config().read_text(encoding="utf-8"))
    maestra = _derivar(clave, bytes.fromhex(cfg["sal"]))
    try:
        if AESGCM(maestra).decrypt(bytes.fromhex(cfg["nonce"]), bytes.fromhex(cfg["prueba"]), b"prueba") != _PRUEBA:
            raise InvalidTag()
    except InvalidTag:
        time.sleep(0.8)   # frena los intentos a lo bruto
        raise ErrorBoveda("Contraseña incorrecta.", 401) from None
    return maestra


def cambiar_clave(actual: str, nueva: str) -> dict:
    """Una sola contraseña protege toda la bóveda. Cambiarla vuelve a cifrar cada archivo con la nueva.
    Si algo falla a mitad de camino, no se cambia nada: los archivos y la contraseña anterior siguen valiendo."""
    vieja = _verificar(actual)
    if len(nueva) < MIN_CLAVE:
        raise ErrorBoveda(f"La nueva contraseña debe tener al menos {MIN_CLAVE} caracteres.")
    if nueva == actual:
        raise ErrorBoveda("La nueva contraseña debe ser distinta de la actual.")
    sal = secrets.token_bytes(16)
    maestra = _derivar(nueva, sal)
    archivos = sorted(p for p in DIR_BOVEDA.iterdir() if p.is_file() and p.suffix == EXT and not p.name.startswith("."))
    listos: list[tuple[Path, Path]] = []
    try:
        for ruta in archivos:
            nuevo = ruta.with_name("." + ruta.name + ".nuevo")
            listos.append((nuevo, ruta))
            plano = DIR_BOVEDA / ("." + secrets.token_hex(6) + ".tmp")
            try:
                with open(ruta, "rb") as ent, open(plano, "wb") as s:
                    original = _descifrar_flujo(ent, vieja, s.write)
                with open(plano, "rb") as ent, open(nuevo, "wb") as s:
                    _cifrar_flujo(ent, s, original, maestra)
                h = hashlib.sha256()
                with open(nuevo, "rb") as ent:
                    _descifrar_flujo(ent, maestra, h.update)
                if h.hexdigest() != _sha(plano):
                    raise ErrorBoveda(f"La verificación de {ruta.name} falló; no se cambió nada.", 500)
            finally:
                plano.unlink(missing_ok=True)
    except BaseException:
        for nuevo, _ in listos:
            nuevo.unlink(missing_ok=True)
        raise
    nonce = secrets.token_bytes(12)
    prueba = AESGCM(maestra).encrypt(nonce, _PRUEBA, b"prueba")
    cfg_tmp = DIR_BOVEDA / (ARCHIVO_CONFIG + ".tmp")
    cfg_tmp.write_text(json.dumps({
        "version": 1, "kdf": "scrypt", "n": _SCRYPT_N, "r": _SCRYPT_R, "p": _SCRYPT_P,
        "sal": sal.hex(), "nonce": nonce.hex(), "prueba": prueba.hex(),
    }), encoding="utf-8")
    os.replace(cfg_tmp, _ruta_config())
    for nuevo, ruta in listos:
        os.replace(nuevo, ruta)
    _fijar(maestra)
    return {**estado(), "recifrados": len(listos)}


def bloquear() -> dict:
    global _clave
    with _bloqueo:
        _clave = None
    return estado()


def estado() -> dict:
    return {
        "creada": existe(), "bloqueada": not desbloqueada(), "carpeta": str(DIR_BOVEDA),
        "autobloqueo_min": AUTOBLOQUEO_S // 60, "archivos": listar() if existe() else [],
        "bloquea_en_s": max(0, int(_expira - time.monotonic())) if desbloqueada() else 0,
    }


# ------------------------------------------------------------------ nombres seguros
_RE_NOMBRE = re.compile(r"^[^\\/:*?\"<>|\x00-\x1f]{1,200}$")


def _ruta_segura(nombre: str) -> Path:
    """Solo nombres simples dentro de la carpeta de la bóveda (nada de rutas, «..» ni nombres reservados)."""
    if not isinstance(nombre, str) or not _RE_NOMBRE.match(nombre) or nombre in {".", ".."} or nombre.startswith(ARCHIVO_CONFIG):
        raise ErrorBoveda("Nombre de archivo no válido.")
    ruta = (DIR_BOVEDA / nombre).resolve()
    if ruta.parent != DIR_BOVEDA.resolve():
        raise ErrorBoveda("Nombre de archivo no válido.")
    return ruta


def listar() -> list[dict]:
    if not DIR_BOVEDA.exists():
        return []
    salida = []
    for p in sorted(DIR_BOVEDA.iterdir(), key=lambda x: x.name.lower()):
        if p.is_file() and p.name != ARCHIVO_CONFIG and not p.name.startswith("."):
            salida.append({"nombre": p.name, "cifrado": p.suffix == EXT, "bytes": p.stat().st_size})
    return salida


def importar(origen: str) -> dict:
    """Copia a la bóveda un archivo de otro lugar (arrastrar y soltar). El original no se toca."""
    _requerir_clave_o_existe()
    src = Path(origen)
    if not src.is_file():
        raise ErrorBoveda("Ese archivo no existe o no es un archivo normal.")
    if src.resolve().parent == DIR_BOVEDA.resolve():
        return {"nombre": src.name}
    destino = _nombre_libre(DIR_BOVEDA, src.name)
    shutil.copy2(src, destino)
    return {"nombre": destino.name}


def reservar_destino(nombre: str) -> Path:
    """Nombre libre dentro de la bóveda para un archivo que llega (arrastrar y soltar)."""
    _requerir_clave_o_existe()
    limpio = Path(str(nombre).replace("\\", "/")).name
    if not _RE_NOMBRE.match(limpio) or limpio in {".", ".."} or limpio.startswith("."):
        raise ErrorBoveda("Nombre de archivo no válido.")
    return _nombre_libre(DIR_BOVEDA, limpio)


def _requerir_clave_o_existe() -> None:
    if not existe():
        raise ErrorBoveda("Aún no ha creado su bóveda.", 409)


def _nombre_libre(carpeta: Path, nombre: str) -> Path:
    ruta = carpeta / nombre
    n = 1
    while ruta.exists():
        ruta = carpeta / f"{Path(nombre).stem} ({n}){Path(nombre).suffix}"
        n += 1
    return ruta


# ------------------------------------------------------------------ cifrar / descifrar
def _clave_de_archivo(maestra: bytes, sal: bytes) -> bytes:
    return HKDF(algorithm=SHA256(), length=32, salt=sal, info=b"lyfan-archivo-v1").derive(maestra)


def _nonce(prefijo: bytes, n: int) -> bytes:
    return prefijo + struct.pack(">Q", n)


def _cifrar_flujo(ent, sal_f, nombre_original: str, maestra: bytes) -> None:
    sal = secrets.token_bytes(16)
    prefijo = secrets.token_bytes(4)
    cab = MAGIA + sal + prefijo
    aes = AESGCM(_clave_de_archivo(maestra, sal))
    nom = nombre_original.encode("utf-8")
    primero = struct.pack(">H", len(nom)) + nom
    sal_f.write(cab)
    actual = primero + ent.read(BLOQUE)
    n = 0
    while True:
        siguiente = ent.read(BLOQUE)
        final = not siguiente
        ct = aes.encrypt(_nonce(prefijo, n), actual, cab + (b"\x01" if final else b"\x00"))
        sal_f.write(struct.pack(">I", len(ct)) + ct)
        n += 1
        if final:
            return
        actual = siguiente


def _descifrar_flujo(ent, maestra: bytes, escribir) -> str:
    """Descifra y llama a escribir(bytes). Devuelve el nombre original. Lanza ErrorBoveda si algo no cuadra."""
    cab = ent.read(8 + 16 + 4)
    if len(cab) != 28 or cab[:8] != MAGIA:
        raise ErrorBoveda("Este archivo no es de la bóveda de LyFan.")
    sal, prefijo = cab[8:24], cab[24:28]
    aes = AESGCM(_clave_de_archivo(maestra, sal))
    n, nombre, resto = 0, None, b""
    while True:
        cab_len = ent.read(4)
        if len(cab_len) != 4:
            raise ErrorBoveda("El archivo cifrado está incompleto o dañado.")
        (largo,) = struct.unpack(">I", cab_len)
        if largo > BLOQUE + 2000:
            raise ErrorBoveda("El archivo cifrado está dañado.")
        ct = ent.read(largo)
        if len(ct) != largo:
            raise ErrorBoveda("El archivo cifrado está incompleto o dañado.")
        final = ent.read(1) == b""
        if not final:
            ent.seek(-1, 1)
        try:
            pt = aes.decrypt(_nonce(prefijo, n), ct, cab + (b"\x01" if final else b"\x00"))
        except InvalidTag:
            raise ErrorBoveda("No pude abrir el archivo: la contraseña no corresponde o el archivo fue alterado.", 422) from None
        if n == 0:
            (ln,) = struct.unpack(">H", pt[:2])
            nombre = pt[2:2 + ln].decode("utf-8", "replace")
            pt = pt[2 + ln:]
        if pt:
            escribir(pt)
        n += 1
        if final:
            return _limpiar_nombre(nombre or "archivo")


def _limpiar_nombre(n: str) -> str:
    n = Path(n.replace("\\", "/")).name
    return n if _RE_NOMBRE.match(n) and n not in {".", ".."} else "archivo"


def _sha(ruta: Path) -> str:
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for b in iter(lambda: f.read(BLOQUE), b""):
            h.update(b)
    return h.hexdigest()


def cifrar(nombre: str, borrar_original: bool = True) -> dict:
    maestra = _requerir_clave()
    ruta = _ruta_segura(nombre)
    if not ruta.is_file() or ruta.suffix == EXT:
        raise ErrorBoveda("Ese archivo no existe o ya está cifrado.")
    destino = _nombre_libre(DIR_BOVEDA, ruta.name + EXT)
    temporal = destino.with_name("." + destino.name + ".tmp")
    try:
        with open(ruta, "rb") as ent, open(temporal, "wb") as sal:
            _cifrar_flujo(ent, sal, ruta.name, maestra)
        # verificación: se descifra todo y se compara con el original antes de tocar nada
        h = hashlib.sha256()
        with open(temporal, "rb") as ent:
            _descifrar_flujo(ent, maestra, h.update)
        if h.hexdigest() != _sha(ruta):
            raise ErrorBoveda("La verificación del cifrado falló; no se tocó su archivo original.", 500)
        os.replace(temporal, destino)
    finally:
        if temporal.exists():
            temporal.unlink(missing_ok=True)
    if borrar_original:
        ruta.unlink()
    return {"cifrado": destino.name, "original_borrado": borrar_original}


def descifrar_con_clave(nombres: list[str], clave: str) -> dict:
    """Descifra pidiendo SIEMPRE la contraseña: se verifica una vez y recién entonces se abre cada archivo."""
    maestra = _verificar(clave)
    _fijar(maestra)
    hechos, fallos = [], []
    for nombre in nombres[:200]:
        try:
            hechos.append(descifrar(nombre)["descifrado"])
        except ErrorBoveda as e:
            fallos.append(f"{nombre}: {e.mensaje}")
    return {"descifrados": hechos, "fallos": fallos}


def descifrar(nombre: str, quitar_cifrado: bool = True) -> dict:
    maestra = _requerir_clave()
    ruta = _ruta_segura(nombre)
    if not ruta.is_file() or ruta.suffix != EXT:
        raise ErrorBoveda("Ese archivo no existe o no está cifrado.")
    temporal = DIR_BOVEDA / ("." + secrets.token_hex(6) + ".tmp")
    try:
        with open(ruta, "rb") as ent, open(temporal, "wb") as sal:
            original = _descifrar_flujo(ent, maestra, sal.write)
        destino = _nombre_libre(DIR_BOVEDA, original)
        os.replace(temporal, destino)
    finally:
        if temporal.exists():
            temporal.unlink(missing_ok=True)
    if quitar_cifrado:
        ruta.unlink()
    return {"descifrado": destino.name}


# ------------------------------------------------------------------ analizar (archivos sin cifrar)
_TEXTO_EXT = {".txt", ".md", ".csv", ".log", ".json", ".eml", ".html", ".htm", ".xml", ".ini", ".cfg"}
_RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_RE_TARJETA = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_RE_CLAVE = re.compile(r"(?i)\b(contraseñ?a|clave|password|passwd|pin|cvv|token|api[_ -]?key|secret)\b\s*[:=]\s*\S+")


def _luhn(num: str) -> bool:
    d = [int(c) for c in num][::-1]
    return (sum(d[0::2]) + sum(sum(divmod(x * 2, 10)) for x in d[1::2])) % 10 == 0


def datos_sensibles(texto: str) -> list[str]:
    hallazgos = []
    tarjetas = [m.group() for m in _RE_TARJETA.finditer(texto) if _luhn(re.sub(r"\D", "", m.group()))]
    if tarjetas:
        hallazgos.append(f"{len(tarjetas)} posible(s) número(s) de tarjeta")
    claves = _RE_CLAVE.findall(texto)
    if claves:
        hallazgos.append(f"{len(claves)} línea(s) que parecen contraseñas o claves")
    correos = set(_RE_EMAIL.findall(texto))
    if correos:
        hallazgos.append(f"{len(correos)} correo(s) electrónico(s)")
    return hallazgos


def _ruta_revisable(nombre: str) -> Path:
    ruta = _ruta_segura(nombre)
    if not ruta.is_file():
        raise ErrorBoveda("Ese archivo no existe.")
    if ruta.suffix == EXT:
        raise ErrorBoveda("Ese archivo está cifrado; descífrelo primero.")
    return ruta


def analizar(nombre: str) -> dict:
    """Revisa un archivo SIN cifrar (texto, scripts como .bat o .ps1, o por su nombre/huella). Todo en este equipo; no ejecuta nada."""
    from . import analisis_archivo  # noqa: PLC0415
    return analisis_archivo.analizar_archivo(_ruta_revisable(nombre))


def leer(nombre: str) -> dict:
    """Vista previa de un archivo de texto o script sin cifrar."""
    from . import analisis_archivo  # noqa: PLC0415
    return analisis_archivo.leer(_ruta_revisable(nombre))


def abrir_carpeta() -> None:
    """Abre la carpeta de la bóveda en el Explorador de Windows."""
    DIR_BOVEDA.mkdir(parents=True, exist_ok=True)
    if hasattr(os, "startfile"):
        os.startfile(str(DIR_BOVEDA))  # type: ignore[attr-defined]  # noqa: S606

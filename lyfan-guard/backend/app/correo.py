"""LyFan · Correo (Gmail, solo lectura).

Cómo funciona:
  1. La persona crea en su cuenta de Google Cloud unas credenciales de «app de escritorio» (credentials.json)
     y se las da a LyFan desde la ventana principal. Nunca por el chat.
  2. LyFan abre la página OFICIAL de Google para iniciar sesión (OAuth 2.0 con PKCE). LyFan nunca ve la contraseña.
     El único permiso que pide es gmail.readonly: puede LEER, pero no enviar, borrar ni mover correos.
  3. Google devuelve un permiso (token) que se guarda cifrado con la protección de Windows (DPAPI): solo esta cuenta
     de Windows puede descifrarlo.
  4. LyFan trae los correos recientes y los analiza EN ESTE EQUIPO con su detector de estafas: remitentes que se hacen
     pasar por bancos o instituciones, enlaces falsos, urgencia, pedidos de claves y adjuntos peligrosos.
"""
from __future__ import annotations

import base64
import hashlib
import html
import json
import re
import secrets
import sys
import time
import urllib.parse
from email.utils import parseaddr
from pathlib import Path

import httpx

from . import detector
from .marcas import MARCAS

ALCANCE = "https://www.googleapis.com/auth/gmail.readonly"
URL_AUTORIZAR = "https://accounts.google.com/o/oauth2/v2/auth"
URL_TOKEN = "https://oauth2.googleapis.com/token"
URL_REVOCAR = "https://oauth2.googleapis.com/revoke"
API = "https://gmail.googleapis.com/gmail/v1/users/me"
EXT_PELIGROSAS = {".exe", ".scr", ".bat", ".cmd", ".js", ".vbs", ".jse", ".hta", ".ps1", ".lnk", ".iso", ".img", ".jar", ".msi", ".com", ".pif"}
EXT_DUDOSAS = {".zip", ".rar", ".7z", ".html", ".htm", ".shtml", ".docm", ".xlsm", ".pptm"}


class ErrorCorreo(Exception):
    def __init__(self, mensaje: str, codigo: int = 400):
        super().__init__(mensaje)
        self.mensaje, self.codigo = mensaje, codigo


# ------------------------------------------------------------------ archivos locales
def carpeta() -> Path:
    from .voz import DIR_DATOS  # noqa: PLC0415
    d = DIR_DATOS / "gmail"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _ruta_credenciales() -> Path:
    return carpeta() / "credentials.json"


def _ruta_token() -> Path:
    return carpeta() / "token.bin"


def _ruta_vistos() -> Path:
    return carpeta() / "vistos.json"


# ---- protección del permiso con DPAPI (Windows); en otros sistemas se guarda tal cual con permisos de usuario
def _dpapi(datos: bytes, proteger: bool) -> bytes:
    if sys.platform != "win32":
        return datos
    import ctypes  # noqa: PLC0415
    from ctypes import wintypes  # noqa: PLC0415

    class BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(datos, len(datos))
    entrada, salida = BLOB(len(datos), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), BLOB()
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    fn = crypt32.CryptProtectData if proteger else crypt32.CryptUnprotectData
    ok = fn(ctypes.byref(entrada), None, None, None, None, 0x1, ctypes.byref(salida))   # 0x1 = sin ventanas
    if not ok:
        raise ErrorCorreo("No pude proteger o leer el permiso de Gmail en este equipo.", 500)
    try:
        return ctypes.string_at(salida.pbData, salida.cbData)
    finally:
        kernel32.LocalFree(salida.pbData)


def _guardar_token(tok: dict) -> None:
    _ruta_token().write_bytes(_dpapi(json.dumps(tok).encode("utf-8"), True))


def _leer_token() -> dict | None:
    try:
        return json.loads(_dpapi(_ruta_token().read_bytes(), False).decode("utf-8"))
    except FileNotFoundError:
        return None
    except Exception:  # noqa: BLE001 - token dañado o de otra cuenta de Windows
        return None


# ------------------------------------------------------------------ credenciales (credentials.json)
def guardar_credenciales(contenido: str) -> dict:
    try:
        d = json.loads(contenido)
    except Exception:  # noqa: BLE001
        raise ErrorCorreo("Ese archivo no es un credentials.json válido.") from None
    app = d.get("installed")
    if not app:
        if d.get("web"):
            raise ErrorCorreo("Esas credenciales son de tipo «Aplicación web». Cree unas de tipo «App de escritorio».")
        raise ErrorCorreo("Ese archivo no es un credentials.json de Google.")
    if not app.get("client_id", "").endswith(".apps.googleusercontent.com") or not app.get("client_secret"):
        raise ErrorCorreo("Al archivo le falta el ID o el secreto de cliente.")
    _ruta_credenciales().write_text(json.dumps({"installed": {"client_id": app["client_id"], "client_secret": app["client_secret"]}}), encoding="utf-8")
    return estado()


def _cliente() -> tuple[str, str]:
    try:
        app = json.loads(_ruta_credenciales().read_text(encoding="utf-8"))["installed"]
        return app["client_id"], app["client_secret"]
    except Exception:  # noqa: BLE001
        raise ErrorCorreo("Primero cargue el archivo credentials.json de Google.", 409) from None


def estado() -> dict:
    tok = _leer_token()
    return {"credenciales": _ruta_credenciales().exists(), "conectado": bool(tok and tok.get("refresh_token")),
            "cuenta": (tok or {}).get("cuenta"), "permiso": "solo lectura"}


# ------------------------------------------------------------------ inicio de sesión con Google (OAuth 2.0 + PKCE)
_pendientes: dict[str, dict] = {}   # state -> {verificador, redirect, creado}


def url_autorizacion(redirect_uri: str) -> str:
    client_id, _ = _cliente()
    verificador = secrets.token_urlsafe(64)
    reto = base64.urlsafe_b64encode(hashlib.sha256(verificador.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)
    _pendientes.clear()                                   # un solo inicio de sesión a la vez
    _pendientes[state] = {"verificador": verificador, "redirect": redirect_uri, "creado": time.time()}
    q = {
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code", "scope": ALCANCE,
        "state": state, "code_challenge": reto, "code_challenge_method": "S256",
        "access_type": "offline", "prompt": "consent",
    }
    return URL_AUTORIZAR + "?" + urllib.parse.urlencode(q)


def completar(code: str, state: str) -> dict:
    p = _pendientes.pop(state, None)
    if not p or time.time() - p["creado"] > 600:
        raise ErrorCorreo("El inicio de sesión venció o no lo pidió LyFan. Vuelva a intentarlo desde la ventana principal.")
    client_id, secreto = _cliente()
    r = httpx.post(URL_TOKEN, data={
        "code": code, "client_id": client_id, "client_secret": secreto, "redirect_uri": p["redirect"],
        "grant_type": "authorization_code", "code_verifier": p["verificador"],
    }, timeout=20)
    if r.status_code != 200:
        raise ErrorCorreo("Google no aceptó el inicio de sesión.", 502)
    t = r.json()
    if ALCANCE not in t.get("scope", ""):
        raise ErrorCorreo("No se dio permiso para leer el correo.", 403)
    tok = {"refresh_token": t.get("refresh_token"), "access_token": t.get("access_token"), "expira": time.time() + int(t.get("expires_in", 3000)) - 60}
    if not tok["refresh_token"]:
        raise ErrorCorreo("Google no entregó un permiso permanente. Quite el acceso de LyFan en su cuenta Google y vuelva a conectar.", 502)
    try:
        perfil = httpx.get(API + "/profile", headers={"Authorization": f"Bearer {tok['access_token']}"}, timeout=15).json()
        tok["cuenta"] = perfil.get("emailAddress")
    except Exception:  # noqa: BLE001
        tok["cuenta"] = None
    _guardar_token(tok)
    return estado()


def _acceso() -> str:
    tok = _leer_token()
    if not tok or not tok.get("refresh_token"):
        raise ErrorCorreo("Gmail no está conectado.", 409)
    if tok.get("access_token") and tok.get("expira", 0) > time.time():
        return tok["access_token"]
    client_id, secreto = _cliente()
    r = httpx.post(URL_TOKEN, data={"client_id": client_id, "client_secret": secreto, "refresh_token": tok["refresh_token"],
                                    "grant_type": "refresh_token"}, timeout=20)
    if r.status_code != 200:
        raise ErrorCorreo("El permiso de Gmail venció o se quitó. Vuelva a conectar su cuenta.", 401)
    t = r.json()
    tok["access_token"], tok["expira"] = t["access_token"], time.time() + int(t.get("expires_in", 3000)) - 60
    _guardar_token(tok)
    return tok["access_token"]


def desconectar() -> dict:
    tok = _leer_token()
    if tok and tok.get("refresh_token"):
        try:
            httpx.post(URL_REVOCAR, data={"token": tok["refresh_token"]}, timeout=10)   # Google también olvida el permiso
        except Exception:  # noqa: BLE001
            pass
    for p in (_ruta_token(), _ruta_vistos()):
        p.unlink(missing_ok=True)
    return estado()


# ------------------------------------------------------------------ leer y analizar correos
def _b64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _texto_html(h: str) -> str:
    h = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", h)
    h = re.sub(r'(?i)<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>', r" \1 ", h)    # los enlaces reales, no solo su texto
    h = re.sub(r"(?s)<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", html.unescape(h)).strip()


def _partes(payload: dict, salida: dict) -> None:
    mime = payload.get("mimeType", "")
    nombre = payload.get("filename") or ""
    if nombre:
        salida["adjuntos"].append(nombre)
    datos = (payload.get("body") or {}).get("data")
    if datos and not nombre:
        try:
            t = _b64(datos).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            t = ""
        if mime == "text/plain":
            salida["texto"] += t + "\n"
        elif mime == "text/html":
            salida["html"] += _texto_html(t) + "\n"
    for p in payload.get("parts") or []:
        _partes(p, salida)


def leer_mensaje(m: dict) -> dict:
    """Mensaje de la API de Gmail -> datos simples (remitente, asunto, texto, adjuntos)."""
    cab = {h["name"].lower(): h["value"] for h in (m.get("payload") or {}).get("headers", [])}
    nombre, correo = parseaddr(cab.get("from", ""))
    partes = {"texto": "", "html": "", "adjuntos": []}
    _partes(m.get("payload") or {}, partes)
    cuerpo = partes["texto"].strip() or partes["html"].strip() or m.get("snippet", "")
    if partes["texto"].strip() and partes["html"].strip():
        cuerpo += "\n" + " ".join(detector.extraer_urls(partes["html"]))       # enlaces que solo están en la versión HTML
    return {"id": m.get("id"), "de_nombre": nombre, "de_correo": correo.lower(), "asunto": cab.get("subject", "(sin asunto)"),
            "fecha": int(m.get("internalDate", "0")) // 1000, "texto": cuerpo[:20000], "adjuntos": partes["adjuntos"][:10],
            "spf_falla": "spf=fail" in cab.get("authentication-results", "").lower() or "dmarc=fail" in cab.get("authentication-results", "").lower()}


def _dominio(correo: str) -> str:
    return correo.rsplit("@", 1)[-1] if "@" in correo else ""


def analizar_correo(c: dict) -> dict:
    """Analiza un correo en este equipo y devuelve nivel, puntaje y razones."""
    texto = f"{c['asunto']}\n{c['texto']}"
    base = detector.analizar(texto[:6000])
    puntos, razones = base.puntaje, list(base.razones)
    dom = _dominio(c["de_correo"])
    reg = detector.dominio_registrable(dom) if dom else ""
    # ¿dice ser de una marca pero escribe desde otro dominio?
    quien = detector.normalizar(f"{c['de_nombre']} {c['asunto']}")
    for marca, datos in MARCAS.items():
        if any(re.search(rf"\b{re.escape(a)}\b", quien) for a in datos["alias"] if len(a) > 3 or a in ("bcp", "bbva")):
            oficial = any(reg == d or dom.endswith("." + d) or dom == d for d in datos["dominios"])
            if not oficial:
                puntos += 40
                razones.insert(0, f"Dice ser de {marca}, pero lo envía {c['de_correo'] or 'un remitente desconocido'}, que no es un correo oficial")
            break
    if c.get("spf_falla"):
        puntos += 25; razones.append("Gmail no pudo comprobar que el remitente sea quien dice ser")
    for a in c["adjuntos"]:
        ext = Path(a.lower()).suffix
        if ext in EXT_PELIGROSAS or re.search(r"(?i)\.(pdf|docx?|xlsx?|jpe?g|png)\.[a-z0-9]{2,4}$", a):
            puntos += 50; razones.append(f"Trae un adjunto peligroso: {a}")
        elif ext in EXT_DUDOSAS:
            puntos += 20; razones.append(f"Trae un adjunto que conviene revisar antes de abrir: {a}")
    puntos = min(100, puntos)
    nivel = detector.nivel_de(puntos)
    accion = {"peligro": "No abra sus enlaces ni adjuntos, no responda y márquelo como phishing en Gmail.",
              "alerta": "Desconfíe: verifique con la empresa por su canal oficial antes de hacer clic o responder.",
              "tranquilo": "No veo señales de estafa."}[nivel]
    return {"id": c["id"], "de": c["de_nombre"] or c["de_correo"], "de_correo": c["de_correo"], "asunto": c["asunto"], "fecha": c["fecha"],
            "adjuntos": c["adjuntos"], "nivel": nivel, "puntaje": puntos, "razones": razones[:5], "accion": accion}


def revisar(cantidad: int = 15, solo_nuevos: bool = False) -> dict:
    """Trae los correos más recientes de la bandeja de entrada y los analiza."""
    tk = _acceso()
    cab = {"Authorization": f"Bearer {tk}"}
    cantidad = max(1, min(30, cantidad))
    with httpx.Client(timeout=20, headers=cab) as http:
        r = http.get(API + "/messages", params={"maxResults": cantidad, "q": "in:inbox newer_than:14d"})
        if r.status_code == 401:
            raise ErrorCorreo("El permiso de Gmail venció. Vuelva a conectar su cuenta.", 401)
        r.raise_for_status()
        ids = [m["id"] for m in r.json().get("messages", [])]
        try:
            vistos = set(json.loads(_ruta_vistos().read_text(encoding="utf-8")))
        except Exception:  # noqa: BLE001
            vistos = set()
        correos = []
        for i in ids:
            m = http.get(API + f"/messages/{i}", params={"format": "full"})
            if m.status_code == 200:
                correos.append(analizar_correo(leer_mensaje(m.json())))
    nuevos = [c for c in correos if c["id"] not in vistos and c["nivel"] != "tranquilo"]
    _ruta_vistos().write_text(json.dumps(sorted(vistos | {c["id"] for c in correos})[-500:]), encoding="utf-8")
    sospechosos = [c for c in correos if c["nivel"] != "tranquilo"]
    return {"cuenta": (_leer_token() or {}).get("cuenta"), "revisados": len(correos), "correos": correos,
            "sospechosos": sospechosos, "nuevos": nuevos if solo_nuevos else sospechosos}

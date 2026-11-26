"""LyFan · ¿Esta página es segura?

1. Lee la dirección de la pestaña activa del navegador (Chrome, Edge, Brave, Opera, Vivaldi o Firefox) con las funciones
   de accesibilidad de Windows (UI Automation). No toca el teclado ni el portapapeles.
2. Revisa el dominio con el detector de enlaces (marcas suplantadas, letras engañosas, acortadores, terminaciones raras).
3. Descarga el código de la página SIN ejecutarlo y busca señales de phishing: formularios que piden claves, tarjeta o
   códigos; la página dice ser de un banco pero está en otro dominio; formularios que envían los datos a otro sitio;
   hospedajes gratuitos y código ofuscado.
"""
from __future__ import annotations

import ctypes
import ipaddress
import re
import socket
import sys
import urllib.parse
from html import unescape

import httpx

from . import detector
from .marcas import MARCAS

NAVEGADORES = {"chrome.exe": "Chrome", "msedge.exe": "Edge", "brave.exe": "Brave", "opera.exe": "Opera",
               "vivaldi.exe": "Vivaldi", "firefox.exe": "Firefox", "chromium.exe": "Chromium"}
HOSPEDAJE_GRATIS = ("000webhostapp.com", "weebly.com", "wixsite.com", "github.io", "netlify.app", "vercel.app", "pages.dev",
                    "glitch.me", "blogspot.com", "firebaseapp.com", "web.app", "herokuapp.com", "repl.co", "ngrok.io",
                    "ngrok-free.app", "trycloudflare.com", "sites.google.com", "forms.gle", "docs.google.com/forms",
                    "webflow.io", "square.site", "godaddysites.com", "carrd.co", "ipfs.io")
MAX_HTML = 1_500_000
# Marcas que suelen copiar los kits de phishing. Solo se miran en el título de la página (no en el texto),
# porque muchas páginas legítimas dicen «Iniciar sesión con Google».
GLOBALES = {
    "Facebook": ["facebook.com", "fb.com", "messenger.com"], "Instagram": ["instagram.com"], "Google": ["google.com", "google.com.pe", "youtube.com"],
    "Gmail": ["google.com"], "Microsoft": ["microsoft.com", "live.com", "office.com", "microsoftonline.com", "outlook.com"],
    "Outlook": ["outlook.com", "live.com", "office.com"], "Netflix": ["netflix.com"], "PayPal": ["paypal.com"], "Apple": ["apple.com", "icloud.com"],
    "TikTok": ["tiktok.com"], "Twitter": ["twitter.com", "x.com"], "WhatsApp": ["whatsapp.com"], "LinkedIn": ["linkedin.com"],
    "Steam": ["steampowered.com", "steamcommunity.com"], "Discord": ["discord.com"], "Spotify": ["spotify.com"], "Amazon": ["amazon.com"],
    "Roblox": ["roblox.com"], "Free Fire": ["ff.garena.com", "garena.com"], "Snapchat": ["snapchat.com"], "Twitch": ["twitch.tv"],
}


class ErrorNavegador(Exception):
    def __init__(self, mensaje: str, codigo: int = 400):
        super().__init__(mensaje)
        self.mensaje, self.codigo = mensaje, codigo


# ------------------------------------------------------------------ 1. leer la pestaña activa
def _proceso_de(hwnd: int) -> str:
    pid = ctypes.c_ulong()
    ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid.value)      # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(520)
        n = ctypes.c_ulong(520)
        if ctypes.windll.kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
            return buf.value.rsplit("\\", 1)[-1].lower()
        return ""
    finally:
        ctypes.windll.kernel32.CloseHandle(h)


def _ventanas_de_navegador() -> list[tuple[int, str, str]]:
    """Ventanas visibles de navegadores, de la más al frente a la más atrás: (hwnd, navegador, título)."""
    user32 = ctypes.windll.user32
    salida: list[tuple[int, str, str]] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def cada(hwnd, _):
        if not user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd):
            return True
        largo = user32.GetWindowTextLengthW(hwnd)
        if largo == 0:
            return True
        proc = _proceso_de(hwnd)
        if proc in NAVEGADORES:
            t = ctypes.create_unicode_buffer(largo + 1)
            user32.GetWindowTextW(hwnd, t, largo + 1)
            salida.append((hwnd, NAVEGADORES[proc], t.value))
        return True

    user32.EnumWindows(cada, 0)          # EnumWindows recorre en orden de primer plano
    return salida


def _parece_direccion(v: str) -> bool:
    v = v.strip()
    return bool(v) and " " not in v and ("." in v or v.startswith(("http://", "https://", "localhost"))) and len(v) < 4000


def _direccion_de(hwnd: int) -> str | None:
    import uiautomation as auto  # noqa: PLC0415
    ventana = auto.ControlFromHandle(hwnd)
    if not ventana:
        return None
    candidatos = []
    for control, _prof in auto.WalkControl(ventana, maxDepth=14):
        if control.ControlTypeName != "EditControl":
            continue
        nombre, aid = (control.Name or "").lower(), (control.AutomationId or "").lower()
        try:
            valor = control.GetValuePattern().Value
        except Exception:  # noqa: BLE001
            continue
        if not _parece_direccion(valor or ""):
            continue
        if "urlbar" in aid or "address" in nombre or "direcci" in nombre or "url" in nombre:
            return valor.strip()
        candidatos.append(valor.strip())
        if len(candidatos) > 3:
            break
    return candidatos[0] if candidatos else None


def pestana_activa() -> dict:
    if sys.platform != "win32":
        raise ErrorNavegador("Por ahora solo puedo leer el navegador en Windows.", 501)
    ventanas = _ventanas_de_navegador()
    if not ventanas:
        raise ErrorNavegador("No encuentro un navegador abierto. Abra la página y vuelva a preguntarme.", 404)
    import uiautomation as auto  # noqa: PLC0415
    with auto.UIAutomationInitializerInThread():
        for hwnd, nav, titulo in ventanas[:4]:
            try:
                url = _direccion_de(hwnd)
            except Exception:  # noqa: BLE001
                url = None
            if url:
                if not re.match(r"^[a-z][a-z0-9+.-]*://", url, re.I):
                    url = "https://" + url
                titulo = re.sub(r"\s+[-–—]\s+(Google Chrome|Microsoft​? Edge|Brave|Opera|Vivaldi|Mozilla Firefox|Chromium).*$", "", titulo)
                return {"url": url, "titulo": titulo, "navegador": nav}
    raise ErrorNavegador("Veo su navegador, pero no pude leer la dirección de la página.", 404)


# ------------------------------------------------------------------ 2 y 3. analizar
def _host_privado(host: str) -> bool:
    try:
        for info in socket.getaddrinfo(host, None)[:4]:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return True
    except Exception:  # noqa: BLE001
        return True
    return False


def _descargar(url: str) -> tuple[str, str] | None:
    """(html, url_final) sin ejecutar nada. None si no se pudo."""
    host = urllib.parse.urlsplit(url).hostname or ""
    if not host or _host_privado(host):
        return None
    cab = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
           "Accept-Language": "es-PE,es;q=0.9"}
    try:
        with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(6.0, connect=4.0), headers=cab, max_redirects=6) as http:
            with http.stream("GET", url) as r:
                if "html" not in r.headers.get("content-type", "html"):
                    return None
                trozos, total = [], 0
                for t in r.iter_bytes():
                    trozos.append(t); total += len(t)
                    if total > MAX_HTML:
                        break
                return b"".join(trozos).decode(r.encoding or "utf-8", "replace"), str(r.url)
    except Exception:  # noqa: BLE001
        return None


def _marca_oficial(marca: str, host: str) -> bool:
    reg = detector.dominio_registrable(host)
    return any(reg == d or host == d or host.endswith("." + d) for d in MARCAS[marca]["dominios"])


def analizar_contenido(html: str, url: str, oficial: bool = False) -> tuple[int, list[str]]:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    puntos, razones = 0, []
    h = html.lower()
    titulo = unescape(re.search(r"(?is)<title[^>]*>(.*?)</title>", html).group(1)).strip() if re.search(r"(?is)<title[^>]*>(.*?)</title>", html) else ""
    texto = detector.normalizar(re.sub(r"(?s)<[^>]+>", " ", re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html))[:60000] + " " + titulo)
    pide_clave = bool(re.search(r"<input[^>]+type=[\"']?password", h))
    pide_tarjeta = bool(re.search(r"(?:name|id|autocomplete|placeholder)=[\"'][^\"']*(?:cc-number|card|tarjeta|cvv|cvc|expir|vencimiento)", h))
    pide_codigo = bool(re.search(r"(?:name|id|placeholder)=[\"'][^\"']*(?:otp|token|codigo|código|sms|pin\b|clave dinamica|clave dinámica)", h))
    # ¿la página dice ser de una marca que no es la del dominio?
    for marca, datos in MARCAS.items():
        alias = [a for a in datos["alias"] if a not in ("claro",)]
        if any(re.search(rf"\b{re.escape(a)}\b", texto) for a in alias) and not _marca_oficial(marca, host):
            if pide_clave or pide_tarjeta or pide_codigo:
                puntos += 55; razones.append(f"Se presenta como {marca}, pero no está en un dominio oficial de {marca} y le pide datos")
            else:
                puntos += 15; razones.append(f"Menciona a {marca}, pero no es una página oficial de {marca}")
            break
    # marcas internacionales copiadas (kits como Zphisher): se mira solo el título
    tnorm = detector.normalizar(titulo)
    for marca, dominios in GLOBALES.items():
        if re.search(rf"\b{re.escape(detector.normalizar(marca))}\b", tnorm):
            reg = detector.dominio_registrable(host)
            if not any(reg == d or host == d or host.endswith("." + d) for d in dominios):
                puntos += 55 if (pide_clave or pide_codigo) else 25
                razones.insert(0, f"Imita la página de {marca}, pero no está en un dominio de {marca}")
            break
    if pide_clave and not oficial:         # en un sitio oficial, pedir la clave es normal
        puntos += 10; razones.append("Tiene un formulario que pide contraseña")
    if pide_tarjeta and not oficial:
        puntos += 20; razones.append("Pide datos de tarjeta")
    if pide_codigo and not oficial:
        puntos += 15; razones.append("Pide un código o token de verificación")
    # formularios que envían los datos a otro sitio
    for accion in re.findall(r"(?is)<form[^>]+action=[\"']([^\"']+)", html)[:10]:
        destino = (urllib.parse.urlsplit(urllib.parse.urljoin(url, accion)).hostname or "").lower()
        if destino and detector.dominio_registrable(destino) != detector.dominio_registrable(host):
            puntos += 25; razones.append(f"El formulario envía sus datos a otro sitio ({destino})"); break
        if accion.strip().lower().startswith(("mailto:", "http://")) and (pide_clave or pide_tarjeta):
            puntos += 20; razones.append("El formulario envía sus datos sin protección"); break
    if re.search(r"eval\s*\(\s*(?:atob|unescape|decodeURIComponent)\s*\(|document\.write\s*\(\s*unescape", h):
        puntos += 15; razones.append("Tiene código escondido (ofuscado)")
    if re.search(r"(?:telegram\.org/bot|api\.telegram|discord(?:app)?\.com/api/webhooks)", h):
        puntos += 35; razones.append("Envía datos a Telegram o Discord, típico de páginas que roban claves")
    if pide_clave and url.startswith("http://"):
        puntos += 20; razones.append("Pide contraseña en una página sin conexión segura (sin https)")
    return puntos, razones


def revisar(url: str | None = None, titulo: str = "", navegador: str = "") -> dict:
    if not url:
        p = pestana_activa()
        url, titulo, navegador = p["url"], p["titulo"], p["navegador"]
    if not re.match(r"^https?://", url, re.I):
        return {"url": url, "titulo": titulo, "navegador": navegador, "nivel": "tranquilo", "puntaje": 0,
                "razones": ["Es una página interna del navegador, no de internet"], "accion": "No hay nada que revisar aquí.", "dominio": ""}
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    r = detector.analizar_url(url)
    puntos, razones = r.puntaje, list(r.razones)
    if any(f in url.lower() for f in HOSPEDAJE_GRATIS):
        puntos += 15; razones.append("Está en un hospedaje gratuito, donde cualquiera puede crear una página")
    descargada = _descargar(url)
    revisado_contenido = descargada is not None
    if descargada:
        html, final = descargada
        fh = (urllib.parse.urlsplit(final).hostname or "").lower()
        if fh and detector.dominio_registrable(fh) != detector.dominio_registrable(host):
            rf = detector.analizar_url(final)
            puntos += max(10, rf.puntaje // 2); razones.append(f"Lo redirige a otro sitio ({fh})")
        p2, r2 = analizar_contenido(html, final, oficial=bool(r.oficial_de) and detector.dominio_registrable(fh or host) == detector.dominio_registrable(host))
        puntos += p2; razones += r2
    puntos = max(0, min(100, puntos))
    nivel = detector.nivel_de(puntos)
    accion = {"peligro": "Cierre esa pestaña y no escriba ningún dato. Si ya puso su clave, cámbiela desde el sitio oficial y avise a su banco.",
              "alerta": "Desconfíe: no ponga claves ni datos de tarjeta. Entre escribiendo usted mismo la dirección oficial.",
              "tranquilo": "No veo señales de phishing. Igual, nunca comparta códigos que le lleguen por SMS."}[nivel]
    return {"url": url, "dominio": host, "titulo": titulo, "navegador": navegador, "nivel": nivel, "puntaje": puntos,
            "razones": razones[:6], "accion": accion, "contenido_revisado": revisado_contenido}

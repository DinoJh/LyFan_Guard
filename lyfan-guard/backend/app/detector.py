"""Detector v1 de LyFan Guard: reglas con pesos para mensajes de estafa y enlaces de phishing.

No usa red ni modelos: es determinista y explicable (cada punto del puntaje tiene una razón).
Es la base para el modelo de texto y el análisis de páginas que vienen después.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from urllib.parse import urlparse

from .marcas import (ACORTADORES, ALIAS_SOLO_DOMINIO, MARCAS, TLD_CONOCIDOS, TLD_RIESGO, TUNELES)

UMBRAL_ALERTA = 30
UMBRAL_PELIGRO = 60

ACCIONES = {
    "tranquilo": "No veo señales claras de estafa. Aun así, nunca comparta claves ni códigos de verificación.",
    "alerta": "Verifique por el canal oficial (la app o la web que usted mismo abra) antes de responder o abrir enlaces.",
    "peligro": "No abra enlaces ni comparta códigos o claves. Bloquee al remitente y repórtelo.",
}


# ----------------------------------------------------------------- utilidades
def normalizar(texto: str) -> str:
    """Minúsculas y sin tildes, para comparar con reglas."""
    t = unicodedata.normalize("NFKD", texto.lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def nivel_de(puntaje: int) -> str:
    if puntaje >= UMBRAL_PELIGRO:
        return "peligro"
    if puntaje >= UMBRAL_ALERTA:
        return "alerta"
    return "tranquilo"


@dataclass
class ResultadoURL:
    url: str
    host: str
    puntaje: int
    nivel: str
    razones: list[str] = field(default_factory=list)
    oficial_de: str | None = None

    def a_dict(self) -> dict:
        return {"url": self.url, "host": self.host, "puntaje": self.puntaje, "nivel": self.nivel,
                "razones": self.razones, "oficial_de": self.oficial_de}


@dataclass
class Resultado:
    puntaje: int
    nivel: str
    razones: list[str]
    urls: list[dict]
    marcas: list[str]
    accion: str

    def a_dict(self) -> dict:
        return {"puntaje": self.puntaje, "nivel": self.nivel, "razones": self.razones,
                "urls": self.urls, "marcas": self.marcas, "accion": self.accion}


# ----------------------------------------------------------------- enlaces
_RE_URL = re.compile(r"(?i)\b(?:https?://|www\.)[^\s<>\"'()]+")
_RE_DOMINIO_SUELTO = re.compile(
    r"(?i)(?<![@\w.-])((?:[a-z0-9][a-z0-9-]*\.)+([a-z]{2,24}))(/[^\s<>\"'()]*)?(?![\w@-])")
_RE_IP = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")
_SLD_COMPUESTOS = {"com", "gob", "org", "net", "edu", "mil"}
_LEET = str.maketrans({"0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b"})


def extraer_urls(texto: str) -> list[str]:
    urls: list[str] = []
    for m in _RE_URL.finditer(texto):
        urls.append(m.group(0).rstrip(".,;:!?)"))
    ocupado = [m.span() for m in _RE_URL.finditer(texto)]
    for m in _RE_DOMINIO_SUELTO.finditer(texto):
        if any(a <= m.start() < b for a, b in ocupado):
            continue
        tld = m.group(2).lower()
        if tld in TLD_CONOCIDOS:
            urls.append((m.group(1) + (m.group(3) or "")).rstrip(".,;:!?)"))
    vistos, unicas = set(), []
    for u in urls:
        if u.lower() not in vistos:
            vistos.add(u.lower())
            unicas.append(u)
    return unicas


def dominio_registrable(host: str) -> str:
    partes = host.split(".")
    if len(partes) >= 3 and len(partes[-1]) == 2 and partes[-2] in _SLD_COMPUESTOS:
        return ".".join(partes[-3:])
    return ".".join(partes[-2:])


def _alias_marca(alias: str) -> str:
    return alias.replace(" ", "")


def analizar_url(url: str) -> ResultadoURL:
    explicito = bool(re.match(r"(?i)^https?://", url))
    crudo = url if explicito else "http://" + re.sub(r"^//", "", url)
    p = urlparse(crudo)
    host = (p.hostname or "").lower()
    puntos: list[tuple[int, str]] = []

    if not host:
        return ResultadoURL(url, "", 0, "tranquilo", ["No pude leer el dominio de este enlace."])

    registrable = dominio_registrable(host)

    # 1) Dominio oficial de una marca conocida
    for nombre, datos in MARCAS.items():
        for oficial in datos["dominios"]:
            if host == oficial or host.endswith("." + oficial):
                if p.scheme == "http" and explicito:
                    puntos.append((12, "El enlace no usa HTTPS."))
                    return _armar(url, host, puntos)
                return ResultadoURL(url, host, 0, "tranquilo",
                                    [f"Es un dominio oficial de {nombre}."], oficial_de=nombre)

    # 2) Rasgos del propio enlace
    if explicito and p.scheme == "http":
        puntos.append((12, "El enlace no usa HTTPS."))
    if _RE_IP.match(host):
        puntos.append((30, "Usa una dirección numérica (IP) en lugar de un nombre de sitio."))
    if "xn--" in host:
        puntos.append((25, "Usa caracteres disfrazados (punycode) para parecerse a otro sitio."))
    if "@" in (p.netloc or ""):
        puntos.append((25, "Tiene un @ en la dirección: puede esconder el sitio real."))
    if registrable in ACORTADORES:
        puntos.append((30, "Es un enlace acortado: no se ve a dónde lleva."))
    if registrable in TUNELES or any(host == t or host.endswith("." + t) for t in TUNELES):
        puntos.append((55, "Es un túnel temporal (como trycloudflare o ngrok): la página corre en la PC de alguien. "
                           "Lo usan los kits de phishing como Zphisher."))
        sub = host[: -len(registrable)].strip(".")
        if sub.count("-") >= 2:
            puntos.append((10, "Su dirección son palabras al azar, generada automáticamente."))
    tld = host.rsplit(".", 1)[-1]
    if tld in TLD_RIESGO:
        puntos.append((18, f"Termina en .{tld}, muy usado en sitios fraudulentos."))
    etiquetas = host.split(".")
    if len(etiquetas) - len(registrable.split(".")) >= 3:
        puntos.append((10, "Tiene demasiados subdominios."))
    sld = registrable.split(".")[0]
    if sld.count("-") >= 2:
        puntos.append((8, "El nombre del sitio tiene varios guiones."))
    if sum(c.isdigit() for c in sld) >= 3:
        puntos.append((6, "El nombre del sitio mezcla muchos números."))
    if len(url) > 75:
        puntos.append((6, "La dirección es muy larga."))

    # 3) Suplantación de marcas
    fichas = {t for t in re.split(r"[.\-_]", host) if t}
    ya_marca = False
    for nombre, datos in MARCAS.items():
        for alias in datos["alias"]:
            a = _alias_marca(alias)
            if a in fichas:
                puntos.append((45, f"Menciona «{nombre}», pero no es el dominio oficial."))
                ya_marca = True
                break
            sin_leet = sld.translate(_LEET)
            tope = 1 if len(a) <= 5 else 2
            if len(sld) >= 4 and sld != a and (sin_leet == a or levenshtein(sld, a) <= tope):
                puntos.append((40, f"El nombre se parece mucho a «{nombre}» (posible imitación)."))
                ya_marca = True
                break
        if ya_marca:
            break

    return _armar(url, host, puntos)


def _armar(url: str, host: str, puntos: list[tuple[int, str]]) -> ResultadoURL:
    total = min(100, sum(p for p, _ in puntos))
    razones = [r for _, r in sorted(puntos, key=lambda x: -x[0])]
    if not razones:
        razones = ["No encontré señales claras de riesgo en este enlace."]
    return ResultadoURL(url, host, total, nivel_de(total), razones)


# ----------------------------------------------------------------- mensajes
# (id, patrón sobre texto normalizado, peso, razón). Cada regla cuenta una sola vez.
_VERBOS_PEDIDO = r"(?:envi\w*|ingres\w*|comparte\w*|confirm\w*|digit\w*|brind\w*|proporcion\w*|dicta\w*|mand\w*|pas[ae]\w*|verific\w*|actualiz\w*)"
_REGLAS: list[tuple[str, str, int, str]] = [
    ("credenciales",
     rf"\b{_VERBOS_PEDIDO}\W+(?:\w+\W+){{0,6}}(?:clave|contrasena|password|pin|cvv|cvc|codigo|token|otp|tarjeta|datos bancarios)",
     35, "Le pide claves, códigos o datos de su tarjeta. Un banco nunca se los pide por mensaje."),
    ("premio",
     r"ganaste|ganador|has sido (?:seleccionad|eleg)|sorteo|\bpremio|felicidades|regalo|reclama\w* (?:tu|su)",
     20, "Promete un premio o un regalo que usted no pidió."),
    ("amenaza",
     r"bloquead|suspendid|suspender|desactivad|desactivar|cancelad|multa|embargo|denuncia|sera cerrada|inhabilit|deuda pendiente",
     18, "Amenaza con bloquear, multar o cancelar algo para presionarlo."),
    ("urgencia",
     r"urgente|inmediat|ahora mismo|ultim[oa]s? (?:horas|minutos|dia)|hoy mismo|en 24 horas|de inmediato|no pierdas|solo por hoy|expira",
     12, "Lo apura para que no piense ni verifique."),
    ("dinero",
     r"(?:transfier\w*|deposit\w*|yape\w*|plin\w*|enviar\w*|manda\w*)\W+(?:\w+\W+){0,5}(?:s/|soles|dolares|\$|dinero|monto)|(?:s/|\$)\s?\d{2,}.{0,40}(?:yape|plin|transfer|deposit)",
     18, "Le pide enviar dinero."),
    ("apk",
     r"\.apk\b|instala\w* (?:la |el |esta )?(?:app|aplicacion|programa)|descarga\w* (?:la |el |esta )?(?:app|aplicacion)|anydesk|teamviewer|control remoto",
     25, "Le pide instalar una aplicación o dar control remoto de su equipo."),
    ("familiar",
     r"hola (?:mama|papa|abuel[oa])|mi nuevo numero|cambie de numero|este es mi nuevo (?:numero|whatsapp)",
     22, "Es el truco del «familiar con número nuevo» que pide dinero."),
    ("inversion",
     r"gana\w* (?:s/|\$)?\s?\d+.{0,25}(?:dia|semana|hora)|inversion|invierte|criptomonedas|bitcoin|trabajo desde casa|ingresos extra|dinero facil",
     18, "Ofrece ganancias fáciles o inversiones milagrosas."),
]

_RE_BANDERAS = re.compile(r"!{3,}")


def _marcas_mencionadas(norm: str) -> list[str]:
    encontradas = []
    for nombre, datos in MARCAS.items():
        for alias in datos["alias"]:
            if alias in ALIAS_SOLO_DOMINIO:
                continue
            if re.search(rf"\b{re.escape(alias)}\b", norm):
                encontradas.append(nombre)
                break
    return encontradas


def analizar_mensaje(texto: str) -> Resultado:
    texto = texto.strip()
    norm = normalizar(texto)
    puntos: list[tuple[int, str]] = []
    ids: set[str] = set()

    for rid, patron, peso, razon in _REGLAS:
        if re.search(patron, norm):
            puntos.append((peso, razon))
            ids.add(rid)

    # Enlaces dentro del mensaje
    resultados_url = [analizar_url(u) for u in extraer_urls(texto)]
    max_url = max((r.puntaje for r in resultados_url), default=0)
    if max_url >= UMBRAL_ALERTA:
        peor = max(resultados_url, key=lambda r: r.puntaje)
        puntos.append((int(max_url * 0.7), f"Incluye un enlace dudoso ({peor.host}): {peor.razones[0]}"))
        ids.add("url")

    # Suplantación: dice ser una marca y el enlace no es oficial
    marcas = _marcas_mencionadas(norm)
    if marcas:
        oficiales = {r.oficial_de for r in resultados_url if r.oficial_de}
        enlaces_no_oficiales = [r for r in resultados_url if not r.oficial_de]
        if enlaces_no_oficiales and not (set(marcas) & oficiales):
            puntos.append((25, f"Dice venir de {', '.join(marcas)}, pero el enlace no es oficial."))
            ids.add("marca_url")
        elif ids & {"credenciales", "amenaza", "urgencia", "premio", "dinero"}:
            puntos.append((10, f"Se hace pasar por {', '.join(marcas)}."))
            ids.add("marca")

    # Forma del texto
    letras = [c for c in texto if c.isalpha()]
    if len(letras) >= 20 and sum(c.isupper() for c in letras) / len(letras) > 0.55:
        puntos.append((6, "Está escrito casi todo en mayúsculas para llamar su atención."))
    if _RE_BANDERAS.search(texto):
        puntos.append((4, "Usa muchos signos de exclamación."))

    # Varias señales juntas pesan más
    if len(ids - {"url"}) >= 3:
        puntos.append((10, "Combina varias señales típicas de estafa."))

    total = min(100, sum(p for p, _ in puntos))
    razones = [r for _, r in sorted(puntos, key=lambda x: -x[0])]
    nivel = nivel_de(total)
    if not razones:
        razones = ["No encontré señales típicas de estafa en este texto."]
    return Resultado(total, nivel, razones, [r.a_dict() for r in resultados_url], marcas, ACCIONES[nivel])


def analizar(texto: str) -> Resultado:
    """Punto de entrada: si el texto es solo un enlace, devuelve el análisis del enlace."""
    texto = texto.strip()
    urls = extraer_urls(texto)
    if len(urls) == 1 and len(texto.replace(urls[0], "").strip(" \n\t.,;:!?()") ) == 0:
        r = analizar_url(urls[0])
        return Resultado(r.puntaje, r.nivel, r.razones, [r.a_dict()], [r.oficial_de] if r.oficial_de else [],
                         ACCIONES[r.nivel])
    return analizar_mensaje(texto)


def hay_senales(texto: str) -> bool:
    """¿Vale la pena analizar este texto aunque el usuario no lo haya pedido?"""
    if extraer_urls(texto):
        return True
    return analizar_mensaje(texto).puntaje >= 20

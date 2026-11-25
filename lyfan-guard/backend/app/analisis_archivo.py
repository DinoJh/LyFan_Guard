"""Revisión local de archivos: scripts sospechosos (.bat, .ps1, .vbs…), texto con datos sensibles y archivos engañosos.

Todo es heurístico y se hace en este equipo; ninguna parte del archivo sale a internet.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

from . import detector

EXT_SCRIPT = {".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".hta", ".sh", ".py", ".reg"}
EXT_TEXTO = {".txt", ".md", ".csv", ".log", ".json", ".eml", ".html", ".htm", ".xml", ".ini", ".cfg", ".yml", ".yaml"}
EXT_EJECUTABLE = {".exe", ".scr", ".dll", ".msi", ".com", ".jar", ".apk", ".lnk", ".pif", ".cpl"}
MAX_LEER = 6000
MAX_ANALIZAR = 200_000

# (patrón, peso, razón en lenguaje simple)
REGLAS: list[tuple[str, int, str]] = [
    (r"powershell[^\n]*\s-(?:enc|encodedcommand|ec|e)\s+[A-Za-z0-9+/=]{16,}", 45, "Ejecuta PowerShell con un comando codificado, una forma de esconder lo que hace"),
    (r"-w(?:indowstyle)?\s+hidden|-nop(?:rofile)?\b[^\n]*-w\s+h", 20, "Oculta la ventana mientras corre"),
    (r"-ep\s+bypass|-executionpolicy\s+bypass|set-executionpolicy\s+(?:bypass|unrestricted)", 15, "Salta las protecciones de ejecución de PowerShell"),
    (r"(?:invoke-webrequest|\biwr\b|downloadfile|downloadstring|start-bitstransfer|bitsadmin[^\n]*/transfer|certutil[^\n]*-urlcache|\bcurl(?:\.exe)?\s+-?[^\n]*https?://|\bwget\s+https?://)", 30, "Descarga archivos desde internet"),
    (r"\b(?:iex|invoke-expression)\b", 25, "Convierte texto en código y lo ejecuta"),
    (r"frombase64string|\[convert\]::frombase64", 20, "Decodifica contenido escondido en Base64"),
    (r"[A-Za-z0-9+/]{220,}={0,2}", 15, "Contiene un bloque larguísimo de datos codificados"),
    (r"%[^%\n]{1,20}:~-?\d+,-?\d+%", 20, "Parte del texto está disfrazado para que no se entienda"),
    (r"(?:\^\w){6,}", 12, "Usa símbolos para confundir la lectura del código"),
    (r"\b(?:mshta|regsvr32[^\n]*/i:|rundll32[^\n]*javascript|wmic[^\n]*process\s+call\s+create|msiexec[^\n]*/i\s*https?://)", 30, "Usa herramientas de Windows que suelen emplear los virus para ejecutarse"),
    (r"reg\s+add[^\n]*\\run\b|\\currentversion\\run\b|schtasks[^\n]*/create|\bsc\s+create\b|shell:startup|\\startup\\", 25, "Se instala para volver a arrancar cada vez que se enciende la computadora"),
    (r"set-mppreference|disablerealtimemonitoring|netsh\s+advfirewall[^\n]*(?:state\s+off|off)|taskkill[^\n]*(?:msmpeng|defender|avast|kaspersky|mbam|eset)|sc\s+(?:stop|config)\s+(?:windefend|wscsvc)", 45, "Intenta apagar el antivirus o el firewall"),
    (r"vssadmin[^\n]*delete\s+shadows|wbadmin\s+delete|bcdedit[^\n]*recoveryenabled\s+no|cipher\s+/w", 65, "Borra copias de seguridad o la recuperación del sistema, algo típico de un ransomware"),
    (r"\bdel\s+(?:/[fsqa]\s*)+[a-z]:\\|rd\s+/s\s+/q\s+[a-z]:\\|\bformat\s+[a-z]:|rm\s+-rf\s+/(?:\s|$)", 40, "Borra carpetas enteras del disco"),
    (r"mimikatz|sekurlsa|lsass|procdump[^\n]*lsass|reg\s+save[^\n]*\\(?:sam|system|security)\b", 60, "Intenta robar contraseñas guardadas en Windows"),
    (r"net\s+user\s+\S+\s+\S+\s+/add|net\s+localgroup\s+administrators?\s+\S+\s+/add", 40, "Crea usuarios o se da permisos de administrador"),
    (r"new-object\s+net\.sockets\.tcpclient|\bncat?(?:\.exe)?\s+[^\n]*-e\b|/dev/tcp/|bash\s+-i\s+>&", 60, "Abre una conexión remota para que otra persona controle el equipo"),
    (r"discord(?:app)?\.com/api/webhooks|api\.telegram\.org/bot|pastebin\.com/raw", 35, "Envía o recibe datos mediante Discord, Telegram o Pastebin"),
    (r"login\s+data|\\local\s+state|\\cookies\b|logins\.json|key[34]\.db|wallet\.dat", 40, "Busca contraseñas, cookies o billeteras guardadas en el navegador"),
    (r"getasynckeystate|set-windowshookex|get-clipboard\b", 25, "Puede registrar lo que usted escribe o copia"),
    (r"%0\s*\|\s*%0", 60, "Se llama a sí mismo sin parar y puede trabar el equipo"),
    (r"attrib\s+\+h\s+\+s|attrib\s+\+s\s+\+h", 12, "Se esconde como archivo del sistema"),
]
_REGLAS = [(re.compile(p, re.I), w, r) for p, w, r in REGLAS]
_DOBLE_EXT = re.compile(r"(?i)\.(?:pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|mp3|mp4|zip|rar)\s*\.(?:exe|scr|bat|cmd|com|js|vbs|ps1|pif|hta)$")


def _accion(nivel: str) -> str:
    return {
        "peligro": "No lo ejecute. Cífrelo o elimínelo, y si ya lo abrió, pase el antivirus y cambie sus contraseñas.",
        "alerta": "Tenga cuidado: no lo ejecute hasta confirmar quién lo hizo y para qué sirve.",
        "tranquilo": "No veo comportamientos peligrosos, pero solo ejecute scripts de personas de confianza.",
    }[nivel]


def analizar_script(texto: str) -> dict:
    texto = texto[:MAX_ANALIZAR]
    puntos, razones = 0, []
    for rx, peso, razon in _REGLAS:
        if rx.search(texto):
            puntos += peso
            razones.append(razon)
    # enlaces dentro del script: se revisan con el detector de enlaces
    peor = None
    for u in detector.extraer_urls(texto)[:8]:
        try:
            r = detector.analizar_url(u)
        except Exception:  # noqa: BLE001
            continue
        if peor is None or r.puntaje > peor.puntaje:
            peor = r
    if peor is not None and peor.puntaje >= 30:
        puntos += 25
        razones.append(f"Contiene un enlace sospechoso ({peor.url})")
    puntos = min(100, puntos)
    nivel = detector.nivel_de(puntos)
    return {"puntaje": puntos, "nivel": nivel, "razones": razones[:6], "accion": _accion(nivel)}


def sha256(ruta: Path) -> str:
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def analizar_archivo(ruta: Path) -> dict:
    """Revisión según el tipo de archivo (LyFan Antivirus, heurístico). No ejecuta nada."""
    from . import antivirus  # noqa: PLC0415
    ext = ruta.suffix.lower()
    base = {"nombre": ruta.name, "bytes": ruta.stat().st_size, "motor": antivirus.MOTOR}
    engano = bool(_DOBLE_EXT.search(ruta.name))
    with open(ruta, "rb") as f:
        datos = f.read(antivirus.MAX_BINARIO)
    huella = sha256(ruta)
    firma = antivirus.buscar_firmas(datos, huella)
    if firma:                                             # coincide con una firma conocida (por ejemplo, EICAR)
        r = antivirus._resultado(100, [f"Coincide con la firma {firma}: el archivo de prueba estándar que todo antivirus debe detectar"
                                       if firma.startswith("EICAR") else f"Coincide con la firma conocida {firma}"], firma=firma)
        return {**base, "revisable": ext in EXT_SCRIPT or ext in EXT_TEXTO, "tipo": "firma", "sha256": huella, "riesgo": r}
    if ext in EXT_SCRIPT or ext in EXT_TEXTO:
        texto = ruta.read_text(encoding="utf-8", errors="replace")[:MAX_ANALIZAR]
        salida = {**base, "revisable": True, "tipo": "script" if ext in EXT_SCRIPT else "texto"}
        if ext in EXT_SCRIPT:
            r = analizar_script(texto)
            if engano:
                r["puntaje"] = min(100, r["puntaje"] + 40); r["razones"].insert(0, "Su nombre tiene doble extensión para engañar")
            r["nivel"] = detector.nivel_de(r["puntaje"]); r["accion"] = _accion(r["nivel"])
            r["deteccion"] = (antivirus.familia_de(r["razones"], r["nivel"]) + " (heurístico)") if r["nivel"] != "tranquilo" else None
            r["motor"] = antivirus.MOTOR
            salida["riesgo"] = r
            salida["sha256"] = huella
            salida["sensibles"] = _sensibles(texto)
        else:
            salida["sensibles"] = _sensibles(texto)
            salida["estafa"] = detector.analizar(texto[:6000]).a_dict() if texto.strip() else None
        return salida
    salida = {**base, "revisable": False, "tipo": "binario", "sha256": huella}
    salida["riesgo"] = antivirus.analizar_binario(ruta, datos, engano)
    return salida


def _sensibles(texto: str) -> list[str]:
    from . import boveda  # noqa: PLC0415
    return boveda.datos_sensibles(texto)


def leer(ruta: Path) -> dict:
    ext = ruta.suffix.lower()
    if ext not in EXT_TEXTO and ext not in EXT_SCRIPT:
        return {"nombre": ruta.name, "legible": False}
    t = ruta.read_text(encoding="utf-8", errors="replace")
    return {"nombre": ruta.name, "legible": True, "texto": t[:MAX_LEER], "truncado": len(t) > MAX_LEER}

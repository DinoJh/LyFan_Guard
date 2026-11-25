"""LyFan Antivirus (heurístico y 100 % local).

No reemplaza a un antivirus comercial: es un revisor sencillo que mira DENTRO de los archivos sin ejecutarlos.
  · Firmas: reconoce el archivo de prueba EICAR (el estándar mundial para probar antivirus) y huellas conocidas.
  · Programas (.exe, .dll, .scr…): busca funciones típicas de virus (inyectar código, registrar teclas, descargar,
    arrancar solo con Windows, mensajes de rescate) y si está empaquetado o cifrado (entropía alta).
  · Documentos: macros de Office que se ejecutan solas, PDF con JavaScript o que lanzan programas.
  · Comprimidos (.zip): programas o scripts escondidos adentro, nombres engañosos, ZIP con contraseña.
  · Accesos directos (.lnk) que en realidad ejecutan PowerShell o la consola.
  · Escaneo de la carpeta de la bóveda en segundo plano: solo revisa lo nuevo o lo que cambió.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import time
import zipfile
from pathlib import Path

from . import detector

MOTOR = "LyFan Antivirus · heurístico local"
MAX_BINARIO = 8 * 1024 * 1024        # se revisan hasta 8 MB del archivo
MAX_ESCANEO = 50 * 1024 * 1024       # archivos más grandes no entran al escaneo automático

# El archivo de prueba EICAR: inofensivo, pero todos los antivirus del mundo deben detectarlo.
EICAR = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$" + b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"   # en dos partes para que un antivirus real no borre este archivo
FIRMAS_SHA256 = {
    "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f": "EICAR-Test-File",
    "131f95c51cc819465fa1797f6ccacf9d494aaaff46fa3eac73ae63ffbdfd8267": "EICAR-Test-File",
}

# (patrón en bytes, peso, razón, familia)
_BIN_REGLAS: list[tuple[bytes, int, str, str]] = [
    (rb"(?=.*virtualallocex)(?=.*writeprocessmemory)(?=.*createremotethread)", 45,
     "Puede inyectar código dentro de otros programas", "Trojan.Injector"),
    (rb"getasynckeystate|setwindowshookex", 25, "Puede registrar las teclas que usted presiona", "Spyware.Keylogger"),
    (rb"urldownloadtofile|internetopenurl|winhttpopen", 20, "Descarga archivos desde internet", "Trojan.Downloader"),
    (rb"software\\microsoft\\windows\\currentversion\\run", 25, "Se instala para arrancar solo con Windows", "Trojan.Persistence"),
    (rb"cmd\.exe /c|powershell(?:\.exe)? -(?:enc|w hidden|nop|ep bypass)", 25, "Ejecuta comandos ocultos de la consola o PowerShell", "Trojan.Dropper"),
    (rb"vssadmin.{0,20}delete|your files have been encrypted|tus archivos (?:han sido|fueron) cifrados|decrypt your files|ransom|\.onion", 55,
     "Tiene mensajes o comandos típicos de un ransomware (secuestro de archivos)", "Ransom.Generic"),
    (rb"isdebuggerpresent|checkremotedebuggerpresent", 8, "Intenta detectar si lo están analizando", "Heur.Evasion"),
    (rb"mimikatz|sekurlsa|lsass\.exe", 50, "Intenta robar contraseñas de Windows", "HackTool.CredStealer"),
    (rb"login data|logins\.json|wallet\.dat|\\local state", 35, "Busca contraseñas o billeteras guardadas en el navegador", "Spyware.Stealer"),
    (rb"discord(?:app)?\.com/api/webhooks|api\.telegram\.org/bot", 35, "Envía datos a Discord o Telegram", "Spyware.Stealer"),
]
_BIN_REGLAS_RX = [(re.compile(p, re.I | re.S), w, r, f) for p, w, r, f in _BIN_REGLAS]
_EXT_PROGRAMA = {".exe", ".scr", ".dll", ".com", ".pif", ".cpl", ".sys", ".msi"}
_EXT_PELIGROSAS_ZIP = {".exe", ".scr", ".bat", ".cmd", ".ps1", ".vbs", ".vbe", ".js", ".jse", ".hta", ".lnk", ".pif", ".com", ".msi", ".wsf", ".jar", ".iso", ".img"}
_EXT_OFFICE_ZIP = {".docx", ".docm", ".xlsx", ".xlsm", ".pptx", ".pptm", ".dotm", ".xltm"}
_EXT_OFFICE_OLE = {".doc", ".xls", ".ppt", ".dot", ".xlt"}

# familia según la razón de las reglas de scripts (analisis_archivo.REGLAS)
_FAMILIA_SCRIPT = [
    ("ransomware", "Ransom.Script"), ("roba", "Spyware.Stealer"), ("robar", "HackTool.CredStealer"),
    ("conexión remota", "Backdoor.ReverseShell"), ("antivirus", "Trojan.AVKiller"), ("descarga", "Trojan.Downloader"),
    ("codificado", "Trojan.Obfuscated"), ("arrancar", "Trojan.Persistence"), ("borra carpetas", "Trojan.Wiper"),
    ("sin parar", "Trojan.ForkBomb"), ("discord", "Spyware.Stealer"), ("teclas", "Spyware.Keylogger"),
    ("escribe o copia", "Spyware.Keylogger"), ("administrador", "Trojan.PrivEsc"),
]


def _cadenas(datos: bytes) -> bytes:
    """Texto legible del archivo (ASCII y UTF-16) en minúsculas, para buscar pistas."""
    ascii_ = b"\n".join(re.findall(rb"[\x20-\x7e]{5,}", datos))
    utf16 = b"\n".join(m.replace(b"\x00", b"") for m in re.findall(rb"(?:[\x20-\x7e]\x00){5,}", datos))
    return (ascii_ + b"\n" + utf16).lower()


def entropia(datos: bytes) -> float:
    if not datos:
        return 0.0
    cuenta = [0] * 256
    for b in datos:
        cuenta[b] += 1
    n = len(datos)
    return -sum(c / n * math.log2(c / n) for c in cuenta if c)


def familia_de(razones: list[str], nivel: str) -> str | None:
    if nivel == "tranquilo":
        return None
    texto = " ".join(razones).lower()
    for clave, fam in _FAMILIA_SCRIPT:
        if clave in texto:
            return fam
    return "Heur.Suspicious"


def _resultado(puntos: int, razones: list[str], familia: str | None = None, firma: str | None = None) -> dict:
    from .analisis_archivo import _accion  # noqa: PLC0415
    puntos = min(100, puntos)
    nivel = detector.nivel_de(puntos)
    if firma:
        deteccion = firma
    elif nivel == "tranquilo":
        deteccion = None
    else:
        deteccion = (familia or familia_de(razones, nivel)) + (" (heurístico)" if nivel else "")
    return {"puntaje": puntos, "nivel": nivel, "razones": razones[:6], "accion": _accion(nivel),
            "deteccion": deteccion, "motor": MOTOR}


def buscar_firmas(datos: bytes, sha: str | None) -> str | None:
    if sha and sha in FIRMAS_SHA256:
        return FIRMAS_SHA256[sha]
    if EICAR in datos[:65536]:
        return "EICAR-Test-File"
    return None


def analizar_binario(ruta: Path, datos: bytes, engano: bool) -> dict:
    """Programas, documentos, PDF, comprimidos y accesos directos."""
    ext = ruta.suffix.lower()
    puntos, razones, familia = 0, [], None
    if engano:
        puntos += 60; razones.append("Su nombre tiene doble extensión para engañar"); familia = "Trojan.Masquerade"

    es_pe = datos[:2] == b"MZ"
    if es_pe:
        if ext not in _EXT_PROGRAMA:
            puntos += 50; razones.append("Es un programa disfrazado con otra extensión"); familia = familia or "Trojan.Masquerade"
        s = _cadenas(datos)
        for rx, peso, razon, fam in _BIN_REGLAS_RX:
            if rx.search(s):
                puntos += peso; razones.append(razon); familia = familia or fam
        if b"upx0" in datos[:4096].lower() or b"upx!" in datos[:4096].lower():
            puntos += 12; razones.append("Está empaquetado (UPX), una forma de esconder su código")
        ent = entropia(datos[:1024 * 1024])
        if ent > 7.2:
            puntos += 15; razones.append(f"Gran parte está comprimida o cifrada (entropía {ent:.1f} de 8)")
        if not razones:
            razones.append("Es un programa: no encontré funciones peligrosas a simple vista")
    elif ext == ".lnk" or datos[:4] == b"L\x00\x00\x00":
        s = _cadenas(datos)
        if re.search(rb"powershell|cmd\.exe|mshta|wscript|cscript|rundll32", s):
            puntos += 45; razones.append("Es un acceso directo que en realidad ejecuta comandos (PowerShell o consola)"); familia = "Trojan.LNK"
        if re.search(rb"https?://", s):
            puntos += 20; razones.append("El acceso directo apunta a internet")
    elif datos[:5] == b"%PDF-":
        s = datos.lower()
        if b"/javascript" in s or b"/js" in s:
            puntos += 30; razones.append("El PDF tiene código JavaScript adentro")
        if b"/launch" in s:
            puntos += 40; razones.append("El PDF intenta abrir otros programas"); familia = "Exploit.PDF"
        if b"/openaction" in s or b"/aa" in s:
            puntos += 12; razones.append("El PDF hace algo apenas se abre")
        if b"/embeddedfile" in s:
            puntos += 15; razones.append("El PDF trae archivos escondidos adentro")
        familia = familia or ("Exploit.PDF" if puntos else None)
    elif datos[:4] == b"PK\x03\x04":
        p, rz, fam = _revisar_zip(ruta, ext)
        puntos += p; razones += rz; familia = familia or fam
    elif datos[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" and ext in _EXT_OFFICE_OLE | {".msi"}:
        s = datos.lower()
        if b"vba" in s and (b"macros" in s or b"_vba_project" in s or b"attribut" in s):
            puntos += 30; razones.append("El documento tiene macros (código que puede ejecutarse)"); familia = "Macro.Office"
            if re.search(rb"autoopen|document_open|workbook_open|auto_open", s):
                puntos += 20; razones.append("Las macros se ejecutan solas al abrir el documento")
            if re.search(rb"wscript\.shell|shell\(|powershell|urldownloadtofile|createobject", s):
                puntos += 25; razones.append("Las macros pueden ejecutar comandos o descargar archivos")
    return _resultado(puntos, razones, familia)


def _revisar_zip(ruta: Path, ext: str) -> tuple[int, list[str], str | None]:
    from .analisis_archivo import _DOBLE_EXT, analizar_script  # noqa: PLC0415
    puntos, razones, familia = 0, [], None
    try:
        with zipfile.ZipFile(ruta) as z:
            infos = z.infolist()[:500]
            nombres = [i.filename for i in infos]
            if ext in _EXT_OFFICE_ZIP or "[Content_Types].xml" in nombres:
                if any(n.lower().endswith("vbaproject.bin") for n in nombres):
                    puntos += 30; razones.append("El documento tiene macros (código que puede ejecutarse)"); familia = "Macro.Office"
                    try:
                        vba = next(z.read(i)[:MAX_BINARIO] for i in infos if i.filename.lower().endswith("vbaproject.bin")).lower()
                        if re.search(rb"autoopen|document_open|workbook_open|auto_open", vba):
                            puntos += 20; razones.append("Las macros se ejecutan solas al abrir el documento")
                        if re.search(rb"wscript\.shell|powershell|urldownloadtofile|createobject|shell", vba):
                            puntos += 25; razones.append("Las macros pueden ejecutar comandos o descargar archivos")
                    except Exception:  # noqa: BLE001
                        pass
                if any(n.lower().endswith((".rels",)) and b"oleobject" in z.read(n)[:200000].lower() for n in nombres if n.lower().endswith(".rels")):
                    puntos += 10; razones.append("El documento trae objetos incrustados")
                return puntos, razones, familia
            cifrado = any(i.flag_bits & 0x1 for i in infos)
            if cifrado:
                puntos += 20; razones.append("Está comprimido con contraseña, una táctica para que el antivirus no vea adentro")
            peligrosos = [n for n in nombres if Path(n).suffix.lower() in _EXT_PELIGROSAS_ZIP]
            if peligrosos:
                puntos += 30; razones.append(f"Trae programas o scripts adentro ({', '.join(Path(n).name for n in peligrosos[:3])})"); familia = "Trojan.Dropper"
            if any(_DOBLE_EXT.search(Path(n).name) for n in nombres):
                puntos += 40; razones.append("Adentro hay un archivo con doble extensión para engañar"); familia = "Trojan.Masquerade"
            if not cifrado:
                scripts = 0
                for i in infos[:200]:
                    if i.is_dir() or i.file_size > 1_000_000:
                        continue
                    contenido = z.read(i)
                    if EICAR in contenido[:65536]:
                        puntos = 100; razones.insert(0, "Adentro está el archivo de prueba EICAR"); familia = "EICAR-Test-File"
                        break
                    if Path(i.filename).suffix.lower() in {".bat", ".cmd", ".ps1", ".vbs", ".js", ".hta"} and scripts < 3:
                        scripts += 1
                        r = analizar_script(contenido.decode("utf-8", "replace"))
                        if r["puntaje"] >= 30:
                            puntos += r["puntaje"] // 2
                            razones.append(f"El script {Path(i.filename).name} de adentro es sospechoso: {r['razones'][0] if r['razones'] else ''}")
    except zipfile.BadZipFile:
        razones.append("El comprimido está dañado")
    except Exception:  # noqa: BLE001
        pass
    return puntos, razones, familia


# ------------------------------------------------------------------ escaneo de la carpeta en segundo plano
def _ruta_estado() -> Path:
    from .voz import DIR_DATOS  # noqa: PLC0415
    return DIR_DATOS / "antivirus.json"


def _leer_estado() -> dict:
    try:
        return json.loads(_ruta_estado().read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {"archivos": {}, "permitidos": [], "ultimo": 0}


def _guardar_estado(e: dict) -> None:
    try:
        _ruta_estado().parent.mkdir(parents=True, exist_ok=True)
        _ruta_estado().write_text(json.dumps(e), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass


def permitir(sha: str) -> None:
    """«Es una falsa alarma»: ese archivo (por su huella) ya no se vuelve a marcar."""
    e = _leer_estado()
    if sha and sha not in e["permitidos"]:
        e["permitidos"].append(sha)
        _guardar_estado(e)


def escanear(solo_nuevos: bool = False) -> dict:
    """Revisa la carpeta de la bóveda (solo archivos sin cifrar). Lo que no cambió no se vuelve a analizar.
    nuevos = hallazgos que todavía no se le avisaron a la persona."""
    from . import boveda  # noqa: PLC0415
    from .analisis_archivo import analizar_archivo  # noqa: PLC0415
    e = _leer_estado()
    previos, permitidos = e.get("archivos", {}), set(e.get("permitidos", []))
    actuales, hallazgos, nuevos, revisados = {}, [], [], 0
    carpeta = boveda.DIR_BOVEDA
    if carpeta.exists():
        for p in sorted(carpeta.iterdir(), key=lambda x: x.name.lower()):
            if not p.is_file() or p.name.startswith(".") or p.suffix == boveda.EXT or p.name == boveda.ARCHIVO_CONFIG:
                continue
            st = p.stat()
            if st.st_size > MAX_ESCANEO:
                continue
            clave = f"{st.st_size}:{int(st.st_mtime)}"
            ant = previos.get(p.name)
            if ant and ant.get("clave") == clave:
                info = ant
            else:
                try:
                    r = analizar_archivo(p)
                except Exception:  # noqa: BLE001
                    continue
                revisados += 1
                g = r.get("riesgo") or {}
                from .analisis_archivo import sha256 as _sha  # noqa: PLC0415
                info = {"clave": clave, "nivel": g.get("nivel", "tranquilo"), "puntaje": g.get("puntaje", 0),
                        "razones": g.get("razones", [])[:3], "deteccion": g.get("deteccion"), "sha256": r.get("sha256") or _sha(p),
                        "avisado": False}
            actuales[p.name] = info
            if info["nivel"] != "tranquilo" and (info.get("sha256") or "") not in permitidos:
                h = {"nombre": p.name, **{k: info.get(k) for k in ("nivel", "puntaje", "razones", "deteccion")}}
                hallazgos.append(h)
                if not info.get("avisado"):
                    nuevos.append(h); info["avisado"] = True
    e["archivos"], e["ultimo"] = actuales, time.time()
    _guardar_estado(e)
    orden = {"peligro": 0, "alerta": 1}
    hallazgos.sort(key=lambda h: (orden.get(h["nivel"], 2), -h["puntaje"]))
    nuevos.sort(key=lambda h: (orden.get(h["nivel"], 2), -h["puntaje"]))
    return {"revisados": revisados, "total": len(actuales), "hallazgos": hallazgos,
            "nuevos": nuevos if solo_nuevos else hallazgos, "motor": MOTOR}


def sha256_bytes(datos: bytes) -> str:
    return hashlib.sha256(datos).hexdigest()

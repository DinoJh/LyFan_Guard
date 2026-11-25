"""Voz de LyFan: hablar (Edge TTS gratis, ElevenLabs con tu clave) y escuchar (faster-whisper, local).

- La clave y el ID de voz de ElevenLabs se guardan en  ~/.lyfan-guard/voz.json  (fuera del proyecto, nunca en Git)
  y el servidor jamás las devuelve completas.
- Si ElevenLabs falla (clave inválida o vencida, sin créditos, sin internet), cae solo a la voz gratuita.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path

import httpx

DIR_DATOS = Path(os.environ.get("LYFAN_DATOS", str(Path.home() / ".lyfan-guard")))
ARCHIVO_CONFIG = DIR_DATOS / "voz.json"
VOZ_RESPALDO = "es-PE-CamilaNeural"
MODELOS_ELEVEN = {
    "eleven_flash_v2_5": "Flash v2.5 (rápida, recomendada)",
    "eleven_multilingual_v2": "Multilingual v2 (más expresiva)",
    "eleven_turbo_v2_5": "Turbo v2.5",
}
MAX_TEXTO = 600

# Voces neuronales gratuitas de Edge (necesitan internet). Nombres verificados con edge_tts.list_voices().
VOCES_EDGE = [
    {"id": "es-PE-CamilaNeural", "nombre": "Camila · Perú", "genero": "mujer"},
    {"id": "es-PE-AlexNeural", "nombre": "Alex · Perú", "genero": "hombre"},
    {"id": "es-MX-DaliaNeural", "nombre": "Dalia · México", "genero": "mujer"},
    {"id": "es-MX-JorgeNeural", "nombre": "Jorge · México", "genero": "hombre"},
    {"id": "es-ES-ElviraNeural", "nombre": "Elvira · España", "genero": "mujer"},
    {"id": "es-ES-AlvaroNeural", "nombre": "Álvaro · España", "genero": "hombre"},
    {"id": "es-AR-ElenaNeural", "nombre": "Elena · Argentina", "genero": "mujer"},
    {"id": "es-CO-SalomeNeural", "nombre": "Salomé · Colombia", "genero": "mujer"},
    {"id": "es-CL-CatalinaNeural", "nombre": "Catalina · Chile", "genero": "mujer"},
    {"id": "es-US-PalomaNeural", "nombre": "Paloma · EE. UU.", "genero": "mujer"},
]
_IDS_EDGE = {v["id"] for v in VOCES_EDGE}


# Voces neuronales SIN INTERNET (Piper). Se descargan una vez (~60 a 115 MB) a ~/.lyfan-guard/piper y luego funcionan sin conexión.
DIR_PIPER = DIR_DATOS / "piper"
REPO_PIPER = "rhasspy/piper-voices"
VOCES_PIPER = [
    {"id": "es_ES-davefx-medium", "nombre": "Dave · España", "genero": "hombre", "mb": 63,
     "ruta": "es/es_ES/davefx/medium/es_ES-davefx-medium"},
]
# Voces que se arman a partir de otra: «LyFan juvenil» es Dave con el tono más alto (un robot joven).
# Usa el mismo modelo de Dave, así que no descarga nada más y suena igual de fluida.
VOCES_VIRTUALES = {"lyfan-juvenil": {"base": "es_ES-davefx-medium", "tono": 1.14}}
# Tono propio de cada voz (1.0 = natural)
TONO_BASE = {"es_ES-davefx-medium": 1.0, **{k: v["tono"] for k, v in VOCES_VIRTUALES.items()}}
# Emociones: LyFan cambia su forma de hablar según lo que siente (tono, ritmo y viveza de la voz).
#   tono >1 = más agudo · ritmo <1 = más rápido · viveza = variación natural (noise_scale) · fluidez = variación del ritmo (noise_w)
# OJO: «fluidez» (noise_w) debe quedarse cerca del valor del modelo (0.333). Si se sube, cada sílaba dura distinto
# y la voz suena entrecortada, como si le costara hablar.
EMOCIONES = {
    "neutro":  {"tono": 1.00, "ritmo": 1.00, "viveza": 0.55, "fluidez": 0.33},
    "alegre":  {"tono": 1.05, "ritmo": 0.95, "viveza": 0.62, "fluidez": 0.36},
    "curioso": {"tono": 1.03, "ritmo": 0.99, "viveza": 0.58, "fluidez": 0.34},
    "alerta":  {"tono": 0.97, "ritmo": 1.05, "viveza": 0.45, "fluidez": 0.28},
    "calma":   {"tono": 0.99, "ritmo": 1.03, "viveza": 0.50, "fluidez": 0.30},
}
_PIPER_POR_ID = {v["id"]: v for v in VOCES_PIPER}
VOZ_PIPER_DEFECTO = "es_ES-davefx-medium"
MIME_MP3, MIME_WAV = "audio/mpeg", "audio/wav"


class ErrorVoz(Exception):
    """Error de voz con un mensaje listo para mostrar a la persona."""

    def __init__(self, mensaje: str, codigo: int = 503):
        super().__init__(mensaje)
        self.mensaje, self.codigo = mensaje, codigo


# ------------------------------------------------------------------ configuración (ElevenLabs)
def leer_config() -> dict:
    try:
        return json.loads(ARCHIVO_CONFIG.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def guardar_config(clave: str | None = None, voice_id: str | None = None, modelo: str | None = None,
                   borrar_clave: bool = False) -> dict:
    cfg = leer_config()
    if borrar_clave:
        cfg.pop("elevenlabs_clave", None)
    elif clave and clave.strip():
        c = clave.strip()
        if not re.fullmatch(r"[A-Za-z0-9_\-]{16,200}", c):
            raise ErrorVoz("La clave de ElevenLabs tiene caracteres que no esperaba. Cópiala de nuevo.", 400)
        cfg["elevenlabs_clave"] = c
    if voice_id is not None:
        v = voice_id.strip()
        if v and not re.fullmatch(r"[A-Za-z0-9]{10,40}", v):
            raise ErrorVoz("El ID de voz no parece válido (solo letras y números).", 400)
        cfg["elevenlabs_voice_id"] = v
    if modelo is not None and modelo in MODELOS_ELEVEN:
        cfg["elevenlabs_modelo"] = modelo
    DIR_DATOS.mkdir(parents=True, exist_ok=True)
    ARCHIVO_CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return config_publica()


def config_publica() -> dict:
    """Lo que puede ver la interfaz: nunca la clave completa."""
    cfg = leer_config()
    clave = cfg.get("elevenlabs_clave", "")
    return {
        "elevenlabs": {
            "tiene_clave": bool(clave),
            "clave_fin": ("…" + clave[-4:]) if clave else "",
            "voice_id": cfg.get("elevenlabs_voice_id", ""),
            "modelo": cfg.get("elevenlabs_modelo", "eleven_flash_v2_5"),
            "configurado": bool(clave and cfg.get("elevenlabs_voice_id")),
        },
        "modelos_eleven": [{"id": k, "nombre": v} for k, v in MODELOS_ELEVEN.items()],
        "voces_edge": VOCES_EDGE,
        "voces_piper": estado_piper(),
        "piper_disponible": piper_disponible(),
        "stt": estado_transcriptor(),
    }


# ------------------------------------------------------------------ texto para voz
_RE_URL = re.compile(r"(?i)(?:https?://|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|pe|net|org|gob|xyz|top|click|icu|live|site|online|shop|vip|club|ly|gl)(?:/\S*)?")
_RE_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿️‍]")


def limpiar_para_voz(texto: str) -> str:
    """Quita Markdown, emojis y direcciones (leer un enlace en voz alta es molesto) y limita el largo."""
    t = _RE_URL.sub("un enlace", texto)
    t = _RE_EMOJI.sub("", t)
    t = re.sub(r"[*_`#>]+", "", t)
    t = re.sub(r"^\s*[-•]\s+", "", t, flags=re.M)
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) > MAX_TEXTO:
        corte = t.rfind(".", 0, MAX_TEXTO)
        t = t[: corte + 1] if corte > 200 else t[:MAX_TEXTO]
    return t


# ------------------------------------------------------------------ síntesis
_cache: "OrderedDict[str, tuple[bytes, str, str]]" = OrderedDict()   # clave -> (audio, proveedor, mime)


def _cache_get(k: str):
    if k in _cache:
        _cache.move_to_end(k)
        return _cache[k]
    return None


def _cache_set(k: str, valor: tuple[bytes, str, str]) -> None:
    _cache[k] = valor
    while len(_cache) > 40:
        _cache.popitem(last=False)


async def sintetizar_edge(texto: str, voz: str, tono_hz: int = 0, velocidad_pct: int = 0) -> bytes:
    if voz not in _IDS_EDGE:
        raise ErrorVoz("Esa voz no está en mi lista.", 400)
    import edge_tts  # noqa: PLC0415  (se importa aquí para que el servidor arranque aunque falte)

    tono = max(-50, min(50, int(tono_hz)))
    vel = max(-50, min(50, int(velocidad_pct)))
    try:
        com = edge_tts.Communicate(texto, voz, rate=f"{vel:+d}%", pitch=f"{tono:+d}Hz")

        async def juntar() -> bytes:
            audio = bytearray()
            async for trozo in com.stream():
                if trozo["type"] == "audio":
                    audio.extend(trozo["data"])
            return bytes(audio)

        datos = await asyncio.wait_for(juntar(), timeout=10)
    except ErrorVoz:
        raise
    except Exception as e:  # noqa: BLE001
        raise ErrorVoz("No pude generar la voz gratuita (¿hay internet?).") from e
    if not datos:
        raise ErrorVoz("La voz gratuita no devolvió audio.")
    return datos


async def sintetizar_elevenlabs(texto: str, voice_id: str, clave: str, modelo: str) -> bytes:
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    cuerpo = {"text": texto, "model_id": modelo, "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}
    cab = {"xi-api-key": clave, "Content-Type": "application/json", "Accept": "audio/mpeg"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=6.0)) as c:
            r = await c.post(url, params={"output_format": "mp3_44100_128"}, headers=cab, json=cuerpo)
    except Exception as e:  # noqa: BLE001
        raise ErrorVoz("No pude conectarme con ElevenLabs (¿hay internet?).") from e
    if r.status_code == 200 and r.content:
        return r.content
    mensajes = {
        401: "La clave de ElevenLabs no es válida o venció.",
        402: "Tu cuenta de ElevenLabs no tiene créditos o su plan no permite esto.",
        403: "ElevenLabs no permite usar esa clave o esa voz.",
        404: "ElevenLabs no encontró ese ID de voz.",
        422: "ElevenLabs rechazó la solicitud (revisa el ID de voz y el modelo).",
        429: "ElevenLabs alcanzó su límite de uso por ahora.",
    }
    raise ErrorVoz(mensajes.get(r.status_code, f"ElevenLabs no respondió bien (código {r.status_code})."))


# ---- Piper: voz neuronal que corre en el propio equipo, sin internet
_voces_piper: dict = {}
_bloqueo_piper = threading.Lock()


def piper_disponible() -> bool:
    try:
        import piper  # noqa: F401, PLC0415
        return True
    except Exception:  # noqa: BLE001
        return False


def _archivos_piper(voz_id: str):
    base = DIR_PIPER / _PIPER_POR_ID[voz_id]["ruta"]
    return base.with_name(base.name + ".onnx"), base.with_name(base.name + ".onnx.json")


def piper_instalada(voz_id: str) -> bool:
    if voz_id not in _PIPER_POR_ID:
        return False
    onnx, conf = _archivos_piper(voz_id)
    return onnx.exists() and conf.exists()


def estado_piper() -> list[dict]:
    return [{"id": v["id"], "nombre": v["nombre"], "genero": v["genero"], "mb": v["mb"],
             "instalada": piper_instalada(v["id"])} for v in VOCES_PIPER]


def _piper_instaladas() -> list[str]:
    return [v["id"] for v in VOCES_PIPER if piper_instalada(v["id"])]


def descargar_piper_sync(voz_id: str) -> None:
    if voz_id not in _PIPER_POR_ID:
        raise ErrorVoz("Esa voz no está en mi lista.", 400)
    try:
        from huggingface_hub import hf_hub_download  # noqa: PLC0415
        ruta = _PIPER_POR_ID[voz_id]["ruta"]
        DIR_PIPER.mkdir(parents=True, exist_ok=True)
        for ext in (".onnx", ".onnx.json"):
            hf_hub_download(REPO_PIPER, ruta + ext, local_dir=str(DIR_PIPER))
    except Exception as e:  # noqa: BLE001
        raise ErrorVoz("No pude descargar la voz (¿hay internet?).") from e


async def descargar_piper(voz_id: str) -> list[dict]:
    if not piper_disponible():
        raise ErrorVoz("Piper no está instalado (pip install piper-tts).", 501)
    await asyncio.to_thread(descargar_piper_sync, voz_id)
    return estado_piper()


def _subir_tono(wav: bytes, factor: float) -> bytes:
    """Sube (o baja) el tono sin cambiar el ritmo: el audio se generó más lento en la misma proporción,
    así que al acelerarlo con un re-muestreo queda a velocidad normal pero más agudo. Sale a 24 kHz."""
    import io  # noqa: PLC0415
    import wave  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415

    if abs(factor - 1.0) < 0.005:
        return wav
    with wave.open(io.BytesIO(wav)) as r:
        sr, x = r.getframerate(), np.frombuffer(r.readframes(r.getnframes()), dtype=np.int16).astype(np.float32)
    n = max(1, int(len(x) * 24000 / (sr * factor)))
    y = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
        w.writeframes(np.clip(y, -32768, 32767).astype(np.int16).tobytes())
    return out.getvalue()


def _parametros_voz(texto: str, voz_id: str, velocidad_pct: int, emocion: str) -> tuple[float, float, float, float]:
    """(tono, length_scale, noise_scale, noise_w) para una frase."""
    e = EMOCIONES.get(emocion, EMOCIONES["neutro"])
    vel = max(-50, min(50, int(velocidad_pct)))
    tono = TONO_BASE.get(voz_id, 1.0) * e["tono"]
    if texto.rstrip().endswith("?"):
        tono *= 1.02                                       # las preguntas suben un poquito
    # pequeña variación natural por frase (siempre igual para la misma frase, así se aprovecha la caché)
    tono *= 1.0 + 0.012 * ((int(hashlib.sha1(texto.encode()).hexdigest()[:4], 16) / 65535.0) * 2 - 1)
    ritmo = e["ritmo"] / (1.0 + vel / 100.0)
    return tono, ritmo * tono, e["viveza"], e["fluidez"]


def _sintetizar_piper_sync(texto: str, voz_id: str, velocidad_pct: int, emocion: str = "neutro") -> bytes:
    import io  # noqa: PLC0415
    import wave  # noqa: PLC0415
    from piper import PiperVoice, SynthesisConfig  # noqa: PLC0415

    tono, largo, ruido, ruido_w = _parametros_voz(texto, voz_id, velocidad_pct, emocion)
    voz_id = VOCES_VIRTUALES.get(voz_id, {}).get("base", voz_id)      # la juvenil usa el modelo de Dave
    with _bloqueo_piper:
        voz = _voces_piper.get(voz_id)
        if voz is None:
            voz = PiperVoice.load(str(_archivos_piper(voz_id)[0]))
            _voces_piper[voz_id] = voz
        cfg = SynthesisConfig(length_scale=largo, noise_scale=ruido, noise_w_scale=ruido_w)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            voz.synthesize_wav(texto, w, syn_config=cfg)
        datos = buf.getvalue()
    return _subir_tono(datos, tono)


async def sintetizar_piper(texto: str, voz_id: str, velocidad_pct: int = 0, emocion: str = "neutro") -> bytes:
    if not piper_disponible():
        raise ErrorVoz("Piper no está instalado (pip install piper-tts).", 501)
    base = VOCES_VIRTUALES.get(voz_id, {}).get("base", voz_id)
    if base not in _PIPER_POR_ID:
        raise ErrorVoz("Esa voz no está en mi lista.", 400)
    if not piper_instalada(base):
        raise ErrorVoz("Esa voz sin internet todavía no está descargada.", 409)
    try:
        datos = await asyncio.wait_for(asyncio.to_thread(_sintetizar_piper_sync, texto, voz_id, velocidad_pct, emocion), timeout=30)
    except ErrorVoz:
        raise
    except Exception as e:  # noqa: BLE001
        raise ErrorVoz("No pude generar la voz sin internet.") from e
    if len(datos) < 200:
        raise ErrorVoz("La voz sin internet no devolvió audio.")
    return datos


async def _respaldo_sin_internet(limpio: str, velocidad: int, preferida: str | None = None):
    """Última red de seguridad antes de la voz de Windows: Piper, si hay alguna voz descargada."""
    instaladas = _piper_instaladas()
    if not instaladas or not piper_disponible():
        return None
    voz = preferida if preferida in instaladas else (VOZ_PIPER_DEFECTO if VOZ_PIPER_DEFECTO in instaladas else instaladas[0])
    try:
        return await sintetizar_piper(limpio, voz, velocidad), voz
    except ErrorVoz:
        return None


async def hablar(texto: str, proveedor: str = "edge", voz: str = VOZ_RESPALDO, tono: int = 0,
                 velocidad: int = 0, emocion: str = "neutro") -> tuple[bytes, str, str | None, str]:
    """Devuelve (audio, proveedor usado, aviso, tipo mime).
    Cadena de respaldo: ElevenLabs -> voz gratuita (Edge) -> voz sin internet (Piper) -> (la interfaz usa la voz de Windows)."""
    limpio = limpiar_para_voz(texto)
    if not limpio:
        raise ErrorVoz("No hay nada que decir.", 400)
    aviso = None

    # --- ElevenLabs
    if proveedor == "elevenlabs":
        cfg = leer_config()
        clave, vid = cfg.get("elevenlabs_clave", ""), cfg.get("elevenlabs_voice_id", "")
        modelo = cfg.get("elevenlabs_modelo", "eleven_flash_v2_5")
        if not clave or not vid:
            aviso = "Falta la clave o el ID de voz de ElevenLabs; usé la voz gratuita."
        else:
            k = hashlib.sha1(json.dumps(["el", vid, modelo, limpio]).encode()).hexdigest()
            if (hit := _cache_get(k)):
                return hit[0], "elevenlabs", None, hit[2]
            try:
                audio = await sintetizar_elevenlabs(limpio, vid, clave, modelo)
                _cache_set(k, (audio, "elevenlabs", MIME_MP3))
                return audio, "elevenlabs", None, MIME_MP3
            except ErrorVoz as e:
                aviso = f"{e.mensaje} Usé la voz gratuita."
        if piper_disponible() and piper_instalada(VOZ_PIPER_DEFECTO):
            proveedor, voz = "piper", VOZ_PIPER_DEFECTO                 # respaldo preferido: Dave, que no necesita internet
            aviso = aviso.replace("Usé la voz gratuita.", "Usé la voz sin internet.")
        else:
            voz, tono, velocidad, proveedor = VOZ_RESPALDO, 0, 0, "edge"

    # --- Piper (sin internet)
    if proveedor == "piper":
        k = hashlib.sha1(json.dumps(["piper", voz, velocidad, emocion, limpio]).encode()).hexdigest()
        if (hit := _cache_get(k)):
            return hit[0], "piper", aviso, hit[2]
        audio = await (sintetizar_piper(limpio, voz, velocidad, emocion) if emocion != "neutro" else sintetizar_piper(limpio, voz, velocidad))
        _cache_set(k, (audio, "piper", MIME_WAV))
        return audio, "piper", aviso, MIME_WAV

    # --- voz gratuita en línea (Edge)
    k = hashlib.sha1(json.dumps(["edge", voz, tono, velocidad, limpio]).encode()).hexdigest()
    if (hit := _cache_get(k)):
        return hit[0], "edge", aviso, hit[2]
    try:
        audio = await sintetizar_edge(limpio, voz, tono, velocidad)
    except ErrorVoz as e:
        if e.codigo == 400:
            raise
        sin_red = await _respaldo_sin_internet(limpio, velocidad)
        if not sin_red:
            raise
        audio_p, voz_p = sin_red
        aviso = (aviso + " " if aviso else "") + "No hay internet; usé la voz sin conexión."
        return audio_p, "piper", aviso, MIME_WAV
    _cache_set(k, (audio, "edge", MIME_MP3))
    return audio, "edge", aviso, MIME_MP3


# ------------------------------------------------------------------ escuchar (faster-whisper, local)
STT_MODELO_PEDIDO = os.environ.get("LYFAN_STT_MODELO", "").strip()   # vacío = automático (GPU: large-v3-turbo; CPU: small)
STT_MODELO = STT_MODELO_PEDIDO or "large-v3-turbo"
_stt_dispositivo = "cpu"
_modelo_stt = None
_bloqueo_stt = threading.Lock()
_FRASES_FANTASMA = (
    "subtitulos realizados por", "subtítulos realizados por", "amara.org", "gracias por ver", "suscríbete",
    "suscribete", "no olvides suscribirte", "música", "musica",
)


# Pista de vocabulario: ayuda a que el modelo escriba bien el nombre del robot y las marcas
_PISTA = ("Conversación en español con LyFan, un asistente que protege de estafas y phishing. "
          "Palabras frecuentes: LyFan, Yape, Plin, BCP, SUNAT, WhatsApp, Gmail, enlace, código de verificación, "
          "contraseña, bóveda, cifrar, descifrar, archivo, carpeta, analiza, revisa, escanea.")
_HOTWORDS = "LyFan Yape Plin SUNAT WhatsApp Gmail bóveda cifra cifrar encripta encriptar descifra descifrar phishing"
_UMBRAL_SIN_VOZ = 0.55
_RE_NOMBRE = re.compile(r"(?i)\b(?:(?:el|ele|l)\s+)?(?:i|y|ye)\s*griega\s*fan\b|\b(?:ly|li|lai|lay|lei|leif)\s?f[aá]n\b|\bly\s?phan\b|\blyf[aá]n\b|\blaif[aá]n\b")


def estado_transcriptor() -> dict:
    try:
        import faster_whisper  # noqa: F401, PLC0415
        return {"disponible": True, "modelo": STT_MODELO, "cargado": _modelo_stt is not None, "dispositivo": _stt_dispositivo}
    except Exception:  # noqa: BLE001
        return {"disponible": False, "modelo": STT_MODELO, "cargado": False}


def _preparar_cuda() -> None:
    """Windows: deja que ctranslate2 encuentre las DLL de CUDA instaladas con pip (nvidia-cublas-cu12, nvidia-cudnn-cu12)."""
    try:
        import nvidia  # noqa: PLC0415
        bases = list(getattr(nvidia, "__path__", []))
    except Exception:  # noqa: BLE001
        return
    for base in bases:
        for sub in Path(base).glob("*/bin"):
            try:
                os.add_dll_directory(str(sub))
            except (OSError, AttributeError):
                pass
            os.environ["PATH"] = str(sub) + os.pathsep + os.environ.get("PATH", "")


def _hay_gpu() -> bool:
    try:
        import ctranslate2  # noqa: PLC0415
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:  # noqa: BLE001
        return False


def _cargar_stt():
    """GPU (float16) si hay tarjeta NVIDIA y sus librerías; si falla, CPU (int8) con un modelo más liviano."""
    global _modelo_stt, _stt_dispositivo, STT_MODELO
    with _bloqueo_stt:
        if _modelo_stt is None:
            from faster_whisper import WhisperModel  # noqa: PLC0415
            _preparar_cuda()
            if _hay_gpu():
                try:
                    _modelo_stt = WhisperModel(STT_MODELO, device="cuda", compute_type="float16")
                    _stt_dispositivo = "cuda"
                    # prueba mínima: algunas DLL faltantes solo fallan al transcribir
                    import numpy as np  # noqa: PLC0415
                    list(_modelo_stt.transcribe(np.zeros(16000, dtype="float32"), language="es")[0])
                except Exception:  # noqa: BLE001
                    _modelo_stt = None
            if _modelo_stt is None:
                if not STT_MODELO_PEDIDO:
                    STT_MODELO = "small"
                _modelo_stt = WhisperModel(STT_MODELO, device="cpu", compute_type="int8")
                _stt_dispositivo = "cpu"
    return _modelo_stt


def precargar_transcriptor() -> None:
    """Carga el modelo en segundo plano para que la primera frase no espere."""
    def tarea():
        try:
            _cargar_stt()
        except Exception:  # noqa: BLE001
            pass
    threading.Thread(target=tarea, daemon=True).start()


def _segmento_dudoso(no_speech_prob: float, avg_logprob: float) -> bool:
    """Descarta lo que el modelo no oyó con seguridad (ruido, eco, murmullos) en vez de inventar una frase."""
    return (no_speech_prob > _UMBRAL_SIN_VOZ and avg_logprob < -0.8) or avg_logprob < -1.6 or (
        no_speech_prob > 0.8)


def _transcribir_sync(datos: bytes, sufijo: str) -> dict:
    modelo = _cargar_stt()
    with tempfile.NamedTemporaryFile(delete=False, suffix=sufijo) as f:
        f.write(datos)
        ruta = f.name
    try:
        segmentos, info = modelo.transcribe(
            ruta, language="es", beam_size=5, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 300},
            condition_on_previous_text=False, initial_prompt=_PISTA, hotwords=_HOTWORDS,
            temperature=[0.0, 0.2, 0.4])
        partes = []
        for s in segmentos:
            if _segmento_dudoso(s.no_speech_prob, s.avg_logprob):
                continue
            partes.append(s.text.strip())
        texto = " ".join(p for p in partes if p).strip()
        if any(fr in texto.lower() for fr in _FRASES_FANTASMA) and len(texto) < 70:
            texto = ""
        texto = _RE_NOMBRE.sub("LyFan", texto)
        return {"texto": texto, "duracion": round(info.duration, 2)}
    finally:
        try:
            os.unlink(ruta)
        except OSError:
            pass


async def transcribir(datos: bytes, tipo: str = "audio/webm") -> dict:
    if not estado_transcriptor()["disponible"]:
        raise ErrorVoz("El reconocimiento de voz no está instalado (pip install faster-whisper).", 501)
    if len(datos) < 800:
        return {"texto": "", "duracion": 0}
    sufijo = ".wav" if "wav" in tipo else ".ogg" if "ogg" in tipo else ".mp4" if "mp4" in tipo else ".webm"
    try:
        return await asyncio.to_thread(_transcribir_sync, datos, sufijo)
    except ErrorVoz:
        raise
    except Exception as e:  # noqa: BLE001
        raise ErrorVoz("No pude entender el audio. Intenta de nuevo.", 422) from e

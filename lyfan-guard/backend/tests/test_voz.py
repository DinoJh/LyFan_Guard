"""Pruebas de la voz que no necesitan internet ni micrófono."""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import voz  # noqa: E402


@pytest.fixture(autouse=True)
def datos_temporales(tmp_path, monkeypatch):
    monkeypatch.setattr(voz, "DIR_DATOS", tmp_path)
    monkeypatch.setattr(voz, "ARCHIVO_CONFIG", tmp_path / "voz.json")
    monkeypatch.setattr(voz, "DIR_PIPER", tmp_path / "piper")   # en las pruebas no hay voces descargadas
    voz._cache.clear()


def test_limpiar_quita_markdown_enlaces_y_emojis():
    t = voz.limpiar_para_voz("**Cuidado** 😀 entra a http://bcp-premios.xyz/x o a bit.ly/abc ahora")
    assert "http" not in t and "bit.ly" not in t and "*" not in t and "😀" not in t
    assert t.count("un enlace") == 2


def test_limpiar_limita_el_largo():
    t = voz.limpiar_para_voz("Hola. " * 400)
    assert len(t) <= voz.MAX_TEXTO


def test_config_nunca_devuelve_la_clave_completa():
    clave = "sk_" + "a1b2c3d4" * 4
    voz.guardar_config(clave, "21m00Tcm4TlvDq8ikWAM", "eleven_flash_v2_5")
    pub = voz.config_publica()["elevenlabs"]
    assert pub["configurado"] and pub["tiene_clave"] and pub["clave_fin"] == "…" + clave[-4:]
    assert clave not in str(voz.config_publica())
    assert (voz.ARCHIVO_CONFIG).exists()


def test_borrar_clave():
    voz.guardar_config("sk_" + "z" * 30, "21m00Tcm4TlvDq8ikWAM")
    voz.guardar_config(borrar_clave=True)
    assert not voz.config_publica()["elevenlabs"]["tiene_clave"]


def test_rechaza_id_o_clave_con_caracteres_raros():
    with pytest.raises(voz.ErrorVoz):
        voz.guardar_config(voice_id="../../etc/passwd")
    with pytest.raises(voz.ErrorVoz):
        voz.guardar_config(clave="clave con espacios y simbolos <script>")


def test_voz_edge_desconocida_se_rechaza():
    with pytest.raises(voz.ErrorVoz):
        asyncio.run(voz.sintetizar_edge("hola", "es-PE-NoExisteNeural"))


def test_si_elevenlabs_falla_cae_a_la_voz_gratuita(monkeypatch):
    voz.guardar_config("sk_" + "q" * 30, "21m00Tcm4TlvDq8ikWAM")

    async def eleven_mal(*a, **k):
        raise voz.ErrorVoz("La clave de ElevenLabs no es válida o venció.")

    async def edge_bien(texto, v, t=0, vel=0):
        return b"MP3-GRATIS"

    monkeypatch.setattr(voz, "sintetizar_elevenlabs", eleven_mal)
    monkeypatch.setattr(voz, "sintetizar_edge", edge_bien)
    audio, usado, aviso, _mime = asyncio.run(voz.hablar("Hola", "elevenlabs"))
    assert audio == b"MP3-GRATIS" and usado == "edge" and "no es válida" in aviso


def test_elevenlabs_sin_configurar_usa_gratuita(monkeypatch):
    async def edge_bien(texto, v, t=0, vel=0):
        return b"X"
    monkeypatch.setattr(voz, "sintetizar_edge", edge_bien)
    audio, usado, aviso, _mime = asyncio.run(voz.hablar("Hola", "elevenlabs"))
    assert usado == "edge" and "Falta la clave" in aviso


def test_elevenlabs_correcto_no_avisa_y_usa_cache(monkeypatch):
    voz.guardar_config("sk_" + "k" * 30, "21m00Tcm4TlvDq8ikWAM")
    llamadas = []

    async def eleven_bien(texto, vid, clave, modelo):
        llamadas.append(1)
        return b"MP3-ELEVEN"

    monkeypatch.setattr(voz, "sintetizar_elevenlabs", eleven_bien)
    for _ in range(2):
        audio, usado, aviso, _mime = asyncio.run(voz.hablar("Hola de nuevo", "elevenlabs"))
        assert usado == "elevenlabs" and aviso is None
    assert len(llamadas) == 1   # la segunda vez sale de la caché


def test_texto_vacio_o_solo_emojis():
    with pytest.raises(voz.ErrorVoz):
        asyncio.run(voz.hablar("😀😀", "edge"))


# ---------------------------------------------------------------- voz sin internet (Piper)
def test_sin_internet_edge_cae_a_piper(monkeypatch):
    async def edge_mal(*a, **k):
        raise voz.ErrorVoz("No pude generar la voz gratuita (¿hay internet?).")

    async def piper_bien(texto, v, vel=0):
        return b"RIFF-WAV"

    monkeypatch.setattr(voz, "sintetizar_edge", edge_mal)
    monkeypatch.setattr(voz, "sintetizar_piper", piper_bien)
    monkeypatch.setattr(voz, "_piper_instaladas", lambda: ["es_MX-claude-high"])
    monkeypatch.setattr(voz, "piper_disponible", lambda: True)
    audio, usado, aviso, mime = asyncio.run(voz.hablar("Hola sin red", "edge"))
    assert usado == "piper" and mime == "audio/wav" and "sin conexión" in aviso


def test_sin_internet_ni_piper_deja_el_error_para_la_voz_de_windows(monkeypatch):
    async def edge_mal(*a, **k):
        raise voz.ErrorVoz("No pude generar la voz gratuita (¿hay internet?).")

    monkeypatch.setattr(voz, "sintetizar_edge", edge_mal)
    monkeypatch.setattr(voz, "_piper_instaladas", lambda: [])
    with pytest.raises(voz.ErrorVoz):
        asyncio.run(voz.hablar("Hola sin red", "edge"))


def test_elevenlabs_sin_internet_cae_a_edge_y_luego_a_piper(monkeypatch):
    voz.guardar_config("sk_" + "w" * 30, "21m00Tcm4TlvDq8ikWAM")

    async def mal(*a, **k):
        raise voz.ErrorVoz("No pude conectarme con ElevenLabs (¿hay internet?).")

    async def piper_bien(texto, v, vel=0):
        return b"WAV"

    monkeypatch.setattr(voz, "sintetizar_elevenlabs", mal)
    monkeypatch.setattr(voz, "sintetizar_edge", mal)
    monkeypatch.setattr(voz, "sintetizar_piper", piper_bien)
    monkeypatch.setattr(voz, "_piper_instaladas", lambda: ["es_ES-davefx-medium"])
    monkeypatch.setattr(voz, "piper_disponible", lambda: True)
    audio, usado, aviso, mime = asyncio.run(voz.hablar("Hola", "elevenlabs"))
    assert usado == "piper" and "ElevenLabs" in aviso and "sin conexión" in aviso


def test_piper_no_descargada_o_desconocida(monkeypatch):
    monkeypatch.setattr(voz, "piper_disponible", lambda: True)
    with pytest.raises(voz.ErrorVoz) as e1:
        asyncio.run(voz.sintetizar_piper("hola", "es_XX-inventada-high"))
    assert e1.value.codigo == 400
    monkeypatch.setattr(voz, "piper_instalada", lambda v: False)
    with pytest.raises(voz.ErrorVoz) as e2:
        asyncio.run(voz.sintetizar_piper("hola", "es_ES-davefx-medium"))
    assert e2.value.codigo == 409


def test_catalogo_piper_tiene_ruta_y_tamano():
    for v in voz.VOCES_PIPER:
        assert v["ruta"].endswith(v["id"]) and v["mb"] > 0
    assert any(v["id"] == voz.VOZ_PIPER_DEFECTO for v in voz.VOCES_PIPER)


def test_elevenlabs_que_falla_cae_primero_a_dave_si_esta_descargada(monkeypatch):
    voz.guardar_config("sk_" + "d" * 30, "21m00Tcm4TlvDq8ikWAM")

    async def eleven_mal(*a, **k):
        raise voz.ErrorVoz("La clave de ElevenLabs no es válida o venció.")

    async def piper_bien(texto, v, vel=0):
        return b"WAV-DAVE"

    async def edge_no_debe_usarse(*a, **k):
        raise AssertionError("no debía usar la voz en línea")

    monkeypatch.setattr(voz, "sintetizar_elevenlabs", eleven_mal)
    monkeypatch.setattr(voz, "sintetizar_piper", piper_bien)
    monkeypatch.setattr(voz, "sintetizar_edge", edge_no_debe_usarse)
    monkeypatch.setattr(voz, "piper_disponible", lambda: True)
    monkeypatch.setattr(voz, "piper_instalada", lambda v: True)
    audio, usado, aviso, mime = asyncio.run(voz.hablar("Hola", "elevenlabs"))
    assert audio == b"WAV-DAVE" and usado == "piper" and mime == "audio/wav" and "sin internet" in aviso


def test_el_catalogo_tiene_a_dave_y_la_juvenil_sale_de_dave():
    assert [v["id"] for v in voz.VOCES_PIPER] == ["es_ES-davefx-medium"]
    assert voz.VOCES_VIRTUALES["lyfan-juvenil"]["base"] == "es_ES-davefx-medium"


def test_emociones_cambian_tono_y_ritmo():
    neutro = voz._parametros_voz("Hola.", "lyfan-juvenil", 0, "neutro")
    alegre = voz._parametros_voz("Hola.", "lyfan-juvenil", 0, "alegre")
    alerta = voz._parametros_voz("Hola.", "lyfan-juvenil", 0, "alerta")
    dave = voz._parametros_voz("Hola.", "es_ES-davefx-medium", 0, "neutro")
    assert alegre[0] > neutro[0] > alerta[0]           # más agudo cuando está alegre, más grave en alerta
    assert neutro[0] > dave[0]                         # la juvenil es más aguda que Dave
    assert alegre[2] > alerta[2]                       # más viva al estar alegre


def test_subir_tono_mantiene_wav_valido():
    import io
    import wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050); w.writeframes(b"\x00\x10" * 22050)
    out = voz._subir_tono(buf.getvalue(), 1.1)
    with wave.open(io.BytesIO(out)) as r:
        assert r.getframerate() == 24000 and abs(r.getnframes() / 24000 - 1 / 1.1) < 0.01


def test_segmentos_dudosos_se_descartan_y_los_claros_se_conservan():
    assert voz._segmento_dudoso(0.9, -0.3)          # casi seguro que no era voz
    assert voz._segmento_dudoso(0.1, -2.0)          # el modelo no entendió nada
    assert voz._segmento_dudoso(0.7, -1.0)          # dudoso en ambos
    assert not voz._segmento_dudoso(0.05, -0.3)     # frase clara
    assert not voz._segmento_dudoso(0.3, -0.9)      # un poco incierta pero válida

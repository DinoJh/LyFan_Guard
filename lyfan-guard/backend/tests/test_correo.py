"""Pruebas del correo (sin internet): credenciales, inicio de sesión seguro y análisis de correos simulados."""
import base64
import json
import sys
import urllib.parse
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import correo, voz  # noqa: E402

CRED = {"installed": {"client_id": "123-abc.apps.googleusercontent.com", "client_secret": "secreto-de-prueba",
                      "redirect_uris": ["http://localhost"]}}


@pytest.fixture(autouse=True)
def datos(tmp_path, monkeypatch):
    monkeypatch.setattr(voz, "DIR_DATOS", tmp_path)
    monkeypatch.setattr(correo, "_dpapi", lambda d, proteger: d[::-1])   # sin Windows: «cifrado» reversible de prueba


def _b64(t: str) -> str:
    return base64.urlsafe_b64encode(t.encode()).decode().rstrip("=")


def _mensaje(de, asunto, cuerpo_html="", cuerpo_txt="", adjuntos=(), auth="spf=pass"):
    partes = []
    if cuerpo_txt:
        partes.append({"mimeType": "text/plain", "body": {"data": _b64(cuerpo_txt)}})
    if cuerpo_html:
        partes.append({"mimeType": "text/html", "body": {"data": _b64(cuerpo_html)}})
    for a in adjuntos:
        partes.append({"mimeType": "application/octet-stream", "filename": a, "body": {"attachmentId": "x"}})
    return {"id": "m1", "internalDate": "1700000000000", "snippet": "",
            "payload": {"mimeType": "multipart/mixed", "parts": partes,
                        "headers": [{"name": "From", "value": de}, {"name": "Subject", "value": asunto},
                                    {"name": "Authentication-Results", "value": auth}]}}


def test_credenciales_validas_y_rechazo_de_otras():
    with pytest.raises(correo.ErrorCorreo):
        correo.guardar_credenciales("no es json")
    with pytest.raises(correo.ErrorCorreo):
        correo.guardar_credenciales(json.dumps({"web": CRED["installed"]}))
    est = correo.guardar_credenciales(json.dumps(CRED))
    assert est["credenciales"] and not est["conectado"]


def test_url_de_google_pide_solo_lectura_y_usa_pkce():
    correo.guardar_credenciales(json.dumps(CRED))
    url = correo.url_autorizacion("http://127.0.0.1:8765/api/correo/oauth")
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert url.startswith("https://accounts.google.com/")
    assert q["scope"] == ["https://www.googleapis.com/auth/gmail.readonly"]
    assert q["code_challenge_method"] == ["S256"] and len(q["code_challenge"][0]) >= 43
    with pytest.raises(correo.ErrorCorreo):           # un «state» que LyFan no pidió se rechaza
        correo.completar("codigo", "state-inventado")


def test_correo_falso_del_bcp_es_peligro():
    m = _mensaje("BCP Seguridad <alertas@bcp-seguridad.xyz>", "Su cuenta será bloqueada hoy",
                 cuerpo_html='<p>Ingrese <a href="http://bcp-seguridad.xyz/login">aquí</a> para validar su clave y token.</p>')
    r = correo.analizar_correo(correo.leer_mensaje(m))
    assert r["nivel"] == "peligro" and any("BCP" in x for x in r["razones"])


def test_adjunto_peligroso_y_spf_fallido():
    m = _mensaje("Facturas <pagos@empresa-rara.com>", "Factura pendiente", cuerpo_txt="Adjuntamos su factura.",
                 adjuntos=["factura.pdf.exe"], auth="spf=fail")
    r = correo.analizar_correo(correo.leer_mensaje(m))
    assert r["nivel"] == "peligro" and any("adjunto" in x for x in r["razones"])


def test_correo_normal_queda_tranquilo():
    m = _mensaje("Ana <ana@gmail.com>", "Reunión del lunes", cuerpo_txt="Hola, nos vemos el lunes a las 10 en la biblioteca.")
    assert correo.analizar_correo(correo.leer_mensaje(m))["nivel"] == "tranquilo"


def test_token_guardado_protegido_y_desconectar(monkeypatch):
    correo._guardar_token({"refresh_token": "r-123", "cuenta": "yo@gmail.com"})
    assert b"r-123" not in correo._ruta_token().read_bytes()           # no queda en texto plano
    assert correo.estado()["conectado"] and correo.estado()["cuenta"] == "yo@gmail.com"
    monkeypatch.setattr(correo.httpx, "post", lambda *a, **k: None)     # sin internet en la prueba
    assert not correo.desconectar()["conectado"]

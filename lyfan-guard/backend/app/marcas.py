"""Marcas e instituciones que los estafadores suelen suplantar en el Perú.

IMPORTANTE: los dominios oficiales deben revisarse antes de la presentación final
(entrar a cada sitio oficial y confirmar el dominio). Esta lista es el punto de partida.
"""

# clave: nombre que se muestra al usuario
# alias: palabras con las que se nombra la marca dentro de un mensaje o de un dominio
# dominios: dominios oficiales (un subdominio de estos también es oficial)
MARCAS = {
    "Yape": {"alias": ["yape"], "dominios": ["yape.com.pe"]},
    "Plin": {"alias": ["plin"], "dominios": ["plin.pe"]},
    "BCP": {"alias": ["bcp", "viabcp"], "dominios": ["viabcp.com", "bcp.com.pe"]},
    "BBVA": {"alias": ["bbva"], "dominios": ["bbva.pe"]},
    "Interbank": {"alias": ["interbank"], "dominios": ["interbank.pe"]},
    "Scotiabank": {"alias": ["scotiabank"], "dominios": ["scotiabank.com.pe"]},
    "Banco de la Nación": {"alias": ["banco de la nacion"], "dominios": ["bn.com.pe"]},
    "SUNAT": {"alias": ["sunat"], "dominios": ["sunat.gob.pe"]},
    "RENIEC": {"alias": ["reniec"], "dominios": ["reniec.gob.pe"]},
    "Mercado Libre": {"alias": ["mercadolibre", "mercado libre"], "dominios": ["mercadolibre.com.pe", "mercadolibre.com"]},
    "Entel": {"alias": ["entel"], "dominios": ["entel.pe"]},
    "Claro": {"alias": ["claro"], "dominios": ["claro.com.pe"]},
    "Movistar": {"alias": ["movistar"], "dominios": ["movistar.com.pe"]},
    "Bitel": {"alias": ["bitel"], "dominios": ["bitel.com.pe"]},
}

# Alias que NO se buscan en el texto de un mensaje porque son palabras comunes del español
# (por ejemplo "claro que sí"). Sí se usan al revisar dominios.
ALIAS_SOLO_DOMINIO = {"claro"}

ACORTADORES = {
    "bit.ly", "tinyurl.com", "cutt.ly", "t.ly", "is.gd", "shorturl.at", "rb.gy",
    "goo.gl", "ow.ly", "tiny.cc", "n9.cl", "acortar.link",
}

TLD_RIESGO = {
    "xyz", "top", "click", "icu", "live", "site", "online", "shop", "vip", "club",
    "buzz", "work", "support", "cyou", "rest", "fit", "monster", "tk", "ml", "ga", "cf", "gq",
    "link", "cam", "zip", "mov",
}

# Terminaciones que se aceptan como dominio al escribir un enlace sin "http"
TLD_CONOCIDOS = TLD_RIESGO | {
    "com", "pe", "net", "org", "gob", "edu", "info", "co", "io", "app", "me", "cc", "ly", "gl", "ar", "mx", "es",
}

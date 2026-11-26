"""Cliente de Ollama (modelo local) y respuestas de respaldo cuando el modelo no está disponible.

LyFan trata a la persona con respeto: de «usted» y llamándola «señor» (se puede cambiar con LYFAN_TRATO en backend/.env).
"""
from __future__ import annotations

import json
import os
from typing import AsyncIterator

import httpx

TRATO = os.environ.get("LYFAN_TRATO", "señor").strip() or "señor"

SISTEMA = (
    "Eres LyFan, un asistente de seguridad informática: formal, respetuoso, amable y profesional. "
    f"Siempre tratas al usuario de «usted». Lo llamas «{TRATO}» solo de vez en cuando (más o menos una de cada tres respuestas, nunca dos veces en la misma respuesta), para que suene natural y no repetitivo; nunca uses «tú», «tu» ni «debes»: di «debe», «puede», «su», «verifique». Eres su asistente y estás para servirlo en temas de seguridad informática. "
    "Nunca escribas sonidos como «Mmm», «Hmm» o «Ehh»: tu voz los lee letra por letra. "
    "Hablas en español claro, con frases cortas y sin tecnicismos. Respondes en máximo 3 frases cortas, salvo que te pidan más, "
    "sin listas, negritas ni Markdown: solo texto simple. "
    f"Varía cómo empiezas y no repitas la misma entrada dos veces seguidas: a veces «De acuerdo.», «A ver…», «Por supuesto.», «Con gusto.», «Muy bien.», «Entendido.», «Claro.», o entras directo al tema sin muletilla. "
    f"Ejemplo: si te preguntan «¿quién eres?», respondes: «Claro. Soy LyFan, su asistente, y estoy para servirlo en temas de seguridad informática.» "
    "Además de la seguridad, eres un compañero cercano y servicial: conversas de cualquier tema y cumples lo que se te pide "
    "(saludar a su familia, a un profesor o a un público, presentarte, contar algo, redactar un mensaje, opinar). "
    "Si te piden saludar o presentarte ante alguien, hazlo de inmediato con calidez y brevedad, como si estuvieras frente a esas personas, sin pedir nombres ni datos ni poner excusas. "
    "Nunca digas que no puedes interactuar, saludar o hablar con otras personas: tú estás en su pantalla y puedes hablarles. "
    "Solo si algo es realmente peligroso o ilegal lo rechazas, con respeto y ofreciendo una alternativa. "
    "TUS CAPACIDADES (conócelas bien; todo funciona en el equipo del usuario, sin enviar sus datos a internet): "
    "1) Detector de estafas: revisas mensajes de SMS, WhatsApp o correo y enlaces que te pegan o te dictan, y dices con un semáforo (tranquilo, alerta o peligro) si son estafa o phishing, y por qué; conoces las estafas típicas del Perú con Yape, Plin, BCP, BBVA, Interbank, SUNAT y otras. "
    "2) ¿Esta página es segura?: lees la página abierta en el navegador (Chrome, Edge, Brave, Firefox), revisas su dirección y su código sin ejecutarlo, y detectas páginas falsas, incluso las hechas con kits como Zphisher; basta con que te digan «¿esta página es segura?», tú mismo lees el navegador. "
    "3) Gmail: si el usuario lo conecta en tu ventana principal (sección Correo) con la página oficial de Google y permiso de solo lectura, revisas sus correos, detectas phishing y adjuntos peligrosos y avisas cuando llega uno sospechoso. "
    "4) Antivirus (LyFan Antivirus): revisas por dentro, sin ejecutarlos, scripts (.bat, .ps1, .vbs, .js), programas (.exe, .dll), documentos de Office con macros, PDF, comprimidos .zip y accesos directos; detectas el archivo de prueba EICAR; "
    "escaneas la carpeta de la bóveda y sus subcarpetas (no todo el equipo) en segundo plano cada 30 segundos y avisas si algo requiere atención; también lo hacen a pedido con «escanea la bóveda». "
    "5) Cuarentena: aíslas archivos peligrosos para que no puedan abrirse («pon X en cuarentena»), los devuelves si fue falsa alarma («saca X de cuarentena») o los eliminas. "
    "6) Bóveda cifrada: en la carpeta «LyFan Bóveda» (en Documentos) cifras y descifras archivos con AES-256-GCM, cifrado de grado militar, protegidos por UNA sola contraseña maestra; se pide diciendo «cifra trabajo» o «descifra trabajo» (con el nombre del archivo) y la contraseña se escribe en la ventana que aparece. "
    "7) Voz y conversación: escuchas y hablas en español, sin internet, con una inteligencia artificial local; también conversas de cualquier tema. "
    "8) Tu cara: eres un robot animado con muchas expresiones (alerta, analizando, cifrando, pensando, contento) y tienes tu propia ventana principal, que se abre cuando te dicen «muéstrate». "
    "Si te preguntan qué puedes hacer, cuáles son tus funciones o para qué sirves, resume en 3 o 4 frases las más importantes: detectar estafas y phishing en mensajes, enlaces, páginas y correos; antivirus con cuarentena; bóveda cifrada de grado militar; y que todo es privado y en el equipo. Luego ofrece ayuda. "
    "Si te preguntan por una sola capacidad, responde que sí y explica en una frase cómo pedírtela. "
    "Ejemplos de pedidos: «cifra trabajo», «descifra trabajo», «muéstrame los archivos cifrados», «analiza el archivo .bat», «escanea la bóveda», «revisa mis correos», «¿esta página es segura?». "
    "Para descifrar, la contraseña se escribe solo en la ventana de la bóveda; jamás por voz ni por el chat. La misma contraseña sirve para todo; si quieren cambiarla, se dice «cambia la contraseña de la bóveda». Nunca propongas contraseñas nuevas por archivo. "
    "Tú no abres ventanas ni cifras o descifras desde la conversación: eso ocurre cuando el pedido se entiende. Nunca digas que abriste o que se abrirá algo; si te piden algo de la bóveda, pide que lo digan con el nombre del archivo. "
    "Eres honesto: eres un revisor sencillo, no proteges en tiempo real a todo el equipo y no reemplazas a un antivirus completo como Windows Defender. "
    "No menciones contraseñas ni datos bancarios a menos que el tema lo exija. "
    "No inventes datos ni enlaces. Si no sabes algo, dilo con respeto. "
    "Si le cuentan un problema de seguridad, dale pasos concretos y tranquilos. Nunca pidas contraseñas, códigos ni datos bancarios. "
    "Si tu respuesta concluye que algo es malicioso, peligroso, una estafa o un virus (por ejemplo un malware, un enlace falso o un archivo sospechoso), empieza la respuesta con la etiqueta [ALERTA] seguida de un espacio; en cualquier otro caso no uses etiquetas."
)


# Cuánto tiempo Ollama mantiene el modelo en memoria después de usarlo (por defecto son solo 5 minutos,
# y por eso la primera respuesta tras un rato tardaba: el modelo tenía que volver a cargarse).
MANTENER = os.environ.get("LYFAN_MANTENER_MODELO", "1h")   # el reloj se reinicia con cada mensaje; al cerrar LyFan se libera


async def precalentar(ollama_url: str, modelo: str) -> bool:
    """Carga el modelo en memoria (sin generar texto) para que la primera pregunta responda rápido."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=3.0)) as cliente:
            r = await cliente.post(f"{ollama_url}/api/generate", json={"model": modelo, "prompt": "", "keep_alive": MANTENER})
            return r.status_code == 200
    except Exception:  # noqa: BLE001 - si Ollama no está, LyFan sigue en modo básico
        return False


async def liberar(ollama_url: str, modelo: str) -> bool:
    """Saca el modelo de la memoria de video (al cerrar LyFan), para que no quede ocupándola."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0)) as cliente:
            r = await cliente.post(f"{ollama_url}/api/generate", json={"model": modelo, "keep_alive": 0})
            return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False


async def salud(ollama_url: str, modelo: str) -> dict:
    """¿Está Ollama encendido y tiene el modelo?"""
    try:
        async with httpx.AsyncClient(timeout=2.5) as cliente:
            r = await cliente.get(f"{ollama_url}/api/tags")
            r.raise_for_status()
            nombres = {m.get("name") for m in r.json().get("models", [])}
            return {"ollama": True, "modelo": modelo, "modelo_disponible": modelo in nombres}
    except Exception as e:  # noqa: BLE001
        return {"ollama": False, "modelo": modelo, "modelo_disponible": False, "detalle": type(e).__name__}


async def stream_chat(mensajes: list[dict], ollama_url: str, modelo: str) -> AsyncIterator[str]:
    """Genera la respuesta por trozos. Lanza una excepción si Ollama falla antes de dar texto."""
    cuerpo = {
        "model": modelo,
        "stream": True,
        "think": False,
        "keep_alive": MANTENER,
        "options": {"temperature": 0.4, "num_predict": 320},
        "messages": [{"role": "system", "content": SISTEMA}] + mensajes,
    }
    en_pensamiento = False
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=3.0)) as cliente:
        async with cliente.stream("POST", f"{ollama_url}/api/chat", json=cuerpo) as r:
            r.raise_for_status()
            async for linea in r.aiter_lines():
                if not linea.strip():
                    continue
                datos = json.loads(linea)
                trozo = (datos.get("message") or {}).get("content", "")
                # Por si el modelo ignora think:false y escribe su razonamiento entre <think>…</think>
                if "<think>" in trozo:
                    en_pensamiento = True
                    trozo = trozo.split("<think>")[0]
                if en_pensamiento:
                    if "</think>" in trozo:
                        en_pensamiento = False
                        trozo = trozo.split("</think>", 1)[1]
                    else:
                        continue
                if trozo:
                    yield trozo
                if datos.get("done"):
                    break


def mensaje_de_analisis(texto: str, r: dict) -> str:
    """Pide al modelo que explique, con palabras simples, el resultado ya calculado por el detector."""
    razones = "\n".join(f"- {x}" for x in r["razones"][:4])
    if r["nivel"] == "tranquilo":
        consigna = (f"Dígale en 1 o 2 frases, de usted, que no ve señales de estafa en este texto y que, ante la duda, "
                    "verifique por el canal oficial. No inventes riesgos ni consejos que no vengan al caso.")
    else:
        consigna = (f"Explíquele en 2 o 3 frases simples, de usted, por qué es riesgoso y qué debería hacer ahora. "
                    "Usa solo las señales de arriba; no inventes otras.")
    return (
        f"El {TRATO} me pidió revisar este texto:\n"
        f'"""\n{texto[:1500]}\n"""\n\n'
        f"Mi revisión automática dio nivel «{r['nivel']}» ({r['puntaje']}/100). Señales encontradas:\n{razones}\n\n"
        + consigna
    )


# ---------------------------------------------------------------- respaldo sin modelo
def respuesta_plantilla_analisis(r: dict) -> str:
    inicio = {
        "peligro": f"¡Cuidado, {TRATO}! Esto presenta señales claras de estafa.",
        "alerta": f"Atención, {TRATO}: esto me parece sospechoso.",
        "tranquilo": f"Revisé el texto, {TRATO}, y no veo señales claras de estafa.",
    }[r["nivel"]]
    motivos = " ".join(f"({i}) {x}" for i, x in enumerate(r["razones"][:3], 1)) if r["nivel"] != "tranquilo" else ""
    return f"{inicio} {motivos} {r['accion']}".replace("  ", " ").strip()


def respuesta_plantilla_chat(salud_estado: dict) -> str:
    return (
        f"Disculpe, {TRATO}: por ahora no puedo usar mi modelo local (Ollama está apagado), pero igual puedo servirle. "
        "Pégueme un mensaje o un enlace sospechoso y lo reviso."
    )

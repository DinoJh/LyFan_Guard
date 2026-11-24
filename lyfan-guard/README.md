# LyFan Guard · MVP

Asistente local de ciberseguridad. **LyFan**, un robot flotante sin fondo, vive en tu escritorio: le escribes, te responde con un modelo local (Ollama) y, si le pegas un mensaje o un enlace, lo revisa con reglas de estafa y phishing y reacciona (tranquilo, alerta o peligro).

Puedes **escribirle o hablarle**, y LyFan responde con **voz**. El análisis y el reconocimiento de tu voz corren en tu computadora.

## Cómo probarlo

Requisitos: Python 3.10 a 3.13, Node.js 22 y [Ollama](https://ollama.com) con el modelo `qwen3.5:4b` (`ollama pull qwen3.5:4b`).

```powershell
# una sola vez
powershell -ExecutionPolicy Bypass -File .\instalar.ps1

# cada vez que quieras abrir a LyFan
powershell -ExecutionPolicy Bypass -File .\run-mvp.ps1
```

LyFan aparece abajo a la derecha, siempre encima de las demás ventanas.

| Qué | Cómo |
|---|---|
| Mover a LyFan | Arrástrelo (tome al robot) |
| Escribirle | Barra de abajo (Enter envía, Shift+Enter hace salto de línea) |
| Hablarle | Botón del micrófono (ver *Micrófono* más abajo) |
| Analizar lo que copió | Botón del portapapeles, o clic derecho > "Analizar el portapapeles" |
| Ver la conversación | Botón de la burbuja de chat |
| Silenciar la voz | Botón del altavoz |
| Configuración | Botón del **engranaje**: un menú con **Tamaño**, **Micrófono** y **Voces** |
| Ocultar / mostrar | Botón de la flecha o `Ctrl+Alt+L` |
| Menú rápido | Clic derecho sobre LyFan, o el icono de la bandeja del sistema |

LyFan se **duerme solo** tras 3 minutos sin actividad y despierta cuando le escribe, le habla o le hace clic.

Sin Ollama, LyFan entra en **modo básico**: el detector y sus respuestas de plantilla siguen funcionando.

También se puede ver la interfaz en el navegador: `cd backend` y `.\.venv\Scripts\python -m app.main`, luego abrir <http://127.0.0.1:8765/overlay.html>.

## Trato

LyFan trata a la persona con respeto: de **usted** y llamándola **«señor»** («Claro, señor. Soy LyFan, su asistente, y estoy para servirlo en temas de seguridad informática»). Se puede cambiar con `LYFAN_TRATO=señora` (u otro) en `backend\.env`.

## Configuración (botón del engranaje)

**Tamaño.** Deslizador de 50 % a 150 % o los botones Pequeño, Mediano y Grande. La ventana se adapta y recuerda el tamaño.

**Micrófono.** Tres modos:

1. **Yo lo enciendo y lo apago**: se toca el micrófono para encenderlo y se vuelve a tocar para apagarlo (también se apaga solo al callarse).
2. **Siempre encendido: responde si empiezo con «LyFan»**: ignora lo que no empiece con su nombre («LyFan, revise este enlace»); se aceptan saludos antes («oye LyFan»).
3. **Siempre encendido: responde cada vez que hablo**: responde a todo, sin nombrarlo.

En los modos 2 y 3 el botón del micrófono se pone verde mientras escucha, rojo mientras lo oye y ámbar mientras lo entiende; tocarlo lo pausa. Mientras LyFan habla o piensa no escucha (para no oírse), salvo que se marque *Poder interrumpirlo mientras habla* (mejor con audífonos). Se ajustan la **sensibilidad** y la **espera al callarse** (de 0,6 a 2 s), y hay un botón **Probar micrófono**. Si se oculta a LyFan, el micrófono se pausa solo. Todo se transcribe en el equipo (faster-whisper). Con tarjeta NVIDIA usa `large-v3-turbo` en la GPU (unos 0,4 s por frase); sin ella usa `small` en CPU. Se puede forzar otro modelo con `LYFAN_STT_MODELO` en `backend\.env`.

**Voces.** Solo dos, para mantenerlo simple:

- **Dave · España**: voz neuronal **sin internet** (Piper, 63 MB, se descarga una vez).
- **ElevenLabs**: con su clave de API y el ID de su voz (se guardan en `~\.lyfan-guard\voz.json`, fuera del proyecto y de Git, y la interfaz nunca los vuelve a mostrar completos). *Guardar y probar* la activa al instante.

Además: **volumen**, **velocidad** (en Dave), **efecto robot** (de 0 a 100) y **Probar voz**. Si ElevenLabs falla (clave vencida, sin créditos o sin internet), LyFan cambia solo a Dave y lo avisa; si tampoco está disponible, usa la voz de Windows. A las voces en línea solo se les envía la frase que va a decir, sin los enlaces.

## Bóveda (archivos cifrados)
Engranaje → **Bóveda**. La primera vez se crea una **contraseña maestra** (mínimo 8 caracteres; **si se olvida, los archivos no se pueden recuperar**). Los archivos viven en `Documentos\LyFan Bóveda` (cambiable con `LYFAN_BOVEDA`).
- **Arrastrar y soltar** un archivo sobre LyFan (o usar *Elegir archivos…*) lo copia a la bóveda; luego **Cifrar** lo guarda como `nombre.ext.lyfan` (AES-256-GCM por bloques, clave derivada con scrypt; el nombre original también va cifrado) y borra el original solo después de comprobar que se descifra bien.
- **Descifrar** devuelve el archivo original. **Analizar** revisa archivos de texto sin cifrar (números de tarjeta, contraseñas, correos y señales de estafa), todo en el equipo.
- La contraseña se escribe solo en ese panel: nunca por voz ni por el chat, y no se guarda en disco. La bóveda se bloquea sola a los 10 minutos.

## Expresiones

LyFan tiene **13 expresiones** y las usa según lo que está haciendo:

| Cuándo | Expresión |
|---|---|
| Lo escucha (el micrófono oye su voz o está entendiéndolo) | **Escuchando**: las barras del visor siguen el volumen real de su voz |
| Está pensando o redactando la respuesta | **Trabajando** (teclea en su laptop) |
| Revisa un enlace o un mensaje | **Analizar** |
| Habla (suena su voz) | **Hablando**; al terminar de hablar se detiene y vuelve a **Reposo** |
| Habla mientras todavía elabora la respuesta | **Trabajando hablando** |
| Habla de algo **sospechoso** (riesgo medio o alto) | **Alerta hablando**; al terminar queda en **Alerta** unos segundos y luego se calma |
| Explica un análisis sin riesgo | **Analizar hablando**, y luego **Kawaii** |
| Todo está bien, lo saludan o le dan doble clic | **Kawaii** |
| Está en reposo | De vez en cuando, al azar: **Curioso**, **Guiño** o una sonrisa, para no quedarse siempre igual |
| Pasa un rato sin actividad | A los 50 s se pone a **Trabajar** y a los 3 minutos se **duerme** (sin avisos; mientras duerme la burbuja se oculta) |

El menú de clic derecho sobre LyFan tiene además *Expresión*, para verlas una por una.

## Estructura

```
backend/   Servidor FastAPI (solo 127.0.0.1)
  app/main.py      /api/salud, /api/analizar, /api/chat (streaming) y sirve la interfaz
  app/detector.py  Reglas con pesos: mensajes de estafa y enlaces de phishing
  app/marcas.py    Marcas peruanas y sus dominios oficiales (revisar antes de presentar)
  app/llm.py       Cliente de Ollama y respuestas de respaldo
  app/voz.py       Voz: Piper (Dave, sin internet), ElevenLabs con respaldo y reconocimiento de voz
  tests/           Pruebas del detector (52 pruebas: detector y voz)
ui/        Interfaz flotante
  mascota/         Copia del diseño de LyFan (Plan A) con una API pública: window.LyFan
  overlay.*        Chat, expresiones, micrófono y control de la ventana
  ajustes.js       Panel de configuración (Tamaño, Micrófono, Voces)
  voz.js           Hablar (efecto robot con Web Audio) y escuchar (micrófono)
desktop/   Ventana de Electron: transparente, sin marco, siempre encima, arrastrable
```

El diseño original de la mascota (`entregables\LyFan-Mascota-Plan-A`) no se modificó: aquí se usa una copia.

## Pruebas

```powershell
cd backend
.\.venv\Scripts\python -m pytest -q
```

La tabla de `tests/test_detector.py` es la semilla del conjunto de datos del proyecto: conviene ir sumando ejemplos reales (sin datos personales).

## Cómo funciona el detector

Cada regla suma puntos y deja una razón en lenguaje simple. El puntaje (0 a 100) da el nivel: menos de 30 **tranquilo**, de 30 a 59 **alerta**, 60 o más **peligro**. En mensajes revisa urgencia, pedidos de claves o códigos, premios, amenazas, dinero, apps de control remoto, el truco del "familiar con número nuevo" y suplantación de marcas. En enlaces revisa HTTPS, IP, punycode, acortadores, dominios de riesgo y parecido con dominios oficiales (distancia de Levenshtein).

## Lo que sigue

Análisis de pantalla, extensión de navegador, bóveda cifrada y modelo de texto entrenado. Los dominios oficiales de `marcas.py` deben confirmarse entrando a cada sitio.

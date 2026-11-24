# LyFan Guard (MVP) · preparación inicial (una sola vez).
# Requisitos: Python 3.10 a 3.13, Node.js 22 y Ollama con el modelo:  ollama pull qwen3.5:4b
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host '1/2  Servidor (Python)...'
Set-Location (Join-Path $raiz 'backend')
if (-not (Test-Path '.venv')) { python -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install --quiet -r requirements.txt
& .\.venv\Scripts\python.exe -m pytest -q

Write-Host '     Descargando la voz sin internet (63 MB, una sola vez)...'
try { & .\.venv\Scripts\python.exe -c "from app import voz; voz.descargar_piper_sync('es_ES-davefx-medium')" } catch { Write-Warning 'No pude descargar la voz sin internet; puedes hacerlo despues desde Ajustes.' }

Write-Host '2/2  Ventana flotante (Electron)...'
Set-Location (Join-Path $raiz 'desktop')
npm install

Write-Host 'Listo. Para abrir a LyFan:  .\run-mvp.ps1'

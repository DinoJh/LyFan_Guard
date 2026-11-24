# LyFan Guard (MVP) · abre la ventana flotante de LyFan.
# Uso:  powershell -ExecutionPolicy Bypass -File .\run-mvp.ps1
# La primera vez ejecuta antes:  .\instalar.ps1
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1) Ollama (el modelo local). Si ya está encendido no hace nada.
if (-not (Get-Process ollama -ErrorAction SilentlyContinue)) {
    $ollama = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (Test-Path $ollama) { Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden; Start-Sleep -Seconds 2 }
    else { Write-Warning 'No encuentro Ollama: LyFan funcionará en modo básico (sin IA), solo con el detector.' }
}

# 2) Ventana flotante: ella misma enciende el servidor local y lo apaga al salir.
Set-Location (Join-Path $raiz 'desktop')
if (-not (Test-Path 'node_modules')) { npm install }
npm start

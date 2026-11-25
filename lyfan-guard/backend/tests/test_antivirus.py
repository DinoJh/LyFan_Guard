"""Pruebas de LyFan Antivirus: firmas (EICAR), programas, documentos, comprimidos, escaneo y cuarentena."""
import io
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import analisis_archivo as aa  # noqa: E402
from app import antivirus, boveda, cuarentena, voz  # noqa: E402

# Se arma en partes para que ningún antivirus real borre este archivo de pruebas.
EICAR = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


@pytest.fixture(autouse=True)
def entorno(tmp_path, monkeypatch):
    monkeypatch.setattr(boveda, "DIR_BOVEDA", tmp_path / "b")
    monkeypatch.setattr(voz, "DIR_DATOS", tmp_path / "datos")
    (tmp_path / "b").mkdir()


def test_eicar_se_detecta_por_firma(tmp_path):
    f = boveda.DIR_BOVEDA / "eicar.com"
    f.write_bytes(EICAR)
    r = aa.analizar_archivo(f)
    assert r["riesgo"]["nivel"] == "peligro" and r["riesgo"]["deteccion"] == "EICAR-Test-File"


def test_programa_con_funciones_de_virus():
    f = boveda.DIR_BOVEDA / "juego.exe"
    f.write_bytes(b"MZ" + b"\x00" * 64 + b"VirtualAllocEx\x00WriteProcessMemory\x00CreateRemoteThread\x00"
                  + b"Software\\Microsoft\\Windows\\CurrentVersion\\Run\x00")
    r = aa.analizar_archivo(f)["riesgo"]
    assert r["nivel"] == "peligro" and "inyectar" in " ".join(r["razones"]) and r["deteccion"]


def test_programa_disfrazado_de_imagen():
    f = boveda.DIR_BOVEDA / "foto.jpg"
    f.write_bytes(b"MZ\x90\x00" + b"\x00" * 200)
    r = aa.analizar_archivo(f)["riesgo"]
    assert r["nivel"] in ("alerta", "peligro") and "disfrazado" in " ".join(r["razones"])


def test_zip_con_programa_y_doble_extension():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("factura.pdf.exe", b"MZ")
    f = boveda.DIR_BOVEDA / "factura.zip"
    f.write_bytes(buf.getvalue())
    assert aa.analizar_archivo(f)["riesgo"]["nivel"] == "peligro"


def test_documento_con_macros_que_se_ejecutan_solas():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/vbaProject.bin", b"Attribute VB_Name\x00AutoOpen\x00CreateObject(\"WScript.Shell\")")
    f = boveda.DIR_BOVEDA / "informe.docm"
    f.write_bytes(buf.getvalue())
    r = aa.analizar_archivo(f)["riesgo"]
    assert r["nivel"] == "peligro" and "macros" in " ".join(r["razones"])


def test_pdf_que_lanza_programas():
    f = boveda.DIR_BOVEDA / "aviso.pdf"
    f.write_bytes(b"%PDF-1.7\n1 0 obj << /OpenAction << /S /Launch /F (cmd.exe) >> /JavaScript (app.alert(1)) >> endobj")
    assert aa.analizar_archivo(f)["riesgo"]["nivel"] == "peligro"


def test_archivo_normal_queda_tranquilo():
    f = boveda.DIR_BOVEDA / "notas.pdf"
    f.write_bytes(b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj")
    assert aa.analizar_archivo(f)["riesgo"]["nivel"] == "tranquilo"


def test_escaneo_avisa_una_sola_vez_y_cuarentena_ida_y_vuelta():
    (boveda.DIR_BOVEDA / "limpio.txt").write_text("hola", encoding="utf-8")
    (boveda.DIR_BOVEDA / "malo.bat").write_text("vssadmin delete shadows /all /quiet", encoding="utf-8")
    r1 = antivirus.escanear(solo_nuevos=True)
    assert [h["nombre"] for h in r1["nuevos"]] == ["malo.bat"]
    r2 = antivirus.escanear(solo_nuevos=True)
    assert r2["nuevos"] == [] and len(r2["hallazgos"]) == 1      # ya avisó: no lo repite

    meta = cuarentena.poner("malo.bat")
    assert not (boveda.DIR_BOVEDA / "malo.bat").exists()
    assert b"vssadmin" not in cuarentena._cuerpo(meta["id"]).read_bytes()   # aislado y neutralizado
    assert [e["nombre"] for e in cuarentena.listar()] == ["malo.bat"]

    cuarentena.restaurar(meta["id"])                                # falsa alarma
    assert (boveda.DIR_BOVEDA / "malo.bat").read_text(encoding="utf-8").startswith("vssadmin")
    assert cuarentena.listar() == []
    assert antivirus.escanear()["hallazgos"] == []                 # ya no se vuelve a marcar


def test_cuarentena_eliminar_y_ids_invalidos():
    (boveda.DIR_BOVEDA / "x.bat").write_text("echo hola", encoding="utf-8")
    meta = cuarentena.poner("x.bat")
    with pytest.raises(cuarentena.ErrorCuarentena):
        cuarentena.restaurar("../../etc")
    assert cuarentena.eliminar(meta["id"])["eliminado"] == "x.bat"
    assert cuarentena.listar() == []
    with pytest.raises(boveda.ErrorBoveda):
        cuarentena.poner("../fuera.txt")


def test_programa_grande_se_revisa_rapido_y_por_partes():
    import time
    f = boveda.DIR_BOVEDA / "grande.exe"
    relleno = bytes(range(256)) * 16000                     # ~4 MB de datos variados
    f.write_bytes(b"MZ" + relleno + b"VirtualAllocEx\x00" + relleno + b"WriteProcessMemory\x00CreateRemoteThread\x00")
    t = time.monotonic()
    r = aa.analizar_archivo(f)["riesgo"]
    assert time.monotonic() - t < 5                          # antes congelaba el servidor
    assert "inyectar" in " ".join(r["razones"])


def test_escaneo_entra_a_subcarpetas_y_trabaja_por_partes():
    sub = boveda.DIR_BOVEDA / "descargas" / "juegos"
    sub.mkdir(parents=True)
    (sub / "crack.bat").write_text("vssadmin delete shadows /all /quiet", encoding="utf-8")
    for i in range(5):
        (boveda.DIR_BOVEDA / f"nota{i}.txt").write_text("hola", encoding="utf-8")
    r1 = antivirus.escanear(solo_nuevos=True, max_archivos=2)
    assert r1["revisados"] == 2 and r1["pendientes"] == 4    # por partes: el resto queda para la próxima vuelta
    vistos = []
    for _ in range(4):
        vistos += [h["nombre"] for h in antivirus.escanear(solo_nuevos=True, max_archivos=2)["nuevos"]]
    assert "descargas/juegos/crack.bat" in vistos
    meta = cuarentena.poner("descargas/juegos/crack.bat")
    assert not (sub / "crack.bat").exists()
    cuarentena.restaurar(meta["id"])
    assert (sub / "crack.bat").exists()
    with pytest.raises(boveda.ErrorBoveda):
        cuarentena.poner("descargas/../../fuera.bat")


def test_eicar_dentro_de_un_programa_grande_y_su_codigo_fuente():
    exe = boveda.DIR_BOVEDA / "EICAR.exe"
    exe.write_bytes(b"MZ" + b"\x00" * 300_000 + EICAR + b"\x00" * 1000)   # la firma está lejos del inicio
    assert aa.analizar_archivo(exe)["riesgo"]["deteccion"] == "EICAR-Test-File"
    cpp = boveda.DIR_BOVEDA / "Virus_EICAR.cpp"
    cpp.write_text('archivo << "X5O!P%@AP[4\\PZX54(P^)7CC)7}$"\n  "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";', encoding="utf-8")
    r = aa.analizar_archivo(cpp)["riesgo"]
    assert r["nivel"] == "peligro" and r["deteccion"] == "EICAR-Test-File.Dropper"

"""Pruebas de la bóveda: cifrado de ida y vuelta, contraseñas, archivos alterados y nombres peligrosos."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import boveda  # noqa: E402


@pytest.fixture(autouse=True)
def carpeta(tmp_path, monkeypatch):
    monkeypatch.setattr(boveda, "DIR_BOVEDA", tmp_path / "b")
    monkeypatch.setattr(boveda, "_SCRYPT_N", 2 ** 10)      # más rápido en pruebas
    boveda.bloquear()


def _crear(clave="una-clave-larga"):
    boveda.crear(clave)
    return clave


def test_crear_exige_clave_larga_y_no_la_guarda():
    with pytest.raises(boveda.ErrorBoveda):
        boveda.crear("corta")
    clave = _crear("MiClaveSecreta123")
    assert "MiClaveSecreta123" not in boveda._ruta_config().read_text(encoding="utf-8")
    assert not boveda.estado()["bloqueada"] and clave


def test_desbloquear_con_clave_mala_falla():
    _crear("clave-correcta-1")
    boveda.bloquear()
    with pytest.raises(boveda.ErrorBoveda) as e:
        boveda.desbloquear("clave-incorrecta")
    assert e.value.codigo == 401
    boveda.desbloquear("clave-correcta-1")
    assert not boveda.estado()["bloqueada"]


def test_sin_desbloquear_no_se_puede_cifrar():
    _crear()
    (boveda.DIR_BOVEDA / "a.txt").write_text("hola", encoding="utf-8")
    boveda.bloquear()
    with pytest.raises(boveda.ErrorBoveda) as e:
        boveda.cifrar("a.txt")
    assert e.value.codigo == 423


def test_ida_y_vuelta_y_el_cifrado_no_deja_el_texto_a_la_vista():
    _crear()
    original = "Mi contraseña del banco es SuperSecreta987 😀 " * 50
    (boveda.DIR_BOVEDA / "notas.txt").write_text(original, encoding="utf-8")
    r = boveda.cifrar("notas.txt")
    assert r["cifrado"] == "notas.txt.lyfan" and not (boveda.DIR_BOVEDA / "notas.txt").exists()
    crudo = (boveda.DIR_BOVEDA / "notas.txt.lyfan").read_bytes()
    assert b"SuperSecreta987" not in crudo and b"notas.txt" not in crudo      # ni el contenido ni el nombre
    boveda.descifrar("notas.txt.lyfan")
    assert (boveda.DIR_BOVEDA / "notas.txt").read_text(encoding="utf-8") == original
    assert not (boveda.DIR_BOVEDA / "notas.txt.lyfan").exists()


def test_archivo_grande_por_bloques_y_vacio(monkeypatch):
    monkeypatch.setattr(boveda, "BLOQUE", 1000)            # fuerza varios bloques con poco dato
    _crear()
    datos = bytes(range(256)) * 40                         # 10 240 bytes = 11 bloques
    (boveda.DIR_BOVEDA / "g.bin").write_bytes(datos)
    (boveda.DIR_BOVEDA / "v.bin").write_bytes(b"")
    boveda.cifrar("g.bin"); boveda.cifrar("v.bin")
    boveda.descifrar("g.bin.lyfan"); boveda.descifrar("v.bin.lyfan")
    assert (boveda.DIR_BOVEDA / "g.bin").read_bytes() == datos
    assert (boveda.DIR_BOVEDA / "v.bin").read_bytes() == b""


def test_archivo_alterado_o_truncado_no_abre(monkeypatch):
    monkeypatch.setattr(boveda, "BLOQUE", 1000)
    _crear()
    (boveda.DIR_BOVEDA / "x.bin").write_bytes(b"A" * 5000)
    boveda.cifrar("x.bin")
    ruta = boveda.DIR_BOVEDA / "x.bin.lyfan"
    bueno = ruta.read_bytes()
    alterado = bytearray(bueno); alterado[200] ^= 0xFF
    ruta.write_bytes(bytes(alterado))
    with pytest.raises(boveda.ErrorBoveda):
        boveda.descifrar("x.bin.lyfan")
    ruta.write_bytes(bueno[:len(bueno) - 1030])           # le falta el final (se quita un bloque)
    with pytest.raises(boveda.ErrorBoveda):
        boveda.descifrar("x.bin.lyfan")
    assert ruta.exists()                                  # un fallo nunca borra el archivo cifrado


def test_otra_contrasena_no_abre_el_archivo():
    _crear("clave-uno-1234")
    (boveda.DIR_BOVEDA / "s.txt").write_text("secreto", encoding="utf-8")
    boveda.cifrar("s.txt")
    cifrado = (boveda.DIR_BOVEDA / "s.txt.lyfan").read_bytes()
    boveda.bloquear()
    boveda._fijar(b"\x01" * 32)                           # una clave maestra distinta
    with pytest.raises(boveda.ErrorBoveda):
        boveda.descifrar("s.txt.lyfan")
    assert (boveda.DIR_BOVEDA / "s.txt.lyfan").read_bytes() == cifrado


@pytest.mark.parametrize("malo", ["../fuera.txt", "..\\fuera.txt", "C:\\Windows\\x.txt", "/etc/passwd", "a/b.txt", "..", ""])
def test_nombres_peligrosos_se_rechazan(malo):
    _crear()
    with pytest.raises(boveda.ErrorBoveda):
        boveda.cifrar(malo)


def test_importar_copia_sin_tocar_el_original(tmp_path):
    _crear()
    fuera = tmp_path / "doc.txt"
    fuera.write_text("contenido", encoding="utf-8")
    r = boveda.importar(str(fuera))
    assert (boveda.DIR_BOVEDA / r["nombre"]).read_text(encoding="utf-8") == "contenido" and fuera.exists()
    assert boveda.importar(str(fuera))["nombre"] != r["nombre"]        # no pisa el anterior
    with pytest.raises(boveda.ErrorBoveda):
        boveda.importar(str(tmp_path))                                  # una carpeta no es un archivo


def test_autobloqueo(monkeypatch):
    _crear()
    assert boveda.desbloqueada()
    monkeypatch.setattr(boveda, "_expira", 0.0)
    assert not boveda.desbloqueada()


def test_analizar_detecta_datos_sensibles_y_estafa():
    _crear()
    (boveda.DIR_BOVEDA / "n.txt").write_text(
        "Tarjeta 4539 1488 0343 6467\nclave: Hunter2xx\nYape: urgente, su cuenta será bloqueada, envíe su código a bit.ly/abc", encoding="utf-8")
    r = boveda.analizar("n.txt")
    assert r["revisable"] and any("tarjeta" in x for x in r["sensibles"]) and any("contraseñas" in x for x in r["sensibles"])
    assert r["estafa"]["nivel"] in ("alerta", "peligro")
    (boveda.DIR_BOVEDA / "f.png").write_bytes(b"\x89PNG")
    assert not boveda.analizar("f.png")["revisable"]


def test_el_listado_oculta_la_configuracion():
    _crear()
    (boveda.DIR_BOVEDA / "a.txt").write_text("x", encoding="utf-8")
    nombres = [a["nombre"] for a in boveda.listar()]
    assert nombres == ["a.txt"]


def test_descifrar_con_clave_exige_la_contrasena_correcta():
    _crear("clave-buena-123")
    (boveda.DIR_BOVEDA / "a.txt").write_text("uno", encoding="utf-8")
    (boveda.DIR_BOVEDA / "b.txt").write_text("dos", encoding="utf-8")
    boveda.cifrar("a.txt"); boveda.cifrar("b.txt")
    with pytest.raises(boveda.ErrorBoveda) as e:
        boveda.descifrar_con_clave(["a.txt.lyfan"], "clave-mala-999")
    assert e.value.codigo == 401 and (boveda.DIR_BOVEDA / "a.txt.lyfan").exists()
    r = boveda.descifrar_con_clave(["a.txt.lyfan", "b.txt.lyfan"], "clave-buena-123")
    assert sorted(r["descifrados"]) == ["a.txt", "b.txt"] and not r["fallos"]


def test_cambiar_clave_recifra_todo_y_la_vieja_deja_de_servir():
    _crear("clave-vieja-123")
    (boveda.DIR_BOVEDA / "a.txt").write_text("secreto uno", encoding="utf-8")
    (boveda.DIR_BOVEDA / "b.txt").write_text("secreto dos", encoding="utf-8")
    boveda.cifrar("a.txt"); boveda.cifrar("b.txt")
    with pytest.raises(boveda.ErrorBoveda):
        boveda.cambiar_clave("clave-mala-000", "clave-nueva-456")
    with pytest.raises(boveda.ErrorBoveda):
        boveda.cambiar_clave("clave-vieja-123", "corta")
    r = boveda.cambiar_clave("clave-vieja-123", "clave-nueva-456")
    assert r["recifrados"] == 2
    assert not [p for p in boveda.DIR_BOVEDA.iterdir() if p.name.startswith(".") and p.name != boveda.ARCHIVO_CONFIG]
    boveda.bloquear()
    with pytest.raises(boveda.ErrorBoveda):
        boveda.descifrar_con_clave(["a.txt.lyfan"], "clave-vieja-123")
    r = boveda.descifrar_con_clave(["a.txt.lyfan", "b.txt.lyfan"], "clave-nueva-456")
    assert sorted(r["descifrados"]) == ["a.txt", "b.txt"]
    assert (boveda.DIR_BOVEDA / "a.txt").read_text(encoding="utf-8") == "secreto uno"

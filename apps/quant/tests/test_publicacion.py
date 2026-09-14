"""Un artefacto que lee la api se sustituye entero o no se toca (0.73.0).

Con la recarga automática, la api puede leer un artefacto justo mientras el piloto lo escribe. Con
`write_text` eso era un JSON a medias; con `escribir_atomico` es el fichero anterior entero o el
nuevo entero.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from trademe_quant import meta_policy, quarantine_policy
from trademe_quant.fundamental import write_artifact
from trademe_quant.publicacion import escribir_atomico, publicar_json


def test_escribe_el_contenido_y_crea_el_directorio(tmp_path: Path) -> None:
    ruta = escribir_atomico(tmp_path / "fundamental" / "BTCUSDT.json", '{"a": 1}\n')
    assert ruta.read_text(encoding="utf8") == '{"a": 1}\n'
    assert list(ruta.parent.iterdir()) == [ruta]  # sin temporales abandonados


def test_si_la_sustitucion_falla_el_fichero_anterior_sigue_entero(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La propiedad que importa: nunca queda a medias, pase lo que pase durante la escritura."""
    ruta = tmp_path / "quarantine.json"
    ruta.write_text('{"version": "anterior"}\n', encoding="utf8")

    def falla(*_a: object) -> None:
        raise OSError("disco lleno")

    monkeypatch.setattr(os, "replace", falla)
    with pytest.raises(OSError):
        escribir_atomico(ruta, '{"version": "nueva", "intervals": {}}\n')

    assert json.loads(ruta.read_text(encoding="utf8")) == {"version": "anterior"}
    assert [p.name for p in tmp_path.iterdir()] == ["quarantine.json"]


def test_el_temporal_no_parece_un_artefacto(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La api lista `fundamental/*.json`: un temporal con esa extensión se leería como publicado."""
    vistos: list[str] = []
    real = os.replace

    def espia(origen: str | Path, destino: str | Path) -> None:
        vistos.append(Path(origen).name)
        real(origen, destino)

    monkeypatch.setattr(os, "replace", espia)
    escribir_atomico(tmp_path / "BTCUSDT.json", "{}\n")

    (nombre,) = vistos
    assert nombre.startswith(".") and not nombre.endswith(".json")


def test_publicar_json_es_json_valido_con_salto_final(tmp_path: Path) -> None:
    ruta = publicar_json(tmp_path / "x.json", {"clave": "ñ"}, indent=2, ensure_ascii=False)
    texto = ruta.read_text(encoding="utf8")
    assert texto.endswith("\n") and json.loads(texto) == {"clave": "ñ"}


# --- Los artefactos que lee la api pasan por aquí ------------------------------------------------


def _espiar(monkeypatch: pytest.MonkeyPatch, modulo: object) -> list[str]:
    escritos: list[str] = []

    def espia(ruta: str | Path, datos: object, **opciones: object) -> Path:
        escritos.append(Path(ruta).name)
        return Path(ruta)

    monkeypatch.setattr(modulo, "publicar_json", espia)
    return escritos


def test_la_cuarentena_se_publica_de_forma_atomica(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    escritos = _espiar(monkeypatch, quarantine_policy)
    quarantine_policy.save_policy(tmp_path, {})
    assert escritos == ["quarantine.json"]


def test_la_politica_del_meta_modelo_se_publica_de_forma_atomica(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    escritos = _espiar(monkeypatch, meta_policy)
    meta_policy.save_policy(tmp_path, "shadow", "motivo", {})
    assert escritos == ["meta_policy.json"]


def test_los_fundamentales_se_publican_de_forma_atomica(tmp_path: Path) -> None:
    ruta = write_artifact({"symbol": "BTCUSDT", "version": "fund-x"}, tmp_path)
    assert ruta == tmp_path / "fundamental" / "BTCUSDT.json"
    assert [p.name for p in ruta.parent.iterdir()] == ["BTCUSDT.json"]

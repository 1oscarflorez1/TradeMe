"""Tests de la resolución de config activa por símbolo+temporalidad."""

from __future__ import annotations

import pathlib
import shutil

import pytest

from trademe_quant.ensemble import load_active_ensemble, load_ensemble, usa_optimizadas

BASE = pathlib.Path(__file__).parents[3] / "artifacts/ensemble.yaml"


def _setup_artifacts(tmp: pathlib.Path) -> pathlib.Path:
    art = tmp / "artifacts"
    art.mkdir()
    shutil.copy(BASE, art / "ensemble.yaml")
    return art


def test_usa_base_si_no_hay_optimizado(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    art = _setup_artifacts(tmp_path)
    monkeypatch.setenv("ARTIFACTS_DIR", str(art))
    cfg = load_active_ensemble("BTCUSDT", "5m")
    assert "weights" in cfg


def _con_optimizada_de_15m(art: pathlib.Path, usa: bool) -> None:
    """Deja un optimizado SOLO para 15m, con versión distinta, y fija la bandera del yaml."""
    opt = art / "optimized"
    opt.mkdir(exist_ok=True)
    base_text = (art / "ensemble.yaml").read_text()
    (opt / "ensemble.BTCUSDT.15m.yaml").write_text(
        base_text.replace("version:", "version_note: opt\nversion:", 1).replace(
            "'ens-", "'ens-opt15m-", 1
        )
    )
    yaml_base = art / "ensemble.yaml"
    texto = yaml_base.read_text()
    assert "use_optimized_configs: false" in texto
    yaml_base.write_text(
        texto.replace("use_optimized_configs: false", f"use_optimized_configs: {str(usa).lower()}")
    )


def test_prefiere_optimizado_del_tf_si_la_bandera_lo_permite(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    art = _setup_artifacts(tmp_path)
    _con_optimizada_de_15m(art, usa=True)
    monkeypatch.setenv("ARTIFACTS_DIR", str(art))
    assert str(load_active_ensemble("BTCUSDT", "15m")["version"]).startswith("ens-opt15m-")
    assert not str(load_active_ensemble("BTCUSDT", "5m")["version"]).startswith("ens-opt15m-")


def test_con_la_bandera_apagada_manda_siempre_la_base(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Es el estado real desde 0.69.0: las quince optimizadas rendían peor que la base.

    Se desactivan por bandera y **no se borran**, así que el fichero sigue existiendo y este test
    comprueba lo que importa: que existir ya no baste para que se aplique.
    """
    art = _setup_artifacts(tmp_path)
    _con_optimizada_de_15m(art, usa=False)
    monkeypatch.setenv("ARTIFACTS_DIR", str(art))
    assert (art / "optimized" / "ensemble.BTCUSDT.15m.yaml").exists()
    assert not str(load_active_ensemble("BTCUSDT", "15m")["version"]).startswith("ens-opt15m-")


def test_el_yaml_del_repositorio_las_tiene_desactivadas() -> None:
    """El estado que se despliega, fijado aquí para que un cambio silencioso rompa un test."""
    assert usa_optimizadas(load_ensemble(BASE)) is False

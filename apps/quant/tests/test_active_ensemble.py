"""Tests de la resolución de config activa por símbolo+temporalidad."""

from __future__ import annotations

import pathlib
import shutil

import pytest

from trademe_quant.ensemble import load_active_ensemble

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


def test_prefiere_optimizado_del_tf(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    art = _setup_artifacts(tmp_path)
    opt = art / "optimized"
    opt.mkdir()
    # optimizado SOLO para 15m, con versión distinta
    base_text = (art / "ensemble.yaml").read_text()
    (opt / "ensemble.BTCUSDT.15m.yaml").write_text(
        base_text.replace("version:", "version_note: opt\nversion:", 1).replace(
            "'ens-", "'ens-opt15m-", 1
        )
    )
    monkeypatch.setenv("ARTIFACTS_DIR", str(art))
    cfg_15 = load_active_ensemble("BTCUSDT", "15m")
    cfg_5 = load_active_ensemble("BTCUSDT", "5m")
    assert str(cfg_15["version"]).startswith("ens-opt15m-")
    assert not str(cfg_5["version"]).startswith("ens-opt15m-")

"""Lo que `/automation` —y con ello el Laboratorio— dice del meta-modelo retirado (0.74.1).

Desplegado 0.74.0, el piloto dejó de entrenarlo y la api lo aplicaba en `off`, pero el Laboratorio
seguía enseñando «Filtro ML shadow» con el motivo y las cifras del último modelo: leía
`meta_policy.json`, que se quedó con el último modo que decidió su gobierno.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[3]


def _artefactos(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, habilitado: bool | None) -> None:
    base = yaml.safe_load((RAIZ / "artifacts" / "ensemble.yaml").read_text(encoding="utf8"))
    if habilitado is None:
        base.pop("metamodel", None)
    else:
        base["metamodel"] = {"enabled": habilitado}
    (tmp_path / "ensemble.yaml").write_text(yaml.safe_dump(base), encoding="utf8")
    politica = {"mode": "shadow", "reason": "aún no demuestra ventaja", "evidence": {"n": 500}}
    (tmp_path / "meta_policy.json").write_text(json.dumps(politica), encoding="utf8")
    monkeypatch.setenv("ARTIFACTS_DIR", str(tmp_path))


def test_retirado_no_se_presenta_como_en_sombra(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from trademe_quant.scheduler import MOTIVO_RETIRADA, _meta_policy_summary

    _artefactos(tmp_path, monkeypatch, habilitado=False)
    resumen = _meta_policy_summary()
    assert resumen["mode"] == "off"
    assert resumen["retirado"] is True
    assert resumen["reason"] == MOTIVO_RETIRADA
    assert resumen["evidence"] is None  # las cifras de un modelo que ya no se aplica, fuera


def test_activo_sigue_leyendo_su_politica(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from trademe_quant.scheduler import _meta_policy_summary

    for habilitado in (True, None):
        _artefactos(tmp_path, monkeypatch, habilitado=habilitado)
        resumen = _meta_policy_summary()
        assert resumen["mode"] == "shadow"
        assert "retirado" not in resumen

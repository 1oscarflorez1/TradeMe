"""El estudio que retiró el meta-modelo, y la retirada misma (0.74.0).

Lo que se comprueba del estudio es que no pueda engañarse: que ningún modelo vea su semana de
prueba, que la AUC sea la de siempre, que la regla de decisión sea la fijada y que distinga una
señal de verdad de la deriva direccional.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import yaml
from sklearn.metrics import roc_auc_score

import trademe_quant.run_metamodelo_estudio as est
from trademe_quant.ensemble import metamodelo_activo

INICIO = dt.datetime(2026, 8, 1, tzinfo=dt.UTC)
RAIZ = Path(__file__).resolve().parents[3]


def _decision(
    horas: float, resultado: str, direccion: str = "LONG", r: float | None = None, x: float = 0.0
) -> est.Decision:
    return est.Decision(
        instante=INICIO + dt.timedelta(hours=horas),
        clave="ETHUSDT:1h",
        interval="1h",
        direccion=direccion,
        rama="sombra",
        resultado=resultado,
        r=r if r is not None else {"tp": 2.0, "sl": -1.0}.get(resultado, 0.0),
        features=(x, 1.0 if direccion == "LONG" else 0.0),
    )


# --- La AUC ---------------------------------------------------------------------------------------


def test_la_auc_coincide_con_la_de_sklearn_incluidos_empates() -> None:
    rng = np.random.default_rng(3)
    y = rng.integers(0, 2, 300).tolist()
    s = np.round(rng.random(300), 1).tolist()  # redondeo: muchos empates
    assert est.auc(y, s) == pytest.approx(roc_auc_score(y, s))


def test_sin_una_de_las_clases_no_hay_auc() -> None:
    assert est.auc([1, 1, 1], [0.1, 0.5, 0.9]) is None


def test_la_nula_de_una_puntuacion_aleatoria_ronda_el_medio() -> None:
    rng = np.random.default_rng(5)
    y = rng.integers(0, 2, 400).tolist()
    s = rng.random(400).tolist()
    p95 = est.nula_auc_p95(y, s, permutaciones=300)
    assert 0.5 < p95 < 0.6


# --- Walk-forward ---------------------------------------------------------------------------------


def test_ningun_modelo_ve_su_semana_de_prueba() -> None:
    decisiones = [_decision(h, "tp" if h % 3 else "sl") for h in range(0, 24 * 35, 6)]
    for tren, prueba in est.pliegues_semanales(decisiones):
        ultimo_tren = max(decisiones[i].instante for i in tren)
        primero_prueba = min(decisiones[i].instante for i in prueba)
        assert ultimo_tren < primero_prueba


def test_detecta_una_senal_de_verdad() -> None:
    """Una feature que separa TP de SL tiene que salir con AUC alta y mejorar la expectancy."""
    rng = np.random.default_rng(11)
    decisiones = []
    for h in range(0, 24 * 42, 2):
        tp = bool(rng.random() < 0.5)
        x = (1.0 if tp else 0.0) + rng.normal(0, 0.3)
        decisiones.append(
            _decision(h, "tp" if tp else "sl", "LONG" if h % 4 else "SHORT", x=float(x))
        )
    pred = est.walk_forward(decisiones)
    res = est.resumir(decisiones, pred)
    assert res["auc"] > 0.8
    assert res["mejora"] > res["mejora_nula_p95"]
    queda, motivos = est.veredicto(res)
    assert queda, motivos


def test_la_deriva_no_pasa_por_senal() -> None:
    """Los largos ganan unas semanas y los cortos otras: mezclando direcciones «predice» algo.

    Dentro de cada dirección no hay nada que ordenar, y la regla tiene que verlo.
    """
    rng = np.random.default_rng(13)
    decisiones = []
    for h in range(0, 24 * 42, 2):
        semana = h // (24 * 7)
        direccion = "LONG" if rng.random() < 0.5 else "SHORT"
        favorecida = "LONG" if semana % 2 == 0 else "SHORT"
        tp = rng.random() < (0.75 if direccion == favorecida else 0.25)
        decisiones.append(_decision(h, "tp" if tp else "sl", direccion, x=float(rng.random())))
    res = est.resumir(decisiones, est.walk_forward(decisiones))
    queda, motivos = est.veredicto(res)
    assert not queda
    assert any("solo en" in m or "AUC agregada" in m for m in motivos)


# --- La regla de decisión -------------------------------------------------------------------------


def _resumen(**cambios: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "auc": 0.60,
        "mejora": 0.20,
        "mejora_nula_p95": 0.10,
        "por_direccion": {"LONG": {"n": 100, "auc": 0.58}, "SHORT": {"n": 100, "auc": 0.57}},
    }
    base.update(cambios)
    return base


def test_la_regla_exige_las_tres_condiciones() -> None:
    assert est.veredicto(_resumen())[0] is True
    assert est.veredicto(_resumen(auc=0.54))[0] is False
    assert est.veredicto(_resumen(mejora=0.05))[0] is False
    sin_cortos = {"LONG": {"n": 100, "auc": 0.58}, "SHORT": {"n": 100, "auc": 0.52}}
    assert est.veredicto(_resumen(por_direccion=sin_cortos))[0] is False


def test_una_direccion_sin_muestra_no_bloquea() -> None:
    poca = {"LONG": {"n": 100, "auc": 0.58}, "SHORT": {"n": 10, "auc": 0.2}}
    assert est.veredicto(_resumen(por_direccion=poca))[0] is True


def test_lo_medido_en_produccion_no_cumple() -> None:
    """Las cifras del 14-sep-2026 que retiraron el meta-modelo."""
    medido = _resumen(
        auc=0.528,
        mejora=-0.022,
        mejora_nula_p95=0.139,
        por_direccion={"LONG": {"n": 1292, "auc": 0.580}, "SHORT": {"n": 1735, "auc": 0.523}},
    )
    queda, motivos = est.veredicto(medido)
    assert queda is False and len(motivos) == 3


# --- La retirada ----------------------------------------------------------------------------------


def test_el_yaml_desplegado_lo_tiene_retirado() -> None:
    base = yaml.safe_load((RAIZ / "artifacts" / "ensemble.yaml").read_text(encoding="utf8"))
    assert metamodelo_activo(base) is False


def test_sin_la_seccion_sigue_activo() -> None:
    assert metamodelo_activo({}) is True
    assert metamodelo_activo({"metamodel": None}) is True
    assert metamodelo_activo({"metamodel": {"enabled": True}}) is True


def test_retirado_el_piloto_ni_entrena_ni_gobierna(monkeypatch: pytest.MonkeyPatch) -> None:
    import trademe_quant.ensemble as ensemble
    import trademe_quant.run_metamodel as run_metamodel
    import trademe_quant.scheduler as scheduler

    def no_debe_llamarse(*_a: object, **_k: object) -> None:
        raise AssertionError("con el meta-modelo retirado no se entrena")

    monkeypatch.setattr(ensemble, "load_ensemble", lambda _p: {"metamodel": {"enabled": False}})
    monkeypatch.setattr(run_metamodel, "train_and_publish", no_debe_llamarse)
    log: list[str] = []

    scheduler._ciclo_metamodelo("dsn", scheduler.load_config(), log)

    assert log == ["meta-modelo retirado (metamodel.enabled: false): ni se entrena ni se aplica"]

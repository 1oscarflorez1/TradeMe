"""La auditoría que retiró el Fundamental Score, y la retirada misma (0.75.0)."""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

import pytest
import yaml

import trademe_quant.run_fundamental_estudio as est
from trademe_quant.ensemble import fundamental_activo

INICIO = dt.datetime(2026, 8, 17, tzinfo=dt.UTC)  # lunes
RAIZ = Path(__file__).resolve().parents[3]


def _largo(
    horas: float, resultado: str, penalizacion: float, direccion: str = "LONG"
) -> est.DecisionFund:
    return est.DecisionFund(
        instante=INICIO + dt.timedelta(hours=horas),
        clave="ETHUSDT:1h",
        direccion=direccion,
        rama="sombra",
        resultado=resultado,
        r={"tp": 2.0, "sl": -1.0}.get(resultado, 0.0),
        percentil=penalizacion,
        penalizacion=penalizacion,
        descartada=penalizacion > 0.5,
    )


def test_la_mejora_compara_lo_conservado_con_todo() -> None:
    ds = [_largo(1, "tp", 0.0), _largo(2, "sl", 0.9), _largo(3, "sl", 0.9)]
    mejora, conservadas = est.mejora_conservadas(ds)
    assert conservadas == 1
    assert mejora == pytest.approx(2.0 - 0.0)


def test_mezclar_semanas_invierte_lo_que_ordena_dentro_de_cada_una() -> None:
    """Lo que pasó en producción: el funding alto acompañó a las semanas en que los largos ganaban.

    Dentro de cada semana la penalización ordena bien —las penalizadas pierden más—, pero la semana
    buena está penalizada casi entera y la mala casi nada. Agregando, el score descarta ganadoras.
    """
    ds = []
    # Semana 1: largos que ganan, penalización alta; dentro, las más penalizadas pierden.
    for h in range(40):
        ds.append(_largo(h, "tp" if h % 5 else "sl", 0.95 if h % 5 == 0 else 0.7))
    # Semana 2: largos que pierden, penalización baja; dentro, igual orden.
    for h in range(40):
        ds.append(_largo(24 * 7 + h, "sl" if h % 5 else "tp", 0.4 if h % 5 else 0.1))

    res = est.resumir(ds)

    assert res["auc_dentro_de_semanas"] > 0.55
    assert res["auc_largos"] < 0.5
    assert res["mejora"] < 0
    queda, motivos = est.veredicto(res)
    assert not queda
    assert any("AUC en largos" in m for m in motivos)


def test_los_cortos_son_control_y_no_descartan() -> None:
    ds = [_largo(h, "tp" if h % 2 else "sl", 0.2, "SHORT") for h in range(30)]
    ds += [_largo(h, "tp" if h % 2 else "sl", 0.2) for h in range(30)]
    res = est.resumir(ds)
    assert res["control_cortos"]["descartadas"] == 0
    assert res["largos"] == 30


def _resumen(**cambios: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "auc_largos": 0.60,
        "mejora": 0.20,
        "mejora_nula_p95": 0.10,
        "auc_dentro_de_semanas": 0.58,
    }
    base.update(cambios)
    return base


def test_la_regla_exige_las_tres_condiciones() -> None:
    assert est.veredicto(_resumen())[0] is True
    assert est.veredicto(_resumen(auc_largos=0.54))[0] is False
    assert est.veredicto(_resumen(mejora=0.08))[0] is False  # no supera el P95 de 0,10
    assert est.veredicto(_resumen(mejora=0.04, mejora_nula_p95=-0.2))[0] is False  # suelo 0,05
    assert est.veredicto(_resumen(auc_dentro_de_semanas=0.52))[0] is False


def test_lo_medido_en_produccion_no_cumple() -> None:
    """Las cifras del 14-sep-2026 que retiraron el Fundamental Score."""
    medido = _resumen(
        auc_largos=0.421, mejora=-0.101, mejora_nula_p95=0.317, auc_dentro_de_semanas=0.552
    )
    queda, motivos = est.veredicto(medido)
    assert queda is False and len(motivos) == 2


# --- La retirada ----------------------------------------------------------------------------------


def test_el_yaml_desplegado_lo_tiene_retirado() -> None:
    base = yaml.safe_load((RAIZ / "artifacts" / "ensemble.yaml").read_text(encoding="utf8"))
    assert fundamental_activo(base) is False


def test_sin_la_seccion_o_en_sombra_sigue_activo() -> None:
    assert fundamental_activo({}) is True
    assert fundamental_activo({"fundamental": {"mode": "shadow"}}) is True
    assert fundamental_activo({"fundamental": {"mode": "active"}}) is True


def test_retirado_el_piloto_ni_publica_ni_gobierna(monkeypatch: pytest.MonkeyPatch) -> None:
    import trademe_quant.ensemble as ensemble
    import trademe_quant.fundamental_policy as fundamental_policy
    import trademe_quant.run_fundamental as run_fundamental
    import trademe_quant.scheduler as scheduler

    def no_debe_llamarse(*_a: object, **_k: object) -> Any:
        raise AssertionError("con el score retirado no se publica ni se gobierna")

    monkeypatch.setattr(ensemble, "load_ensemble", lambda _p: {"fundamental": {"mode": "off"}})
    monkeypatch.setattr(run_fundamental, "publish", no_debe_llamarse)
    monkeypatch.setattr(fundamental_policy, "publish", no_debe_llamarse)
    log: list[str] = []

    scheduler._ciclo_fundamental_distribucion("dsn", ["ETHUSDT"], log)
    scheduler._ciclo_fundamental_gobierno("dsn", log)

    assert log == [
        "Fundamental Score retirado (fundamental.mode: off): ni se publica ni se gobierna"
    ]

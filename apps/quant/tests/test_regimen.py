"""Coherencia del régimen: que la etiqueta describa el mecanismo que se aplica."""

from __future__ import annotations

from typing import Any

from trademe_quant.regimen import auditar

BASE: dict[str, Any] = {
    "regime": {
        "trend": {"trend": 1.5, "momentum": 1.5, "reversion": 0.6},
        "range": {"trend": 0.6, "momentum": 0.8, "reversion": 1.5},
    }
}


def _con(reg: str, **pesos: float) -> dict[str, Any]:
    cfg = {"regime": {k: dict(v) for k, v in BASE["regime"].items()}}
    cfg["regime"][reg].update(pesos)
    return cfg


def test_la_config_base_es_coherente() -> None:
    """Lo que el proyecto escribió a mano cumple lo que documenta. Si no, todo lo demás sobra."""
    assert auditar(BASE).coherente


def test_detecta_la_reversion_dominando_en_tendencia() -> None:
    """El caso real más claro: SOLUSDT:15m publicó dominante 0.50 y reversion 1.99."""
    d = auditar(_con("trend", trend=0.50, momentum=0.44, reversion=1.99))
    assert not d.coherente
    assert d.hallazgos[0].regimen == "trend"
    assert 3.9 < d.hallazgos[0].ratio < 4.1


def test_detecta_la_tendencia_dominando_en_rango() -> None:
    """La inversión simétrica, que en producción llegó a 26x en SOLUSDT:1d."""
    d = auditar(_con("range", trend=1.23, reversion=0.05))
    assert not d.coherente
    assert d.hallazgos[0].regimen == "range"


def test_basta_con_que_UNA_dominante_mande() -> None:
    """En tendencia dominan dos familias: si el momentum manda, la conmutación tiene sentido.

    Exigir que las dos superen a la reversión marcaría como incoherentes configuraciones que sí
    respetan el diseño, y un guardia que da falsas alarmas se acaba ignorando.
    """
    assert auditar(_con("trend", trend=0.3, momentum=1.8, reversion=1.0)).coherente


def test_el_empate_no_es_inversion() -> None:
    """Con pesos iguales la conmutación no dice nada, pero tampoco dice lo contrario."""
    assert auditar(_con("trend", trend=1.0, momentum=1.0, reversion=1.0)).coherente


def test_los_dos_regimenes_pueden_estar_invertidos_a_la_vez() -> None:
    cfg = {
        "regime": {
            "trend": {"trend": 0.2, "momentum": 0.2, "reversion": 1.9},
            "range": {"trend": 1.9, "momentum": 0.3, "reversion": 0.2},
        }
    }
    d = auditar(cfg)
    assert not d.coherente
    assert {h.regimen for h in d.hallazgos} == {"trend", "range"}


def test_una_config_sin_regimen_no_es_una_inversion() -> None:
    """Un artefacto incompleto no es una alarma: fabricar una con eso sería ruido."""
    assert auditar({}).coherente
    assert auditar({"regime": {}}).coherente
    assert auditar({"regime": {"trend": None}}).coherente


def test_el_resumen_explica_el_hallazgo() -> None:
    """Una alerta automática que no se puede leer no sirve de nada."""
    d = auditar(_con("trend", trend=0.50, momentum=0.44, reversion=1.99))
    assert "trend" in d.resumen() and "3.98x" in d.resumen()
    assert auditar(BASE).resumen() == "coherente"


def test_peso_dominante_cero_no_revienta() -> None:
    """Optuna propone en [0, 2]: el cero es alcanzable y no puede tumbar la auditoría."""
    d = auditar(_con("trend", trend=0.0, momentum=0.0, reversion=1.0))
    assert not d.coherente
    assert d.hallazgos[0].ratio == float("inf")


def test_mirar_solo_trend_e_ignorar_momentum_infla_el_recuento() -> None:
    """El error de conteo que se cometió al descubrir esto, fijado para que no vuelva.

    `BNBUSDT:1h` publicó `trend 0.15` y `reversion 1.38`, que mirado así parece una inversión de
    9x. Pero su `momentum` es 1.69: una de las dos familias dominantes SÍ manda, así que su bloque
    de tendencia respeta la semántica.
    """
    real = _con("trend", trend=0.15, momentum=1.69, reversion=1.38)
    assert auditar(real).coherente
    solo_trend = _con("trend", trend=0.15, momentum=0.15, reversion=1.38)
    assert not auditar(solo_trend).coherente

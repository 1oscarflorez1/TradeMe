"""Tests de la medición de independencia efectiva de los votos (M10.5)."""

from __future__ import annotations

import numpy as np

from trademe_quant.independence import (
    DEFAULT_FLOOR,
    VOTE_COLUMNS,
    analyze,
    correlation_matrix,
    deflation_factor,
    effective_votes,
)


def test_votos_independientes_cuentan_todos() -> None:
    assert effective_votes(np.eye(6)) == 6.0


def test_votos_identicos_cuentan_uno() -> None:
    assert effective_votes(np.ones((6, 6))) < 1.05


def test_espejos_no_son_evidencia_nueva() -> None:
    """Dos bloques anticorrelacionados son un solo eje, no dos.

    Es el caso real de TradeMe: EMA–RSI correlaciona a −0,94. Sumar correlaciones con signo los
    cancelaría y daría independencia altísima justo donde no la hay; por eso se usan autovalores.
    """
    signos = np.array([1.0, 1.0, 1.0, -1.0, -1.0, -1.0])
    corr = np.outer(signos, signos)
    assert effective_votes(corr) < 1.05


def test_dos_bloques_internos_dan_dos_factores() -> None:
    base = np.eye(6)
    for i in range(3):
        for j in range(3):
            if i != j:
                base[i][j] = 0.95
                base[i + 3][j + 3] = 0.95
    efectivos = effective_votes(base)
    assert 1.8 < efectivos < 2.5, efectivos


def test_factor_es_la_raiz_de_la_proporcion() -> None:
    assert deflation_factor(6.0, 6) == 1.0
    assert abs(deflation_factor(1.41, 6) - float(np.sqrt(1.41 / 6))) < 1e-12
    # Un `effective` corrupto (mayor que el número de votos) no puede inflar la confianza.
    assert deflation_factor(99.0, 6) == 1.0
    assert deflation_factor(1.0, 0) == 1.0


def test_el_suelo_no_llega_a_morder_con_seis_votos() -> None:
    """Con seis votos el peor caso posible es √(1/6) ≈ 0,408, por encima del suelo de 0,35.

    El suelo no es código muerto: existe para cuando el consejo crezca (M13 añade agentes). Con
    veinte votos que colapsaran en uno, √(1/20) ≈ 0,22 y sí mordería. Se deja documentado para que
    nadie lo retire pensando que sobra, ni lo dé por probado en el tamaño actual.
    """
    assert deflation_factor(1.0, 6) > DEFAULT_FLOOR
    assert deflation_factor(1.0, 20, floor=DEFAULT_FLOOR) == DEFAULT_FLOOR


def test_muestra_insuficiente_no_publica() -> None:
    filas = [dict.fromkeys(VOTE_COLUMNS, 0.5) for _ in range(10)]
    assert correlation_matrix(filas) is None
    assert analyze(filas) is None


def test_analyze_resume_una_muestra_real() -> None:
    rng = np.random.default_rng(7)
    tendencia = rng.normal(size=60)
    reversion = -tendencia + rng.normal(scale=0.05, size=60)
    filas = []
    for i in range(60):
        filas.append(
            {
                "ema_cross_score": float(tendencia[i]),
                "macd_score": float(tendencia[i] + rng.normal(scale=0.05)),
                "supertrend_score": float(tendencia[i] + rng.normal(scale=0.05)),
                "rsi14_score": float(reversion[i]),
                "bbands_score": float(reversion[i] + rng.normal(scale=0.05)),
                "stoch14_score": float(reversion[i] + rng.normal(scale=0.05)),
            }
        )
    resumen = analyze(filas)
    assert resumen is not None
    assert resumen["n"] == 60 and resumen["votes"] == 6
    # Seis votos que en el fondo son uno: debe detectarlo y desinflar con fuerza.
    assert resumen["effective"] < 1.5, resumen
    assert resumen["first_factor"] > 0.8, resumen
    assert resumen["factor"] < 0.55, resumen


def test_voto_constante_no_infla_la_independencia() -> None:
    filas = []
    for i in range(50):
        v = float((i % 7) - 3)
        filas.append(
            {
                "ema_cross_score": v,
                "macd_score": v,
                "supertrend_score": v,
                "rsi14_score": v,
                "bbands_score": v,
                "stoch14_score": 0.0,  # constante
            }
        )
    resumen = analyze(filas)
    assert resumen is not None
    assert resumen["effective"] < 2.2, resumen

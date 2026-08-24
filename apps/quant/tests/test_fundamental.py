"""Fundamental Score (M12): distribución de referencia, percentil y penalización asimétrica."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from trademe_quant.fundamental import (
    DEFAULT_START,
    MIN_COBERTURA,
    MIN_OBSERVACIONES,
    build_artifact,
    cobertura,
    long_penalty,
    percentile_of,
    quantiles,
    write_artifact,
)

MOMENTO = datetime(2026, 8, 18, 12, 0, tzinfo=UTC)


def _muestras(valores: list[float], dias: int = 90) -> list[tuple[datetime, float]]:
    """Reparte los valores de forma uniforme por los `dias` de la ventana.

    Con 270 valores en 90 días salen las tres observaciones diarias que publica Binance, que es lo
    que hay en producción cuando el símbolo tiene su histórico completo.
    """
    n = max(1, len(valores))
    return [(MOMENTO - timedelta(days=int(i * dias / n)), v) for i, v in enumerate(valores)]


def test_quantiles_cubren_el_rango_y_estan_ordenados() -> None:
    valores = [0.0001, 0.00002, 0.00005, 0.00001, 0.00008]
    q = quantiles(valores)
    assert len(q) == 101
    assert q[0] == min(valores)
    assert q[-1] == max(valores)
    assert all(q[i] <= q[i + 1] for i in range(len(q) - 1))


def test_percentil_satura_fuera_de_rango() -> None:
    """Un funding nunca visto es «el más alto conocido», no un percentil 140."""
    knots = quantiles([0.0, 0.5, 1.0])
    assert percentile_of(knots, -5.0) == 0.0
    assert percentile_of(knots, 5.0) == 1.0


def test_percentil_es_monotono() -> None:
    knots = quantiles([i / 100 for i in range(101)])
    anterior = -1.0
    for v in (0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0):
        p = percentile_of(knots, v)
        assert p >= anterior
        anterior = p


def test_percentil_sin_distribucion_es_neutro() -> None:
    """Sin cortes no hay percentil. El centro es la respuesta honesta, no 0 ni 1."""
    assert percentile_of([], 0.001) == 0.5


def test_penalizacion_nula_en_el_tercil_bajo() -> None:
    """El tercil donde los largos rendían +0,200 R no se penaliza. Ese es todo el punto."""
    assert long_penalty(0.0) == 0.0
    assert long_penalty(0.2) == 0.0
    assert long_penalty(DEFAULT_START) == 0.0


def test_penalizacion_crece_hasta_uno() -> None:
    assert long_penalty(0.5) == 0.25
    assert 0.49 < long_penalty(2 / 3) < 0.51
    assert long_penalty(1.0) == 1.0
    assert long_penalty(1.5) == 1.0


def test_artefacto_sin_muestra_suficiente_se_declara_stale() -> None:
    """Sin datos no se penaliza, no se adivina: la api lee `stale` y aplica 0."""
    pocos = [0.0001] * (MIN_OBSERVACIONES - 1)
    # Ventana corta y cubierta al 100 %: así el único motivo posible es el tamaño de la muestra.
    art = build_artifact(
        "BTCUSDT", _muestras(pocos, dias=len(pocos)), MOMENTO, window_days=len(pocos)
    )
    assert art["stale"] is True
    assert art["cobertura"] == 1.0
    assert art["knots"] == []
    assert art["n"] == MIN_OBSERVACIONES - 1


def test_artefacto_con_muestra_suficiente_publica_los_cortes() -> None:
    valores = [i / 100_000 for i in range(270)]  # 3 al día x 90 días, como en producción
    art = build_artifact("BTCUSDT", _muestras(valores), MOMENTO)
    assert art["stale"] is False
    assert len(art["knots"]) == 101
    assert art["symbol"] == "BTCUSDT"
    assert art["window_days"] == 90
    assert art["version"].startswith("fund-")


def test_write_artifact_escribe_donde_la_api_lo_busca(tmp_path: Path) -> None:
    valores = [i / 100_000 for i in range(270)]
    art = build_artifact("ETHUSDT", _muestras(valores), MOMENTO)
    ruta = write_artifact(art, tmp_path)
    assert ruta == tmp_path / "fundamental" / "ETHUSDT.json"
    leido = json.loads(ruta.read_text(encoding="utf8"))
    assert leido["symbol"] == "ETHUSDT"
    assert len(leido["knots"]) == 101


def test_el_percentil_sobrevive_al_cambio_de_regimen() -> None:
    """La razón de ser del percentil frente al umbral fijo.

    El mismo funding absoluto que era extremo en un régimen es corriente en otro. Un umbral fijo
    calibrado sobre el rango observado (0,000003-0,0001) diría «altísimo» para siempre; el percentil
    responde a la única pregunta que se sostiene: ¿está caro comparado con lo normal *ahora*?
    """
    tranquilo = quantiles([i / 1_000_000 for i in range(100)])  # 0 .. 0,0001
    agitado = quantiles([i / 100_000 for i in range(100)])  # 0 .. 0,001
    funding = 0.00009
    assert percentile_of(tranquilo, funding) > 0.85
    assert percentile_of(agitado, funding) < 0.15
    assert long_penalty(percentile_of(tranquilo, funding)) > 0.7
    assert long_penalty(percentile_of(agitado, funding)) == 0.0


def test_muestra_abundante_pero_ventana_a_medias_tambien_es_stale() -> None:
    """El caso real de BTCUSDT: 120 observaciones —cuatro veces el mínimo— en 40 de 90 días.

    Contar observaciones respondía «hay de sobra» a una pregunta que nadie había hecho. La que
    importaba era de cuándo son: una distribución construida sobre menos de la mitad de la ventana
    describe otro periodo, y su percentil deja de ser comparable con el de los demás símbolos.
    """
    art = build_artifact("BTCUSDT", _muestras([0.00005] * 120, dias=40), MOMENTO)

    assert art["n"] > MIN_OBSERVACIONES, "la muestra sobra: el guardia viejo la dejaba pasar"
    assert art["cobertura"] < MIN_COBERTURA
    assert art["stale"] is True
    assert art["knots"] == []


def test_la_cobertura_cuenta_dias_distintos_no_la_distancia_entre_extremos() -> None:
    """Un hueco en mitad de la ventana tiene que notarse.

    Midiendo `max - min` una muestra con los extremos en su sitio y nada en medio parecería
    completa, que es justo el fallo que se persigue.
    """
    extremos = [(MOMENTO, 0.0001), (MOMENTO - timedelta(days=89), 0.0001)]
    assert cobertura([f for f, _ in extremos], window_days=90) < 0.05

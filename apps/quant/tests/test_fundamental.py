"""Fundamental Score (M12): distribución de referencia, percentil y penalización asimétrica."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from trademe_quant.fundamental import (
    DEFAULT_START,
    MIN_OBSERVACIONES,
    build_artifact,
    long_penalty,
    percentile_of,
    quantiles,
    write_artifact,
)

MOMENTO = datetime(2026, 8, 18, 12, 0, tzinfo=UTC)


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
    art = build_artifact("BTCUSDT", [0.0001] * (MIN_OBSERVACIONES - 1), MOMENTO)
    assert art["stale"] is True
    assert art["knots"] == []
    assert art["n"] == MIN_OBSERVACIONES - 1


def test_artefacto_con_muestra_suficiente_publica_los_cortes() -> None:
    valores = [i / 100_000 for i in range(MIN_OBSERVACIONES + 10)]
    art = build_artifact("BTCUSDT", valores, MOMENTO)
    assert art["stale"] is False
    assert len(art["knots"]) == 101
    assert art["symbol"] == "BTCUSDT"
    assert art["window_days"] == 90
    assert art["version"].startswith("fund-")


def test_write_artifact_escribe_donde_la_api_lo_busca(tmp_path: Path) -> None:
    valores = [i / 100_000 for i in range(MIN_OBSERVACIONES + 1)]
    art = build_artifact("ETHUSDT", valores, MOMENTO)
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

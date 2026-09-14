"""Una alerta de cuarentena por cambio de estado, no por ciclo (0.72.2).

Hasta 0.72.1 el piloto respondía con una sola variable a dos preguntas —¿está en cuarentena? y ¿qué
expediente la describe?— y trataba el yaml como suelo mientras la api dejaba mandar al artefacto.
Medido en producción el 14-sep-2026: **3.030 alertas** de cuarentena acumuladas desde agosto, 1.100
de ellas de «4h sale», porque `BTCUSDT:4h` salía de cuarentena en cada pasada. Y la lista blanca se
publicaba como cuarentena: `BTCUSDT:1d` figuraba «en cuarentena» sin haber entrado nunca.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from trademe_quant import quarantine_policy as qp

AHORA = datetime(2026, 9, 14, tzinfo=UTC)


def _filas(n: int, sombra: float | None = None, real: float | None = None) -> list[dict[str, Any]]:
    return [
        {
            "shadow_outcome_return_r": sombra,
            "outcome_return_r": real,
            "captured_at": AHORA - timedelta(minutes=i),
        }
        for i in range(n)
    ]


def _con_datos(monkeypatch: pytest.MonkeyPatch, datos: dict[str, list[dict[str, Any]]]) -> None:
    monkeypatch.setattr(qp, "fetch_expedientes", lambda dsn: (datos, None))


def _ciclos(tmp_path: Path, n: int, *args: Any) -> list[dict[str, Any]]:
    return [qp.publish(tmp_path, "dsn", *args) for _ in range(n)]


def test_una_clave_heredada_del_yaml_sale_una_vez_y_queda_fuera(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """El caso de `BTCUSDT:4h`: 4h en el yaml, sombra muy buena, fuera de la lista blanca."""
    _con_datos(monkeypatch, {"BTCUSDT:4h": _filas(40, sombra=1.0)})
    lista = ["ETHUSDT:1d", "SOLUSDT:1d"]

    salida, *siguientes = _ciclos(tmp_path, 4, ["4h"], [], lista)

    entrada = salida["intervals"]["BTCUSDT:4h"]
    assert (entrada["was_quarantined"], entrada["quarantined"], entrada["changed"]) == (
        True,
        False,
        True,
    )
    assert entrada["base_quarantined"] is True
    for ciclo in siguientes:
        e = ciclo["intervals"]["BTCUSDT:4h"]
        assert (e["was_quarantined"], e["quarantined"], e["changed"]) == (False, False, False)
        assert qp.POR_LISTA_BLANCA in e["reason"]


def test_un_artefacto_de_la_version_anterior_no_rebota(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La misma situación con el artefacto que dejó 0.72.1, sin `base_quarantined`.

    Una entrada antigua se da por decidida con el yaml vigente, así que la salida ya publicada se
    respeta y no vuelve a anunciarse. Es lo que ocurrirá en el primer ciclo tras desplegar.
    """
    (tmp_path / "quarantine.json").write_text(
        '{"intervals": {"BTCUSDT:4h": {"quarantined": false, "was_quarantined": true}}}',
        encoding="utf8",
    )
    _con_datos(monkeypatch, {"BTCUSDT:4h": _filas(40, sombra=1.0)})

    for ciclo in _ciclos(tmp_path, 3, ["4h"], [], ["ETHUSDT:1d"]):
        assert ciclo["intervals"]["BTCUSDT:4h"]["changed"] is False


def test_fuera_de_la_lista_blanca_no_se_publica_como_cuarentena(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`BTCUSDT:1d` no tiene expediente sombra suficiente: antes acababa «en cuarentena» por eso."""
    _con_datos(monkeypatch, {"BTCUSDT:1d": _filas(3, sombra=0.2)})

    for ciclo in _ciclos(tmp_path, 2, [], [], ["ETHUSDT:1d", "SOLUSDT:1d"]):
        e = ciclo["intervals"]["BTCUSDT:1d"]
        assert (e["quarantined"], e["changed"], e["evidence"]["source"]) == (False, False, "sombra")
        assert e["reason"].startswith("sin cuarentena")


def test_fuera_de_la_lista_blanca_entra_si_su_sombra_pierde(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La puerta de entrada, sobre lo que habría hecho: su expediente real está congelado."""
    datos = {"BTCUSDT:4h": _filas(30, sombra=-0.5, real=1.0)}
    _con_datos(monkeypatch, datos)

    entra, sigue = _ciclos(tmp_path, 2, [], [], ["ETHUSDT:1d"])

    e = entra["intervals"]["BTCUSDT:4h"]
    assert (e["quarantined"], e["changed"]) == (True, True)
    assert e["reason"].startswith("entra en cuarentena")
    assert sigue["intervals"]["BTCUSDT:4h"]["changed"] is False


def test_el_yaml_que_anade_una_temporalidad_veta_a_quien_operaba(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Lo que hizo 0.68.0 con 15m, 30m y 1h. Añadirlas al yaml tiene que tener efecto.

    No se anuncia como cambio del gobierno: el veto llegó con el yaml desplegado —la api ya la
    trataba como vetada— y lo que decide el ciclo es si sigue dentro.
    """
    _con_datos(monkeypatch, {"BTCUSDT:1h": _filas(30, sombra=0.3, real=0.3)})
    antes = qp.publish(tmp_path, "dsn", [])
    assert antes["intervals"]["BTCUSDT:1h"]["quarantined"] is False
    assert antes["intervals"]["BTCUSDT:1h"]["base_quarantined"] is False

    despues = qp.publish(tmp_path, "dsn", ["1h"], ["1h"])

    e = despues["intervals"]["BTCUSDT:1h"]
    assert (e["was_quarantined"], e["quarantined"], e["changed"]) == (True, True, False)
    assert e["base_quarantined"] is True
    assert e["evidence"]["source"] == "sombra"


def test_el_umbral_guardado_es_el_que_decidio(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Estructural: la decisión exige el P95 de la nula, y el artefacto tiene que decir lo mismo."""
    ev = {"n": 40, "expectancy": 0.2, "win_rate": 0.5, "nula_mediana": 0.0, "nula_p95": 0.4}
    monkeypatch.setattr(qp, "evaluate_shadow", lambda *_a, **_k: ev)
    _con_datos(monkeypatch, {"BTCUSDT:1h": _filas(40, sombra=0.2)})

    out = qp.publish(tmp_path, "dsn", ["1h"], ["1h"])

    e = out["intervals"]["BTCUSDT:1h"]
    assert e["quarantined"] is True
    assert e["evidence"]["umbral_salida"] == 0.4


def test_las_claves_que_operan_siguen_juzgandose_por_lo_real(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _con_datos(monkeypatch, {"ETHUSDT:1d": _filas(17, sombra=-1.0, real=0.1)})
    e = qp.publish(tmp_path, "dsn", [], [], ["ETHUSDT:1d"])["intervals"]["ETHUSDT:1d"]
    assert (e["quarantined"], e["evidence"]["source"], e["evidence"]["n"]) == (False, "real", 17)
    assert e["reason"].startswith("opera con normalidad")


# --- Las alertas ---------------------------------------------------------------------------------


def test_los_avisos_llevan_la_clave_y_solo_salen_con_cambio() -> None:
    publicado = {
        "intervals": {
            "BTCUSDT:4h": {
                "quarantined": False,
                "changed": True,
                "reason": "sale de cuarentena: x",
            },
            "BNBUSDT:4h": {"quarantined": False, "changed": False, "reason": "sin cuarentena"},
            "ETHUSDT:1h": {
                "quarantined": True,
                "changed": True,
                "reason": "entra en cuarentena: y",
            },
            "SOLUSDT:30m": None,
        }
    }
    avisos = qp.avisos(publicado)
    assert [(a.clave, a.symbol, a.interval, a.severidad, a.titulo) for a in avisos] == [
        ("BTCUSDT:4h", "BTCUSDT", "4h", "success", "BTCUSDT:4h: sale de cuarentena"),
        ("ETHUSDT:1h", "ETHUSDT", "1h", "warning", "ETHUSDT:1h: entra en cuarentena"),
    ]


def test_cuatro_ciclos_de_la_situacion_de_produccion_dan_una_alerta_por_salida(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Las tres claves que salieron el 14-sep-2026, con la lista blanca vigente.

    Con la regla de 0.72.1 esto eran tres alertas por ciclo, indefinidamente.
    """
    datos = {
        "BTCUSDT:4h": _filas(40, sombra=1.088),
        "BNBUSDT:4h": _filas(40, sombra=0.099),
        "ETHUSDT:1h": _filas(40, sombra=0.692),
        "ETHUSDT:1d": _filas(17, real=0.1),
    }
    _con_datos(monkeypatch, datos)
    lista = ["ETHUSDT:1d", "SOLUSDT:1d"]
    alertas = [
        a.clave
        for ciclo in _ciclos(tmp_path, 4, ["15m", "30m", "1h", "4h"], [], lista)
        for a in qp.avisos(ciclo)
    ]
    assert sorted(alertas) == ["BNBUSDT:4h", "BTCUSDT:4h", "ETHUSDT:1h"]

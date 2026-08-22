"""Informe de la nula de cuarentena: que detecte bien qué está vetado y qué está atrapado.

La parte con lógica de verdad es `claves_vetadas`. Quién veta en la plataforma es el artefacto
—por clave `SÍMBOLO:intervalo`—, mientras que `quarantine_policy.publish` elige expediente con la
lista del `ensemble.yaml`, que es por temporalidad. Esa discrepancia deja claves atrapadas, y si el
informe no la calcula bien, no la enseña.
"""

from __future__ import annotations

from typing import Any

from trademe_quant.quarantine_policy import estado_previo
from trademe_quant.run_quarantine_nula import claves_vetadas

DATOS: dict[str, list[dict[str, Any]]] = {
    "BTCUSDT:15m": [],
    "BTCUSDT:4h": [],
    "ETHUSDT:4h": [],
    "SOLUSDT:30m": [],
}


def test_el_artefacto_veta_por_clave() -> None:
    politica = {
        "intervals": {
            "BTCUSDT:15m": {"quarantined": True},
            "SOLUSDT:30m": {"quarantined": False},
        },
        "intervals_yaml": [],
    }
    assert claves_vetadas(DATOS, politica) == {"BTCUSDT:15m"}


def test_el_yaml_veta_por_temporalidad_entera() -> None:
    politica: dict[str, Any] = {"intervals": {}, "intervals_yaml": ["4h"]}
    assert claves_vetadas(DATOS, politica) == {"BTCUSDT:4h", "ETHUSDT:4h"}


def test_se_suman_las_dos_fuentes() -> None:
    """El veto efectivo es la unión: basta con que una de las dos lo diga."""
    politica = {
        "intervals": {"BTCUSDT:15m": {"quarantined": True}},
        "intervals_yaml": ["4h"],
    }
    assert claves_vetadas(DATOS, politica) == {"BTCUSDT:15m", "BTCUSDT:4h", "ETHUSDT:4h"}


def test_sin_politica_no_hay_vetos() -> None:
    assert claves_vetadas(DATOS, {}) == set()


def test_una_entrada_corrupta_no_veta_ni_revienta() -> None:
    """El artefacto lo escribe otro proceso; una entrada rara no puede tumbar el informe."""
    politica = {
        "intervals": {"BTCUSDT:15m": None, "BTCUSDT:4h": "sí", "ETHUSDT:4h": {}},
        "intervals_yaml": [],
    }
    assert claves_vetadas(DATOS, politica) == set()


def test_informe_y_gobierno_no_pueden_discrepar() -> None:
    """La duplicación era la causa del fallo, así que se comprueba que ya no existe.

    Hasta v0.46.0 el informe sabía leer el artefacto por clave y `publish` no. Esa discrepancia
    entre dos copias de la misma regla es lo que dejaba claves condenadas para siempre.
    """
    politica = {
        "intervals": {
            "BTCUSDT:15m": {"quarantined": True},
            "SOLUSDT:30m": {"quarantined": False},
            "ETHUSDT:4h": {"quarantined": False},
        },
        "intervals_yaml": ["4h"],
    }
    delegado = claves_vetadas(DATOS, politica)
    directo = {c for c in DATOS if estado_previo(politica, c, c.split(":", 1)[1], ["4h"])}
    assert delegado == directo
    # Y el yaml sigue siendo suelo: ETHUSDT:4h está vetada pese a que el artefacto decía que no.
    assert "ETHUSDT:4h" in delegado

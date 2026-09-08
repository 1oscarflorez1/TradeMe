"""La alineación macro es donde se cuela el look-ahead, así que se comprueba antes que nada.

Un vector que mira al futuro no da un resultado malo: da uno **bueno y falso**, que es mucho peor
porque nadie lo cuestiona. Estos tests fijan las dos propiedades de las que depende todo el estudio:
que los vectores solo usen pasado y que la alineación nunca entregue un cierre que aún no se había
publicado.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from trademe_quant.series_macro import (
    DIA_MS,
    FICHERO,
    alinear,
    cargar,
    disponible_desde,
    guardar,
)
from trademe_quant.vectores_macro import estres_volatilidad, tendencia_dolar


def _serie(n: int = 60, inicio: str = "2024-01-01") -> list[tuple[str, float]]:
    """Serie diaria sintética con variación suficiente para que el z-score no degenere."""
    d0 = dt.date.fromisoformat(inicio)
    return [
        ((d0 + dt.timedelta(days=i)).isoformat(), 100.0 + (i % 7) * 1.5 + i * 0.1) for i in range(n)
    ]


def _ms(fecha: str, hora: int = 0) -> int:
    d = dt.datetime.fromisoformat(fecha).replace(tzinfo=dt.UTC) + dt.timedelta(hours=hora)
    return int(d.timestamp() * 1000)


# --- Los vectores solo miran hacia atrás -------------------------------------------------------


@pytest.mark.parametrize("vector", [tendencia_dolar, estres_volatilidad])
def test_vector_es_prefijo_calculable(vector) -> None:  # type: ignore[no-untyped-def]
    """El valor en la sesión `t` no puede cambiar porque después ocurran más sesiones.

    Es la condición que `alfa.py` exige y no puede comprobar por sí mismo: se verifica truncando la
    serie y confirmando que el último valor coincide con el que da la serie entera.
    """
    completa = _serie(60)
    entera = vector(completa)
    for corte in (30, 40, 55):
        truncada = vector(completa[:corte])
        fecha = completa[corte - 1][0]
        if fecha in entera and fecha in truncada:
            assert truncada[fecha] == pytest.approx(entera[fecha]), f"{vector.__name__} en {fecha}"


def test_z_score_del_dolar_ignora_ventanas_planas() -> None:
    """Con desviación cero el z-score es indefinido, no neutro: la sesión se omite."""
    plana = [(f"2024-01-{d:02d}", 100.0) for d in range(1, 26)]
    assert tendencia_dolar(plana, ventana=20) == {}


def test_estres_es_el_cambio_logaritmico_no_el_nivel() -> None:
    """Duplicar el nivel de toda la serie no cambia ni un valor del vector de estrés.

    Es la propiedad que lo protege del contango de VXX: si el vector dependiera del nivel, mediría
    sobre todo el 99 % de decaimiento de ocho años, que no es información sobre el miedo.
    """
    base = _serie(40)
    doble = [(f, c * 2) for f, c in base]
    assert estres_volatilidad(doble) == pytest.approx(estres_volatilidad(base))


# --- La alineación no entrega datos del futuro -------------------------------------------------


def test_la_sesion_no_esta_disponible_el_mismo_dia() -> None:
    """La sesión del día D solo se conoce a partir de las 00:00 UTC del día D+1."""
    assert disponible_desde("2024-03-15") == _ms("2024-03-15") + DIA_MS
    assert disponible_desde("2024-03-15") == _ms("2024-03-16")


def test_alinear_nunca_usa_una_sesion_del_futuro() -> None:
    """Para cada vela, el valor asignado es el de una sesión estrictamente anterior a su día."""
    valores = {f: float(i) for i, (f, _) in enumerate(_serie(30))}
    aperturas = [_ms(f, hora) for f, _ in _serie(30) for hora in (0, 12)]
    alineado = alinear(aperturas, valores)

    calendario = sorted(valores)
    for i, t in enumerate(aperturas):
        if i not in alineado:
            continue
        # La sesión de la que salió el valor tiene que estar ya publicada en ese instante.
        origen = next(f for f in calendario if valores[f] == alineado[i])
        assert disponible_desde(origen) <= t


def test_alinear_arrastra_el_ultimo_cierre_conocido() -> None:
    """Un fin de semana no vale cero ni se interpola: se queda con el viernes."""
    viernes, lunes = "2024-03-15", "2024-03-18"
    valores = {viernes: 7.0, lunes: 9.0}
    aperturas = [_ms("2024-03-16"), _ms("2024-03-17"), _ms(lunes), _ms("2024-03-19")]
    assert alinear(aperturas, valores) == {0: 7.0, 1: 7.0, 2: 7.0, 3: 9.0}


def test_alinear_omite_las_velas_anteriores_al_primer_dato() -> None:
    """Sin dato macro la vela se queda fuera del juicio: no tener dato no es tener un cero."""
    valores = {"2024-03-15": 7.0}
    aperturas = [_ms("2024-03-01"), _ms("2024-03-10"), _ms("2024-03-16")]
    assert alinear(aperturas, valores) == {2: 7.0}


def test_alinear_sin_serie_macro_no_devuelve_nada() -> None:
    assert alinear([_ms("2024-03-16")], {}) == {}


# --- Persistencia -------------------------------------------------------------------------------


def test_guardar_y_cargar_conservan_la_serie(tmp_path: Path) -> None:
    series = {"UUP": _serie(5), "VXX": _serie(5, "2024-02-01")}
    guardar(series, tmp_path)
    assert cargar(tmp_path) == series
    assert json.loads((tmp_path / FICHERO).read_text(encoding="utf8"))["descargado"]


def test_cargar_sin_fichero_dice_que_hay_que_descargarlo(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="descargar_macro"):
        cargar(tmp_path)

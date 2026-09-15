"""Cuánto falta para saber si ETHUSDT:1d y SOLUSDT:1d ganan de verdad (0.76.0)."""

from __future__ import annotations

import datetime as dt
import math
import re
from pathlib import Path
from statistics import NormalDist

import pytest
import yaml

import trademe_quant.tamano_muestral as tm
from trademe_quant.scheduler import PREFIJOS_DATOS, resumen_datos

RAIZ = Path(__file__).resolve().parents[3]
INICIO = dt.datetime(2026, 9, 8, tzinfo=dt.UTC)
DIA = dt.timedelta(days=1)
HORIZONTES = {"1d": 10}
CLAVES = ["ETHUSDT:1d", "SOLUSDT:1d"]


def _op(dia: int, r: float, clave: str = "ETHUSDT:1d", base: bool = True) -> tm.Operacion:
    return tm.Operacion(clave=clave, vela=INICIO + dia * DIA, r=r, base=base)


# --- Las piezas ---------------------------------------------------------------------------------


def test_independientes_cuenta_una_por_horizonte() -> None:
    diarias = [INICIO + i * DIA for i in range(26)]
    assert tm.independientes(diarias, 10 * DIA) == [INICIO, INICIO + 10 * DIA, INICIO + 20 * DIA]


def test_independientes_espera_a_que_cierre_la_anterior_aunque_haya_huecos() -> None:
    velas = [INICIO + d * DIA for d in (21, 0, 9, 10, 19)]  # desordenadas a propósito
    assert tm.independientes(velas, 10 * DIA) == [INICIO, INICIO + 10 * DIA, INICIO + 21 * DIA]


def test_sigma_agrupada_no_cuenta_como_dispersion_la_diferencia_entre_claves() -> None:
    sigma, n = tm.sigma_agrupada([[1.0, 3.0], [11.0, 13.0], []])
    assert n == 4
    assert sigma == pytest.approx(math.sqrt(2.0))


def test_sigma_agrupada_sin_grados_de_libertad() -> None:
    assert tm.sigma_agrupada([[1.0], [2.0]]) == (None, 2)


def test_operaciones_necesarias() -> None:
    assert tm.operaciones_necesarias(1.0, 0.25) == math.ceil((2.4864748 / 0.25) ** 2) == 99
    assert tm.operaciones_necesarias(1.0, 0.0) is None
    assert tm.operaciones_necesarias(1.0, -0.1) is None


def test_la_t_entre_filas_es_la_conservadora() -> None:
    assert tm.t_critico(1) == 6.314
    assert tm.t_critico(35) == tm.T95[30]
    assert tm.t_critico(500) == tm.T95[120]
    with pytest.raises(ValueError):
        tm.t_critico(0)


def test_las_constantes_son_las_de_la_normal_y_la_t() -> None:
    assert NormalDist().inv_cdf(0.95) == pytest.approx(tm.Z_ALFA, abs=1e-7)
    assert NormalDist().inv_cdf(0.80) == pytest.approx(tm.Z_POTENCIA, abs=1e-7)
    stats = pytest.importorskip("scipy.stats")
    for gl, t in tm.T95.items():
        real = float(stats.t.ppf(0.95, gl))
        assert real <= t < real + 1e-3, gl  # redondeada hacia arriba: nunca confirma de más


# --- El seguimiento -----------------------------------------------------------------------------


def test_lo_decidido_con_las_optimizadas_no_cuenta_pero_da_la_sigma() -> None:
    """Lo que había el 15-sep-2026: 15 evaluadas, todas de `ens-opt-*`."""
    ops = [_op(i, (-1.0, 2.0, 0.3)[i % 3], c, base=False) for c in CLAVES for i in range(8)]
    filas = {f["clave"]: f for f in tm.seguimiento(ops, CLAVES, HORIZONTES)}

    eth = filas["ETHUSDT:1d"]
    assert eth["evaluadas"] == 0 and eth["independientes"] == 0
    assert eth["estado"] == "SIN MUESTRA"
    assert eth["sigma"] == pytest.approx(
        tm.sigma_agrupada([[o.r for o in ops[:8]], [o.r for o in ops[8:]]])[0]
    )
    assert "16 operaciones" in eth["sigma_origen"]
    assert eth["necesarias"] == tm.operaciones_necesarias(eth["sigma"], 0.0588)
    assert eth["velas_minimas"] == eth["necesarias"] * 10
    assert eth["progreso"] == 0.0


def test_veinte_decisiones_diarias_son_dos_independientes() -> None:
    """La del día siguiente comparte casi todo el recorrido: no es otra observación."""
    ops = [_op(i, (-1.0, 2.0)[i % 2]) for i in range(20)]
    eth = tm.seguimiento(ops, ["ETHUSDT:1d"], HORIZONTES)[0]
    assert eth["evaluadas"] == 20
    assert eth["independientes"] == 2
    t = tm.T95[1]
    assert eth["ic95_inferior"] == pytest.approx(
        eth["media_neta"] - t * eth["sigma"] / math.sqrt(2)
    )


@pytest.mark.parametrize(
    ("valores", "estado"),
    [((1.2, 0.8), "CONFIRMADA"), ((-1.2, -0.8), "PERDIDA"), ((1.0, -1.0), "EN CURSO")],
)
def test_estados(valores: tuple[float, float], estado: str) -> None:
    ops = [_op(10 * i, valores[i % 2]) for i in range(40)]  # una independiente por horizonte
    eth = tm.seguimiento(ops, ["ETHUSDT:1d"], HORIZONTES)[0]
    assert eth["independientes"] == 40
    assert eth["sigma_origen"].startswith("propia")  # 40 evaluadas >= 30
    assert eth["estado"] == estado


def test_lo_medido_en_produccion() -> None:
    """15-sep-2026: σ agrupada 1,069 R con 15 operaciones reales."""
    assert tm.operaciones_necesarias(1.0692004, tm.HIPOTESIS["ETHUSDT:1d"]) == 2045
    assert tm.operaciones_necesarias(1.0692004, tm.HIPOTESIS["SOLUSDT:1d"]) == 672


def test_las_lineas_del_piloto() -> None:
    sin = tm.seguimiento([], CLAVES, HORIZONTES)
    assert (
        tm.lineas(sin)[0]
        == "ETHUSDT:1d 0 independientes (0 evaluadas); sin muestra todavía · SIN MUESTRA"
    )

    ops = [_op(10 * i, (1.0, -1.0)[i % 2]) for i in range(40)]
    linea = tm.lineas(tm.seguimiento(ops, ["ETHUSDT:1d"], HORIZONTES))[0]
    assert "40 independientes (40 evaluadas) de" in linea
    assert "hoy solo se confirmaría" in linea and linea.endswith("· EN CURSO")

    log = [f"muestra: {x}" for x in tm.lineas(sin)] + ["BTCUSDT 15m: expectancy -0.070"]
    assert "muestra:" in PREFIJOS_DATOS
    assert len(resumen_datos(log)) == 2


# --- El check 7 de salud-1d.sql usa la misma regla -----------------------------------------------


def _check7() -> str:
    sql = (RAIZ / "infra" / "salud-1d.sql").read_text(encoding="utf8")
    return sql[sql.index("== 7.") :]


def test_el_check_sql_usa_los_mismos_literales() -> None:
    sql = _check7()
    hipotesis = dict(re.findall(r"\('([A-Z]+:1d)', ([0-9.]+)", sql))
    assert {k: float(v) for k, v in hipotesis.items()} == tm.HIPOTESIS

    tabla = {int(g): float(t) for g, t in re.findall(r"\((\d+), (\d\.\d{3})(?:::float8)?\)", sql)}
    assert tabla == tm.T95

    assert f"{tm.Z_ALFA} + {tm.Z_POTENCIA}" in sql
    assert f"(t + {tm.Z_POTENCIA})" in sql
    assert f"NOT LIKE '{tm.PREFIJO_OPTIMIZADA}%'" in sql
    assert sql.count(f">= {tm.MIN_SIGMA_PROPIA} THEN") == 2


def test_el_check_sql_usa_el_horizonte_del_yaml() -> None:
    base = yaml.safe_load((RAIZ / "artifacts" / "ensemble.yaml").read_text(encoding="utf8"))
    horizonte = int(base["evaluation"]["horizon_by_tf"]["1d"])
    sql = _check7()
    assert f"interval '{horizonte * 24} hours'" in sql
    assert f"necesarias * {horizonte}" in sql
    assert sorted(base["active_keys"]) == sorted(tm.HIPOTESIS)

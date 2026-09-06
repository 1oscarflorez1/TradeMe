"""Los tres vectores nativo-precio: qué miden y, sobre todo, que no miran al futuro."""

from __future__ import annotations

import math
import random

from trademe_quant.alfa import p_falsos_positivos
from trademe_quant.vectores_precio import (
    asimetria_mechas,
    compresion_atr,
    ratio_parkinson,
)


def _serie(n: int, semilla: int = 4) -> tuple[list[float], ...]:
    rnd = random.Random(semilla)
    o: list[float] = []
    h: list[float] = []
    lo: list[float] = []
    c: list[float] = []
    p = 100.0
    for _ in range(n):
        ap = p
        p = max(1.0, p + rnd.uniform(-1.5, 1.5))
        alto = max(ap, p) + abs(rnd.gauss(0.5, 0.3))
        bajo = min(ap, p) - abs(rnd.gauss(0.5, 0.3))
        o.append(ap)
        c.append(p)
        h.append(alto)
        lo.append(bajo)
    return o, h, lo, c


def test_la_asimetria_distingue_rechazo_arriba_de_rechazo_abajo() -> None:
    # Vela con mecha superior larga: subió y la devolvieron.
    arriba = asimetria_mechas([100.0], [110.0], [99.0], [100.5])
    # Y su espejo.
    abajo = asimetria_mechas([100.0], [101.0], [90.0], [99.5])
    assert arriba[0] > 0.5
    assert abajo[0] < -0.5


def test_una_vela_sin_rango_se_omite_en_vez_de_valer_cero() -> None:
    """Un rango cero no es una vela simétrica: es una vela sin información."""
    assert asimetria_mechas([100.0], [100.0], [100.0], [100.0]) == {}


def test_el_ratio_de_parkinson_sube_con_agitacion_sin_direccion() -> None:
    """Mucho recorrido dentro de la vela y poco avance neto: eso es lo que separa del ATR."""
    n = 60
    # Serie A: cierra siempre donde abre, con rangos grandes (agitación pura).
    c = [100.0 + (0.01 if i % 2 else -0.01) for i in range(n)]
    h = [102.0] * n
    lo = [98.0] * n
    agitada = ratio_parkinson(h, lo, c)
    # Serie B: avanza limpio, con rangos pequeños.
    c2 = [100.0 + i for i in range(n)]
    h2 = [x + 0.2 for x in c2]
    lo2 = [x - 0.2 for x in c2]
    limpia = ratio_parkinson(h2, lo2, c2)
    assert agitada[n - 1] > limpia[n - 1] * 2, "la agitación debe dar un ratio mucho mayor"


def test_la_compresion_es_menor_que_uno_cuando_la_volatilidad_se_calma() -> None:
    n = 120
    o, h, lo, c = _serie(n)
    # Últimas 20 velas mucho más tranquilas que las anteriores.
    for i in range(n - 20, n):
        h[i] = c[i] + 0.02
        lo[i] = c[i] - 0.02
    valores = compresion_atr(h, lo, c)
    assert valores[n - 1] < 1.0


def test_ningun_vector_mira_al_futuro() -> None:
    """La condición que `alfa.py` exige y no puede comprobar: se comprueba aquí.

    El valor en `t` calculado sobre la serie truncada en `t` debe ser idéntico al calculado sobre
    la serie entera. Si un vector interpolara o usara una ventana centrada, esto fallaría.
    """
    o, h, lo, c = _serie(200)
    completos = {
        "mechas": asimetria_mechas(o, h, lo, c),
        "parkinson": ratio_parkinson(h, lo, c),
        "compresion": compresion_atr(h, lo, c),
    }
    for t in (80, 120, 199):
        truncados = {
            "mechas": asimetria_mechas(o[: t + 1], h[: t + 1], lo[: t + 1], c[: t + 1]),
            "parkinson": ratio_parkinson(h[: t + 1], lo[: t + 1], c[: t + 1]),
            "compresion": compresion_atr(h[: t + 1], lo[: t + 1], c[: t + 1]),
        }
        for nombre, serie in completos.items():
            if t in serie:
                assert t in truncados[nombre], f"{nombre} pierde el valor en t={t} al truncar"
                assert math.isclose(
                    serie[t], truncados[nombre][t], rel_tol=1e-12
                ), f"{nombre} en t={t}: {serie[t]!r} != {truncados[nombre][t]!r} — mira al futuro"


def test_hacen_falta_tres_de_ocho_para_que_no_sea_ruido() -> None:
    """Con 48 pruebas al 5 %, el azar da 2,4 positivos. Uno solo no demuestra nada."""
    assert p_falsos_positivos(1, 8) > 0.3
    assert p_falsos_positivos(2, 8) > 0.05
    assert p_falsos_positivos(3, 8) < 0.05

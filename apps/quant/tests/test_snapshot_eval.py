"""El evaluador no debe cerrar por tiempo lo que aún no ha tenido tiempo."""

from trademe_quant.backtest import evaluate_trade


def _sin_toque(n: int) -> tuple[list[float], list[float], list[float]]:
    """n velas que se mueven poco: ni objetivo ni stop."""
    return ([101.0] * n, [99.0] * n, [100.0] * n)


def test_toque_de_stop_es_definitivo_aunque_sea_la_primera_vela() -> None:
    res = evaluate_trade("LONG", 100.0, 95.0, 110.0, [101.0], [94.0], [96.0])
    assert res["result"] == "sl"
    assert res["r"] == -1.0


def test_toque_de_objetivo_es_definitivo() -> None:
    res = evaluate_trade("LONG", 100.0, 95.0, 110.0, [111.0], [99.0], [110.5])
    assert res["result"] == "tp"


def test_sin_toque_devuelve_timeout_y_es_el_caso_que_hay_que_filtrar() -> None:
    """evaluate_trade no sabe cuántas velas «debería» haber: eso lo decide quien la llama.

    Por eso el filtro vive en evaluate_snapshot_outcomes: si el resultado es timeout y no se
    dispuso del horizonte completo, el registro se deja pendiente en vez de cerrarse en falso.
    """
    pocas = evaluate_trade("LONG", 100.0, 95.0, 110.0, *_sin_toque(3))
    completas = evaluate_trade("LONG", 100.0, 95.0, 110.0, *_sin_toque(20))
    assert pocas["result"] == "timeout"
    assert completas["result"] == "timeout"
    # Mismo veredicto con 3 velas que con 20: por eso cerrar con 3 sería arbitrario.
    assert pocas["bars"] == 3
    assert completas["bars"] == 20


def test_short_tambien_respeta_el_primer_toque() -> None:
    res = evaluate_trade("SHORT", 100.0, 105.0, 90.0, [106.0], [99.0], [105.5])
    assert res["result"] == "sl"

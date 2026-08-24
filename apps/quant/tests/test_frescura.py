"""Una fuente que responde no es una fuente que informa."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from trademe_quant.dil.frescura import (
    SILENCIO_TOLERABLE_S,
    Estancada,
    esta_estancada,
    resumen,
)

AHORA = datetime(2026, 8, 24, 12, 0, tzinfo=UTC)


def test_una_serie_al_dia_no_se_marca() -> None:
    ayer = AHORA - timedelta(hours=8)
    assert esta_estancada(ayer, AHORA, SILENCIO_TOLERABLE_S["funding_rate"]) is False


def test_el_ipc_congelado_desde_diciembre_se_marca() -> None:
    """El caso real: siete meses sin avanzar con la fuente respondiendo 200 cada doce horas."""
    ultima = datetime(2025, 12, 31, tzinfo=UTC)
    assert esta_estancada(ultima, AHORA, SILENCIO_TOLERABLE_S["ecb_ipc_interanual"]) is True


def test_el_umbral_del_ipc_no_salta_por_el_retraso_normal_de_publicacion() -> None:
    """Un mes de periodicidad más 17 días de retraso siguen siendo funcionamiento normal.

    Si el umbral saltara aquí, avisaría todos los meses y dejaría de leerse — que es como muere un
    aviso útil.
    """
    normal = AHORA - timedelta(days=40)
    assert esta_estancada(normal, AHORA, SILENCIO_TOLERABLE_S["ecb_ipc_interanual"]) is False


def test_el_sentimiento_se_vigila_por_el_nombre_con_el_que_se_guarda() -> None:
    """`sentiment` usa `scope='cripto'`; declararlo como «fear_greed» no vigilaba nada.

    Una clave que no coincide con ningún dato real nunca dispara, y no avisar se ve exactamente
    igual que ir bien.
    """
    assert "cripto" in SILENCIO_TOLERABLE_S
    assert "fear_greed" not in SILENCIO_TOLERABLE_S


def test_resumen_es_legible_para_el_piloto() -> None:
    e = Estancada(
        tabla="macro_series",
        serie="ecb_ipc_interanual",
        ultima=datetime(2025, 12, 31, tzinfo=UTC),
        silencio_s=237 * 86400,
        tolerable_s=45 * 86400,
    )
    r = resumen([e])
    assert r["n"] == 1
    assert r["series"][0]["serie"] == "ecb_ipc_interanual"
    assert "237" in str(r["series"][0]["dias"])
    assert "sin datos nuevos" in str(e)

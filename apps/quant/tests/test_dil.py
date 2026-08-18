"""Tests de la Data Intelligence Layer (M11).

El hito entero se sostiene sobre una regla: un dato solo se puede usar después de conocerse. Estos
tests protegen esa regla, porque si se rompe no falla nada — simplemente los backtests empiezan a
dar resultados magníficos que no se reproducen jamás.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from trademe_quant.dil import DataProvider, ProviderError, Record, Scheduler, run_once
from trademe_quant.dil.macro_ecb import ECBMacro, FREDMacro, _fecha_periodo
from trademe_quant.dil.sentiment_fng import FearAndGreed

AHORA = datetime(2026, 8, 17, 12, 0, tzinfo=UTC)


class ProveedorFalso(DataProvider):
    id = "falso"
    table = "sentiment"
    cadence_s = 60

    def __init__(self, records=None, falla=False, disponible=True):  # type: ignore[no-untyped-def]
        self._records = records or []
        self._falla = falla
        self._disponible = disponible
        self.llamadas = 0

    @property
    def available(self) -> bool:
        return self._disponible

    @property
    def unavailable_reason(self) -> str | None:
        return None if self._disponible else "apagado en la prueba"

    def fetch(self) -> list[Record]:
        self.llamadas += 1
        if self._falla:
            raise ProviderError("la fuente no responde")
        return self._records


# --- Validación: la regla de oro -------------------------------------------------------------


def test_descarta_lo_conocido_antes_de_ocurrir() -> None:
    """Un dato cuya observación es muy posterior a su publicación viene del futuro."""
    p = ProveedorFalso()
    bueno = Record(observed_at=AHORA, published_at=AHORA + timedelta(days=15), value=1.0)
    malo = Record(observed_at=AHORA + timedelta(days=30), published_at=AHORA, value=1.0)
    assert p.validate([bueno, malo]) == [bueno]


def test_descarta_valores_imposibles() -> None:
    p = ProveedorFalso()
    nan = Record(observed_at=AHORA, published_at=AHORA, value=float("nan"))
    inf = Record(observed_at=AHORA, published_at=AHORA, value=float("inf"))
    ok = Record(observed_at=AHORA, published_at=AHORA, value=0.0)
    assert p.validate([nan, inf, ok]) == [ok]


def test_un_valor_nulo_es_legitimo() -> None:
    """Una serie puede no tener dato ese periodo. Eso es informativo, no un error."""
    p = ProveedorFalso()
    r = Record(observed_at=AHORA, published_at=AHORA, value=None)
    assert p.validate([r]) == [r]


# --- Fechas de publicación --------------------------------------------------------------------


def test_el_dato_mensual_se_fecha_al_final_del_periodo() -> None:
    """Fecharlo al día 1 lo adelantaría un mes entero: un dato de julio no existe el 1 de julio."""
    assert _fecha_periodo("2026-07") == datetime(2026, 7, 31, tzinfo=UTC)
    assert _fecha_periodo("2026-02") == datetime(2026, 2, 28, tzinfo=UTC)
    assert _fecha_periodo("2026-12") == datetime(2026, 12, 31, tzinfo=UTC)


def test_trimestres_y_dias() -> None:
    assert _fecha_periodo("2026-Q1") == datetime(2026, 3, 31, tzinfo=UTC)
    assert _fecha_periodo("2026-Q4") == datetime(2026, 12, 31, tzinfo=UTC)
    assert _fecha_periodo("2026-08-14") == datetime(2026, 8, 14, tzinfo=UTC)


def test_el_ipc_se_publica_despues_de_su_periodo() -> None:
    """El caso que justifica la tabla entera: el IPC de julio no existe hasta mediados de agosto."""
    cuerpo = {
        "structure": {"dimensions": {"observation": [{"values": [{"id": "2026-07"}]}]}},
        "dataSets": [{"series": {"0:0:0": {"observations": {"0": [2.4]}}}}],
    }
    rs = ECBMacro._parse(cuerpo, "ecb_ipc_interanual", 17)
    assert len(rs) == 1
    assert rs[0].observed_at == datetime(2026, 7, 31, tzinfo=UTC)
    assert rs[0].published_at > rs[0].observed_at
    assert (rs[0].published_at - rs[0].observed_at).days == 17


def test_una_respuesta_rota_no_revienta() -> None:
    assert ECBMacro._parse({}, "x", 0) == []
    assert ECBMacro._parse({"structure": {}}, "x", 0) == []


# --- Degradación grácil -----------------------------------------------------------------------


def test_una_fuente_apagada_no_es_un_error() -> None:
    p = ProveedorFalso(disponible=False)
    log = run_once("dsn-no-usado", [p])
    assert p.llamadas == 0
    assert "apagado" in log[0]


def test_fred_sin_clave_queda_apagado_no_roto() -> None:
    p = FREDMacro(api_key="")
    assert p.available is False
    assert "gratuita" in (p.unavailable_reason or "")
    assert p.fetch() == []


def test_fred_con_clave_se_activa() -> None:
    assert FREDMacro(api_key="una-clave").available is True


# --- Cadencia ---------------------------------------------------------------------------------


def test_no_se_pregunta_antes_de_tiempo() -> None:
    reloj = {"t": 1000.0}
    s = Scheduler(clock=lambda: reloj["t"])
    p = ProveedorFalso()
    assert s.due(p) is True
    s.mark(p)
    assert s.due(p) is False
    reloj["t"] += p.cadence_s
    assert s.due(p) is True


def test_una_fuente_apagada_nunca_toca() -> None:
    assert Scheduler().due(ProveedorFalso(disponible=False)) is False


# --- Parseo del sentimiento -------------------------------------------------------------------


def test_fng_declara_su_cadencia_y_tabla() -> None:
    p = FearAndGreed()
    assert p.table == "sentiment"
    assert p.cadence_s >= 3600  # es un dato diario: preguntar más sería gastar por gastar


def test_el_planificador_se_comparte_entre_ciclos(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Sin planificador compartido, cada ciclo preguntaría a todas las fuentes.

    La cadencia declarada por cada proveedor sería decorativa y el BCE se consultaría cada pocos
    minutos en vez de dos veces al día. Se aísla la persistencia: esto mide la cadencia, no la
    base de datos.
    """
    from trademe_quant import dil

    monkeypatch.setattr(dil, "store", lambda *a, **k: 0)
    monkeypatch.setattr(dil, "mark_health", lambda *a, **k: None)
    monkeypatch.setattr(dil, "_SCHEDULER", Scheduler())

    p = ProveedorFalso(records=[])
    for _ in range(3):
        dil.run_once("dsn", [p])
    assert p.llamadas == 1, "la cadencia no se respetó entre ciclos"


def test_una_fuente_caida_no_tumba_el_ciclo(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Degradación grácil: la que falla se anota y las demás siguen."""
    from trademe_quant import dil

    monkeypatch.setattr(dil, "store", lambda *a, **k: 0)
    monkeypatch.setattr(dil, "mark_health", lambda *a, **k: None)
    monkeypatch.setattr(dil, "_SCHEDULER", Scheduler())

    rota = ProveedorFalso(falla=True)
    rota.id = "rota"
    sana = ProveedorFalso(records=[])
    sana.id = "sana"
    log = dil.run_once("dsn", [rota, sana])

    assert any("ERROR" in x for x in log)
    assert sana.llamadas == 1, "un fallo en una fuente impidió consultar la siguiente"

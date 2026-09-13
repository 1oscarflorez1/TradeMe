"""Los horizontes de evaluación salen del yaml base, pase lo que pase el llamador.

Antes de 0.72.1 la cuarentena, el meta-modelo y el Fundamental Score filtraban la reproducibilidad
sin pasar horizontes, y la función caía en 20 velas para cualquier temporalidad. Medido en
producción el 13-sep-2026: el meta-modelo entrenaba sin 35 decisiones de 1d —8 de las 16 de
ETHUSDT:1d— y la cuarentena juzgaba 4h con 150 de sus 242 desenlaces de sombra.
"""

from __future__ import annotations

import datetime as dt
import sys
import types
from pathlib import Path
from typing import Any

import pytest
import yaml

import trademe_quant.ensemble as ensemble
from trademe_quant.ensemble import horizontes_evaluacion
from trademe_quant.evaluacion import veredictos
from trademe_quant.ventana import desenlace, trayectoria

RAIZ = Path(__file__).resolve().parents[3]
HORA = 3_600_000
DIA = 24 * HORA


# --- La fuente -----------------------------------------------------------------------------------


def test_lee_el_mapa_del_yaml_base_del_repositorio() -> None:
    crudo = yaml.safe_load((RAIZ / "artifacts" / "ensemble.yaml").read_text(encoding="utf8"))
    esperado = {str(k): int(v) for k, v in crudo["evaluation"]["horizon_by_tf"].items()}
    assert horizontes_evaluacion() == esperado
    assert esperado["1d"] == 10  # el que opera, y el que el valor por defecto de 20 rompía


def _yaml_en(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, evaluacion: Any) -> None:
    base = yaml.safe_load((RAIZ / "artifacts" / "ensemble.yaml").read_text(encoding="utf8"))
    if evaluacion is None:
        base.pop("evaluation", None)
    else:
        base["evaluation"] = evaluacion
    (tmp_path / "ensemble.yaml").write_text(yaml.safe_dump(base), encoding="utf8")
    monkeypatch.setenv("ARTIFACTS_DIR", str(tmp_path))


def test_sigue_al_yaml_desplegado(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _yaml_en(tmp_path, monkeypatch, {"horizon": 20, "horizon_by_tf": {"4h": 12, "1d": 7}})
    assert horizontes_evaluacion() == {"4h": 12, "1d": 7}


def test_sin_mapa_devuelve_vacio(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _yaml_en(tmp_path, monkeypatch, None)
    assert horizontes_evaluacion() == {}


# --- El filtro de reproducibilidad, llamado como lo llaman sus consumidores ----------------------


def _ms(texto: str) -> int:
    return int(dt.datetime.fromisoformat(texto).replace(tzinfo=dt.UTC).timestamp() * 1000)


CAPTURA = dt.datetime(2026, 9, 1, tzinfo=dt.UTC)
DIARIAS_T = [_ms("2026-08-25T00:00:00") + i * DIA for i in range(19)]  # hasta el 12-sep
DIARIAS_V = [(101.0, 99.0, 100.0 + 0.1 * i) for i in range(19)]
HORAS_T = [_ms("2026-09-01T00:00:00") + i * HORA for i in range(24)]
HORAS_V = [(101.0, 99.0, 100.0)] * 24


def _timeout_guardado_con_h10() -> float:
    tray = trayectoria(
        int(CAPTURA.timestamp() * 1000), DIA, 10, DIARIAS_T, DIARIAS_V, HORA, HORAS_T, HORAS_V
    )
    res = desenlace("LONG", 100.0, 95.0, 110.0, tray)
    assert res is not None and res["result"] == "timeout"
    return float(res["r"])


def _base_falsa(monkeypatch: pytest.MonkeyPatch) -> None:
    fila = ("id-1", "ETHUSDT", "1d", CAPTURA, "LONG", 100.0, 95.0, 110.0, "timeout")
    fila_con_r = (*fila, _timeout_guardado_con_h10())

    class _Cur:
        def __init__(self) -> None:
            self.params: Any = None

        def __enter__(self) -> _Cur:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def execute(self, sql: str, params: Any = None) -> None:
            self.sql, self.params = sql, params

        def fetchall(self) -> list[Any]:
            if "FROM snapshots" in self.sql:
                return [fila_con_r]
            _, interval = self.params
            t, v = (DIARIAS_T, DIARIAS_V) if interval == "1d" else (HORAS_T, HORAS_V)
            return [(ts, *vela) for ts, vela in zip(t, v, strict=True)]

    class _Conn:
        def cursor(self) -> _Cur:
            return _Cur()

        def __enter__(self) -> _Conn:
            return self

        def __exit__(self, *_: object) -> None:
            return None

    modulo = types.ModuleType("psycopg")
    modulo.connect = lambda *_a, **_k: _Conn()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "psycopg", modulo)


def test_sin_horizontes_juzga_con_los_del_yaml_y_no_con_20(monkeypatch: pytest.MonkeyPatch) -> None:
    """Así llamaban la cuarentena, el meta-modelo y el Fundamental Score: `veredictos(dsn)`.

    El desenlace se guardó con 10 velas. Con 20 exigiría velas hasta el 20-sep, que no existen, y lo
    daría por «ventana incompleta»: fuera del entrenamiento sin haber hecho nada mal.
    """
    _base_falsa(monkeypatch)
    monkeypatch.setattr(ensemble, "horizontes_evaluacion", lambda: {"1d": 10})

    (v,) = veredictos("dsn-falso")

    assert v.reproducible is True, v.motivo


def test_un_horizonte_explicito_sigue_mandando(monkeypatch: pytest.MonkeyPatch) -> None:
    _base_falsa(monkeypatch)
    monkeypatch.setattr(ensemble, "horizontes_evaluacion", lambda: {"1d": 10})

    (v,) = veredictos("dsn-falso", {"1d": 20})

    assert v.reproducible is False
    assert "ventana incompleta" in v.motivo


# --- La evaluación de pendientes -----------------------------------------------------------------


def test_el_evaluador_sin_horizontes_usa_los_del_yaml(monkeypatch: pytest.MonkeyPatch) -> None:
    import trademe_quant.db as db

    class _Cur:
        def __enter__(self) -> _Cur:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def execute(self, sql: str, params: Any = None) -> None:
            return None

        def fetchall(self) -> list[Any]:
            return [("id-1", "BNBUSDT", "4h", CAPTURA, "SHORT", 100.0, 105.0, 90.0)]

    class _Conn(_Cur):
        def cursor(self) -> _Cur:
            return _Cur()

        def commit(self) -> None:
            return None

    pedidos: list[int] = []

    def falsa(conn: Any, symbol: str, interval: str, captured_at: Any, h: int) -> None:
        pedidos.append(h)
        return None

    modulo = types.ModuleType("psycopg")
    modulo.connect = lambda *_a, **_k: _Conn()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "psycopg", modulo)
    monkeypatch.setattr(db, "_trayectoria_de", falsa)
    monkeypatch.setattr(db, "_velas_sin_duracion", lambda *_a: [])
    monkeypatch.setattr(ensemble, "horizontes_evaluacion", lambda: {"4h": 15})

    db.evaluate_shadow_outcomes("dsn-falso")

    assert pedidos == [15]


def test_el_backtest_de_una_clave_evalua_con_el_mapa_base(monkeypatch: pytest.MonkeyPatch) -> None:
    """La configuración de la clave no trae `horizon_by_tf`, como cuatro yaml optimizados de BTC.

    Antes de 0.72.1 eso bastaba para que las pendientes de **todas** las claves se evaluaran con 20.
    """
    import trademe_quant.run_backtest as rb

    llamadas: list[tuple[str, int, Any]] = []
    sin_mapa = {"risk": {}, "evaluation": {"horizon": 20}}
    monkeypatch.setattr(rb, "series", lambda *_a: ([1.0], [1.0], [1.0]))
    monkeypatch.setattr(rb, "load_active_ensemble", lambda *_a: sin_mapa)
    monkeypatch.setattr(rb, "load_factor", lambda *_a: 1.0)
    monkeypatch.setattr(rb, "run_backtest", lambda *_a, **_k: {"metrics": {}})
    monkeypatch.setattr(rb, "save_backtest", lambda *_a: None)
    monkeypatch.setattr(rb, "horizontes_evaluacion", lambda: {"4h": 15, "1d": 10})

    def registrar(rama: str) -> Any:
        def evaluar(dsn: str, h: int, hs: Any) -> int:
            llamadas.append((rama, h, hs))
            return 0

        return evaluar

    monkeypatch.setattr(rb, "evaluate_snapshot_outcomes", registrar("real"))
    monkeypatch.setattr(rb, "evaluate_shadow_outcomes", registrar("sombra"))

    rb.run_and_save("BTCUSDT", "30m")

    assert llamadas == [("real", 20, {"4h": 15, "1d": 10}), ("sombra", 20, {"4h": 15, "1d": 10})]

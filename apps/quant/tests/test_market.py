from collections.abc import Sequence
from typing import Any

from trademe_quant.market.normalize import Candle, detect_gaps, interval_ms, normalize_rest_kline
from trademe_quant.seed import seed_history


def _row(open_time: int, close: str = "11") -> list[Any]:
    return [open_time, "10", "12", "9", close, "100", open_time + 59_999, "0", 5, "0", "0", "0"]


def test_normalize_rest_kline() -> None:
    candle = normalize_rest_kline("btcusdt", "1m", _row(0))
    assert candle.symbol == "BTCUSDT"
    assert candle.interval == "1m"
    assert candle.close == 11.0
    assert candle.closed is True


def test_interval_ms() -> None:
    assert interval_ms("1m") == 60_000
    assert interval_ms("1h") == 3_600_000


def test_detect_gaps_finds_missing_candle() -> None:
    step = interval_ms("1m")
    candles = [
        normalize_rest_kline("BTCUSDT", "1m", _row(0)),
        normalize_rest_kline("BTCUSDT", "1m", _row(step)),
        # falta la vela en 2*step
        normalize_rest_kline("BTCUSDT", "1m", _row(3 * step)),
    ]
    gaps = detect_gaps(candles, "1m")
    assert gaps == [(step, 3 * step)]


def test_seed_history_is_idempotent_within_batch() -> None:
    step = interval_ms("1m")
    written: list[Candle] = []

    class FakeSink:
        def write(self, candle: Candle) -> None:
            written.append(candle)

    def fake_fetch(symbol: str, interval: str, limit: int) -> Sequence[Sequence[Any]]:
        # incluye un duplicado en open_time=0
        return [_row(0), _row(0), _row(step)]

    count = seed_history("BTCUSDT", "1m", 10, fake_fetch, FakeSink())
    assert count == 2
    assert [c.open_time for c in written] == [0, step]

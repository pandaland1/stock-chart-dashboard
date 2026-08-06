from __future__ import annotations

import pandas as pd
import pytest

from src.config import StockConfig
from src.fetch_data import (
    StockDataError,
    chart_payload_to_frame,
    fetch_stock_data,
    normalise_yfinance_frame,
)


def make_price_frame(start: str, periods: int = 2) -> pd.DataFrame:
    index = pd.date_range(start, periods=periods)
    return pd.DataFrame(
        {
            "Open": range(10, 10 + periods),
            "High": range(12, 12 + periods),
            "Low": range(9, 9 + periods),
            "Close": range(11, 11 + periods),
            "Volume": range(1000, 1000 + periods),
        },
        index=index,
    )


def test_normalises_multiindex_yfinance_columns() -> None:
    index = pd.date_range("2026-08-04", periods=2)
    columns = pd.MultiIndex.from_product(
        [["Open", "High", "Low", "Close", "Volume"], ["PLTR"]]
    )
    frame = pd.DataFrame(
        [[10, 12, 9, 11, 1000], [11, 13, 10, 12, 1200]],
        index=index,
        columns=columns,
    )

    result = normalise_yfinance_frame(frame, "PLTR")

    assert list(result.columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert result.iloc[-1]["Close"] == 12


def test_chart_api_fallback_applies_adjusted_close_ratio() -> None:
    payload = {
        "chart": {
            "error": None,
            "result": [
                {
                    "timestamp": [1785850200, 1785936600],
                    "indicators": {
                        "quote": [
                            {
                                "open": [100.0, 110.0],
                                "high": [105.0, 115.0],
                                "low": [95.0, 105.0],
                                "close": [100.0, 110.0],
                                "volume": [1000, 1200],
                            }
                        ],
                        "adjclose": [{"adjclose": [50.0, 55.0]}],
                    },
                }
            ],
        }
    }

    result = chart_payload_to_frame(payload, "TEST")

    assert result.iloc[0]["Open"] == 50.0
    assert result.iloc[1]["High"] == 57.5
    assert result.iloc[1]["Close"] == 55.0
    assert result.iloc[1]["Volume"] == 1200


def test_stale_yfinance_result_uses_chart_api_fallback() -> None:
    stock = StockConfig(symbol="TEST", name="Test")
    primary_calls: list[str] = []
    fallback_calls: list[str] = []

    result = fetch_stock_data(
        stock,
        max_attempts=1,
        retry_delay_seconds=0,
        minimum_latest_date="2026-08-05",
        downloader=lambda symbol: primary_calls.append(symbol) or make_price_frame("2026-08-02"),
        stale_fallback_downloader=lambda symbol: fallback_calls.append(symbol)
        or make_price_frame("2026-08-04"),
    )

    assert result.index.max() == pd.Timestamp("2026-08-05")
    assert primary_calls == ["TEST"]
    assert fallback_calls == ["TEST"]


def test_stale_primary_and_fallback_results_are_rejected() -> None:
    stock = StockConfig(symbol="TEST", name="Test")

    with pytest.raises(StockDataError, match="기존 데이터 2026-08-05보다 과거"):
        fetch_stock_data(
            stock,
            max_attempts=1,
            retry_delay_seconds=0,
            minimum_latest_date="2026-08-05",
            downloader=lambda _symbol: make_price_frame("2026-08-01"),
            stale_fallback_downloader=lambda _symbol: make_price_frame("2026-08-02"),
        )

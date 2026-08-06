from __future__ import annotations

import pandas as pd

from src.fetch_data import chart_payload_to_frame, normalise_yfinance_frame


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

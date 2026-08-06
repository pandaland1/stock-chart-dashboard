from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.indicators import calculate_indicators


def make_frame(size: int = 240) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Close": np.arange(1, size + 1, dtype=float),
            "Volume": np.ones(size, dtype=float),
        },
        index=pd.date_range("2025-01-01", periods=size, freq="D"),
    )


def test_sma120_and_sma200() -> None:
    result = calculate_indicators(make_frame())

    assert np.isnan(result["sma120"].iloc[118])
    assert result["sma120"].iloc[119] == pytest.approx(60.5)
    assert np.isnan(result["sma200"].iloc[198])
    assert result["sma200"].iloc[199] == pytest.approx(100.5)


def test_vwma100_matches_weighted_formula() -> None:
    frame = make_frame(120)
    frame["Volume"] = np.arange(1, 121, dtype=float)

    result = calculate_indicators(frame)
    expected = (frame["Close"].iloc[:100] * frame["Volume"].iloc[:100]).sum() / frame[
        "Volume"
    ].iloc[:100].sum()

    assert np.isnan(result["vwma100"].iloc[98])
    assert result["vwma100"].iloc[99] == pytest.approx(expected)


def test_vwma_zero_denominator_becomes_nan() -> None:
    frame = make_frame(100)
    frame["Volume"] = 0

    result = calculate_indicators(frame)

    assert np.isnan(result["vwma100"].iloc[-1])


def test_bollinger_band_values_and_order() -> None:
    frame = make_frame(30)
    result = calculate_indicators(frame)
    first_window = frame["Close"].iloc[:20]
    basis = first_window.mean()
    deviation = first_window.std(ddof=0)

    assert np.isnan(result["bbBasis"].iloc[18])
    assert result["bbBasis"].iloc[19] == pytest.approx(basis)
    assert result["bbUpper"].iloc[19] == pytest.approx(basis + deviation * 2)
    assert result["bbLower"].iloc[19] == pytest.approx(basis - deviation * 2)
    valid = result.dropna(subset=["bbUpper", "bbLower"])
    assert (valid["bbUpper"] >= valid["bbLower"]).all()


def test_insufficient_history_keeps_long_indicators_null() -> None:
    result = calculate_indicators(make_frame(50))

    assert result["sma120"].isna().all()
    assert result["sma200"].isna().all()
    assert result["vwma100"].isna().all()

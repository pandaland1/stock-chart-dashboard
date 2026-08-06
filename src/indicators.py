"""프로젝트에서 사용하는 기술적 지표만 계산한다."""

from __future__ import annotations

import numpy as np
import pandas as pd


INDICATOR_COLUMNS = (
    "sma120",
    "sma200",
    "vwma100",
    "bbBasis",
    "bbUpper",
    "bbLower",
)


def calculate_indicators(frame: pd.DataFrame) -> pd.DataFrame:
    """SMA120, SMA200, VWMA100, 20일 볼린저 밴드를 계산한다."""

    missing = {"Close", "Volume"}.difference(frame.columns)
    if missing:
        raise ValueError(f"지표 계산에 필요한 컬럼이 없습니다: {', '.join(sorted(missing))}")

    result = frame.copy()
    close = pd.to_numeric(result["Close"], errors="coerce").astype(float)
    volume = pd.to_numeric(result["Volume"], errors="coerce").astype(float)

    result["sma120"] = close.rolling(window=120, min_periods=120).mean()
    result["sma200"] = close.rolling(window=200, min_periods=200).mean()

    vwma_numerator = (close * volume).rolling(window=100, min_periods=100).sum()
    vwma_denominator = volume.rolling(window=100, min_periods=100).sum()
    result["vwma100"] = vwma_numerator.divide(vwma_denominator.where(vwma_denominator.ne(0)))

    result["bbBasis"] = close.rolling(window=20, min_periods=20).mean()
    bb_std = close.rolling(window=20, min_periods=20).std(ddof=0)
    result["bbUpper"] = result["bbBasis"] + (bb_std * 2)
    result["bbLower"] = result["bbBasis"] - (bb_std * 2)

    result[list(INDICATOR_COLUMNS)] = result[list(INDICATOR_COLUMNS)].replace(
        [np.inf, -np.inf], np.nan
    )
    return result

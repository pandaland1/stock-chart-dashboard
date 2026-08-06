"""yfinance를 이용해 수정주가 기준 일봉 OHLCV를 수집한다."""

from __future__ import annotations

import json
import logging
import tempfile
import time
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import pandas as pd
import yfinance as yf

from .config import StockConfig


LOGGER = logging.getLogger(__name__)
OHLCV_COLUMNS = ("Open", "High", "Low", "Close", "Volume")


class StockDataError(RuntimeError):
    """종목 데이터를 정상적인 OHLCV로 만들 수 없을 때 발생한다."""


@lru_cache(maxsize=1)
def _configure_yfinance_cache() -> None:
    """읽기 전용 홈 환경에서도 yfinance 캐시가 동작하도록 임시 경로를 사용한다."""

    cache_dir = Path(tempfile.gettempdir()) / "market-lens-yfinance-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    yf.set_tz_cache_location(str(cache_dir))


def normalise_yfinance_frame(frame: pd.DataFrame, symbol: str) -> pd.DataFrame:
    """일반 컬럼과 MultiIndex 컬럼을 동일한 OHLCV DataFrame으로 정규화한다."""

    if frame is None or frame.empty:
        raise StockDataError(f"{symbol}: yfinance가 빈 데이터를 반환했습니다.")

    selected: dict[str, pd.Series] = {}
    for field in OHLCV_COLUMNS:
        matching_columns = [
            column
            for column in frame.columns
            if column == field or (isinstance(column, tuple) and field in column)
        ]
        if not matching_columns:
            raise StockDataError(f"{symbol}: 필수 컬럼 {field}을(를) 찾을 수 없습니다.")
        selected[field] = frame[matching_columns[0]]

    normalised = pd.DataFrame(selected, index=frame.index)
    normalised.index = pd.to_datetime(normalised.index, errors="coerce", utc=True).tz_convert(None)
    normalised = normalised.loc[~normalised.index.isna()].copy()

    for column in OHLCV_COLUMNS:
        normalised[column] = pd.to_numeric(normalised[column], errors="coerce")

    normalised = (
        normalised.dropna(subset=["Open", "High", "Low", "Close", "Volume"])
        .sort_index()
        .loc[lambda data: ~data.index.duplicated(keep="last")]
    )
    normalised = normalised.loc[normalised["Volume"] >= 0]

    if len(normalised) < 2:
        raise StockDataError(f"{symbol}: 유효한 거래일 데이터가 2건 미만입니다.")

    return normalised


def _download(symbol: str) -> pd.DataFrame:
    """yfinance 호출을 한 곳에 모아 수정주가 정책을 명시한다."""

    _configure_yfinance_cache()
    options = {
        "tickers": symbol,
        "period": "3y",
        "interval": "1d",
        "auto_adjust": True,
        "actions": False,
        "progress": False,
        "threads": False,
        "timeout": 30,
        "multi_level_index": True,
    }
    try:
        frame = yf.download(**options)
    except TypeError as exc:
        # 구버전 yfinance에서 multi_level_index 인자를 지원하지 않는 경우에도 동작한다.
        if "multi_level_index" not in str(exc):
            LOGGER.warning("[%s] yfinance 호출 오류, Yahoo Chart API로 전환: %s", symbol, exc)
            return _download_chart_api(symbol)
        legacy_options = options.copy()
        legacy_options.pop("multi_level_index")
        frame = yf.download(**legacy_options)
    except Exception as exc:
        LOGGER.warning("[%s] yfinance 호출 오류, Yahoo Chart API로 전환: %s", symbol, exc)
        return _download_chart_api(symbol)

    if frame is None or frame.empty:
        LOGGER.warning("[%s] yfinance가 빈 결과를 반환해 Yahoo Chart API로 전환합니다.", symbol)
        return _download_chart_api(symbol)
    return frame


def _download_chart_api(symbol: str) -> pd.DataFrame:
    """yfinance 요청 제한 시 Yahoo Chart 응답을 같은 수정주가 기준으로 변환한다."""

    parameters = urlencode(
        {
            "range": "3y",
            "interval": "1d",
            "events": "div,splits",
            "includeAdjustedClose": "true",
        }
    )
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}?{parameters}"
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; MarketLens/1.0; personal-study)",
        },
    )
    with urlopen(request, timeout=30) as response:  # noqa: S310 - 고정 HTTPS 호스트만 사용한다.
        payload = json.load(response)
    return chart_payload_to_frame(payload, symbol)


def chart_payload_to_frame(payload: dict, symbol: str) -> pd.DataFrame:
    """Yahoo Chart JSON의 raw OHLC를 Adj Close 비율로 보정해 DataFrame으로 만든다."""

    chart = payload.get("chart") if isinstance(payload, dict) else None
    error = chart.get("error") if isinstance(chart, dict) else None
    results = chart.get("result") if isinstance(chart, dict) else None
    if error or not isinstance(results, list) or not results:
        raise StockDataError(f"{symbol}: Yahoo Chart API 응답 오류: {error or '결과 없음'}")

    result = results[0]
    timestamps = result.get("timestamp")
    indicators = result.get("indicators", {})
    quotes = indicators.get("quote")
    if not isinstance(timestamps, list) or not isinstance(quotes, list) or not quotes:
        raise StockDataError(f"{symbol}: Yahoo Chart API에 OHLCV 데이터가 없습니다.")

    quote_values = quotes[0]
    expected_size = len(timestamps)
    source_fields = ("open", "high", "low", "close", "volume")
    if any(len(quote_values.get(field, [])) != expected_size for field in source_fields):
        raise StockDataError(f"{symbol}: Yahoo Chart API의 OHLCV 배열 길이가 일치하지 않습니다.")

    index = (
        pd.to_datetime(timestamps, unit="s", errors="coerce", utc=True)
        .tz_convert("America/New_York")
        .tz_localize(None)
        .normalize()
    )
    frame = pd.DataFrame(
        {
            "Open": quote_values["open"],
            "High": quote_values["high"],
            "Low": quote_values["low"],
            "Close": quote_values["close"],
            "Volume": quote_values["volume"],
        },
        index=index,
    )

    adjusted_groups = indicators.get("adjclose")
    adjusted_values = (
        adjusted_groups[0].get("adjclose")
        if isinstance(adjusted_groups, list) and adjusted_groups
        else None
    )
    if isinstance(adjusted_values, list) and len(adjusted_values) == expected_size:
        raw_close = pd.to_numeric(frame["Close"], errors="coerce")
        adjusted_close = pd.to_numeric(pd.Series(adjusted_values, index=index), errors="coerce")
        adjustment_ratio = adjusted_close.divide(raw_close).replace(
            [float("inf"), float("-inf")], pd.NA
        )
        adjustment_ratio = adjustment_ratio.fillna(1.0)
        for field in ("Open", "High", "Low", "Close"):
            frame[field] = pd.to_numeric(frame[field], errors="coerce") * adjustment_ratio

    return frame


def fetch_stock_data(
    stock: StockConfig,
    *,
    max_attempts: int = 3,
    retry_delay_seconds: float = 5.0,
    downloader: Callable[[str], pd.DataFrame] = _download,
) -> pd.DataFrame:
    """종목 일봉을 최대 3회 재시도해 가져온다."""

    if max_attempts < 1:
        raise ValueError("max_attempts는 1 이상이어야 합니다.")

    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        LOGGER.info("[%s] 데이터 수집 시작 (%d/%d)", stock.symbol, attempt, max_attempts)
        try:
            frame = normalise_yfinance_frame(downloader(stock.symbol), stock.symbol)
            LOGGER.info(
                "[%s] 데이터 수집 성공: %s ~ %s, %d건",
                stock.symbol,
                frame.index.min().strftime("%Y-%m-%d"),
                frame.index.max().strftime("%Y-%m-%d"),
                len(frame),
            )
            return frame
        except Exception as exc:  # 종목별 장애를 격리하기 위해 호출 경계에서 포착한다.
            last_error = exc
            LOGGER.warning("[%s] 데이터 수집 실패 (%d/%d): %s", stock.symbol, attempt, max_attempts, exc)
            if attempt < max_attempts:
                time.sleep(retry_delay_seconds * attempt)

    raise StockDataError(
        f"{stock.symbol}: {max_attempts}회 시도 후에도 데이터를 수집하지 못했습니다: {last_error}"
    ) from last_error

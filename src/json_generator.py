"""DataFrame을 브라우저가 바로 읽을 수 있는 표준 JSON으로 변환한다."""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .config import StockConfig
from .indicators import INDICATOR_COLUMNS


PRICE_FIELDS = ("open", "high", "low", "close") + INDICATOR_COLUMNS
OHLCV_SOURCE_COLUMNS = {
    "open": "Open",
    "high": "High",
    "low": "Low",
    "close": "Close",
    "volume": "Volume",
}


def to_json_value(value: Any, *, decimal_places: int | None = None) -> Any:
    """pandas/numpy 값을 NaN이 없는 기본 Python JSON 타입으로 바꾼다."""

    if value is None:
        return None
    if isinstance(value, (pd.Timestamp, np.datetime64, datetime, date)):
        return pd.Timestamp(value).strftime("%Y-%m-%d")
    if isinstance(value, (bool, np.bool_)):
        return bool(value)

    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass

    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        number = float(value)
        if not np.isfinite(number):
            return None
        return round(number, decimal_places) if decimal_places is not None else number
    if isinstance(value, str):
        return value
    return value


def dataframe_to_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """지표가 포함된 DataFrame을 날짜 오름차순 차트 레코드로 바꾼다."""

    missing = set(OHLCV_SOURCE_COLUMNS.values()).difference(frame.columns)
    if missing:
        raise ValueError(f"JSON 변환에 필요한 컬럼이 없습니다: {', '.join(sorted(missing))}")

    working = frame.copy()
    working.index = pd.to_datetime(working.index, errors="coerce")
    working = working.loc[~working.index.isna()].sort_index()

    records: list[dict[str, Any]] = []
    for timestamp, row in working.iterrows():
        record: dict[str, Any] = {"time": pd.Timestamp(timestamp).strftime("%Y-%m-%d")}
        for target, source in OHLCV_SOURCE_COLUMNS.items():
            places = 4 if target != "volume" else None
            record[target] = to_json_value(row[source], decimal_places=places)

        if record["volume"] is not None:
            record["volume"] = int(round(float(record["volume"])))

        for indicator in INDICATOR_COLUMNS:
            record[indicator] = to_json_value(row.get(indicator), decimal_places=4)
        records.append(record)

    if not records:
        raise ValueError("JSON으로 변환할 유효한 거래일 데이터가 없습니다.")
    return records


def build_stock_summary(
    stock: StockConfig,
    records: list[dict[str, Any]],
    *,
    update_status: str = "success",
    error_message: str | None = None,
) -> dict[str, Any]:
    """종목의 최신 거래일을 기준으로 요약 정보를 만든다."""

    if len(records) < 2:
        raise ValueError(f"{stock.symbol}: 요약 생성에는 거래일 데이터가 2건 이상 필요합니다.")

    latest = records[-1]
    previous = records[-2]
    close = float(latest["close"])
    previous_close = float(previous["close"])
    change = close - previous_close
    change_percent = (change / previous_close * 100) if previous_close else None

    summary: dict[str, Any] = {
        "symbol": stock.symbol,
        "companyName": stock.name,
        "tradeDate": latest["time"],
        "close": round(close, 4),
        "previousClose": round(previous_close, 4),
        "change": round(change, 4),
        "changePercent": round(change_percent, 4) if change_percent is not None else None,
        "volume": latest["volume"],
    }
    for indicator in INDICATOR_COLUMNS:
        summary[indicator] = latest[indicator]

    summary.update(
        {
            "dataPath": f"./data/{stock.symbol}.json",
            "updateStatus": update_status,
            "errorMessage": error_message,
        }
    )
    return summary


def build_empty_error_summary(stock: StockConfig, error_message: str) -> dict[str, Any]:
    """사용 가능한 기존 데이터도 없는 실패 종목의 요약을 만든다."""

    summary: dict[str, Any] = {
        "symbol": stock.symbol,
        "companyName": stock.name,
        "tradeDate": None,
        "close": None,
        "previousClose": None,
        "change": None,
        "changePercent": None,
        "volume": None,
    }
    for indicator in INDICATOR_COLUMNS:
        summary[indicator] = None
    summary.update(
        {
            "dataPath": None,
            "updateStatus": "error",
            "errorMessage": error_message,
        }
    )
    return summary


def write_json(path: Path, payload: Any) -> None:
    """NaN을 거부하는 표준 JSON을 UTF-8로 기록한다."""

    encoded = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(encoded, encoding="utf-8")

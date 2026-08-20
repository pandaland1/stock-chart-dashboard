"""관심 종목 데이터를 생성하는 명령행 진입점."""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd

from .config import SITE_DATA_DIR, StockConfig, load_stocks
from .fetch_data import fetch_stock_data, fetch_stock_history
from .indicators import calculate_indicators
from .json_generator import (
    build_empty_error_summary,
    build_stock_summary,
    dataframe_to_records,
    write_json,
)
from .sentiment_analysis import build_sentiment_analysis
from .sentiment_data import (
    CNN_SOURCE_PAGE,
    SentimentDataError,
    load_sentiment_file,
    update_sentiment_file,
)


LOGGER = logging.getLogger(__name__)


def _load_stale_records(path: Path) -> list[dict[str, Any]] | None:
    """일시적 수집 실패 시 이전에 생성된 종목 JSON을 재사용한다."""

    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, list) or len(payload) < 2:
        return None
    return payload


def _latest_record_date(records: list[dict[str, Any]] | None) -> str | None:
    """기존 JSON에서 비교 가능한 가장 최근 거래일을 찾는다."""

    if not records:
        return None
    dates = [
        record.get("time")
        for record in records
        if isinstance(record, dict) and isinstance(record.get("time"), str)
    ]
    return max(dates, default=None)


def _error_summary(stock: StockConfig, output_path: Path, message: str) -> dict[str, Any]:
    stale_records = _load_stale_records(output_path)
    if stale_records:
        LOGGER.warning("[%s] 기존 JSON 데이터를 유지합니다.", stock.symbol)
        return build_stock_summary(
            stock,
            stale_records,
            update_status="error",
            error_message=message,
        )
    return build_empty_error_summary(stock, message)


def _records_to_frame(records: list[dict[str, Any]]) -> pd.DataFrame:
    """저장된 수정주가 JSON을 증분 병합용 OHLCV DataFrame으로 복원한다."""

    frame = pd.DataFrame(
        {
            "Open": [record.get("open") for record in records],
            "High": [record.get("high") for record in records],
            "Low": [record.get("low") for record in records],
            "Close": [record.get("close") for record in records],
            "Volume": [record.get("volume") for record in records],
        },
        index=pd.to_datetime([record.get("time") for record in records], errors="coerce"),
    )
    frame = frame.loc[~frame.index.isna()].sort_index()
    for column in ("Open", "High", "Low", "Close", "Volume"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.dropna().loc[lambda data: ~data.index.duplicated(keep="last")]


def _fetch_qqq_records(
    stock: StockConfig,
    existing_records: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """QQQ는 최초 전체 수집, 이후 14일 겹침 증분 병합 후 지표를 재계산한다."""

    existing_records = existing_records or []
    has_full_history = (
        len(existing_records) >= 5_000
        and existing_records[0].get("time", "9999") <= "2000-12-31"
    )
    force_full = os.environ.get("MARKET_LENS_FULL_REFRESH") == "1" or not has_full_history
    latest = _latest_record_date(existing_records) if has_full_history and not force_full else None
    fresh = fetch_stock_history(
        stock,
        existing_latest_date=latest,
        force_full=force_full,
    )

    if existing_records and not force_full:
        combined = pd.concat([_records_to_frame(existing_records), fresh]).sort_index()
        combined = combined.loc[~combined.index.duplicated(keep="last")]
    else:
        combined = fresh
    return dataframe_to_records(calculate_indicators(combined))


def _validate_price_records(records: list[dict[str, Any]], symbol: str) -> None:
    dates = [record.get("time") for record in records]
    if dates != sorted(set(dates)):
        raise ValueError(f"{symbol}: 거래일이 오름차순 고유값이 아닙니다.")
    today = datetime.now(UTC).date().isoformat()
    if dates and dates[-1] > today:
        raise ValueError(f"{symbol}: 미래 거래일이 포함되었습니다: {dates[-1]}")
    if any(not isinstance(record.get("close"), (int, float)) or record["close"] <= 0 for record in records):
        raise ValueError(f"{symbol}: 0 이하이거나 유효하지 않은 종가가 포함되었습니다.")


def _build_sentiment_assets(generated_at: str) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Sentiment 원본과 분석 파일을 갱신하고 상태 메타데이터를 만든다."""

    sentiment_dir = SITE_DATA_DIR / "sentiment"
    sentiment_path = sentiment_dir / "fear-greed.json"
    analytics_path = sentiment_dir / "analytics.json"
    previous = load_sentiment_file(sentiment_path)
    update_status = "success"
    error_message: str | None = None

    try:
        sentiment = update_sentiment_file(sentiment_path)
    except SentimentDataError as exc:
        sentiment = previous
        update_status = "error"
        error_message = str(exc)[:500]
        LOGGER.exception("Fear & Greed 갱신 실패, 기존 정상 데이터를 유지합니다.")

    metadata: dict[str, Any] = {
        "source": "CNN Fear & Greed Index",
        "sourceUrl": CNN_SOURCE_PAGE,
        "dataPath": "./data/sentiment/fear-greed.json",
        "analyticsPath": "./data/sentiment/analytics.json",
        "updateStatus": update_status,
        "errorMessage": error_message,
        "lastSuccessfulUpdate": sentiment.get("generatedAt") if sentiment else None,
    }
    if not sentiment:
        return None, metadata

    qqq_records = _load_stale_records(SITE_DATA_DIR / "QQQ.json")
    if not qqq_records:
        metadata.update(
            {
                "updateStatus": "error",
                "errorMessage": "QQQ 데이터가 없어 Sentiment 분석을 생성하지 못했습니다.",
            }
        )
        return sentiment, metadata

    analysis = build_sentiment_analysis(qqq_records, sentiment["records"])
    analysis["generatedAt"] = generated_at
    write_json(analytics_path, analysis)
    metadata.update(
        {
            "firstAvailableDate": sentiment["firstAvailableDate"],
            "lastAvailableDate": sentiment["lastAvailableDate"],
            "commonPeriod": analysis["commonPeriod"],
        }
    )
    return sentiment, metadata


def run() -> int:
    """모든 종목을 처리하고 성공 종목이 하나도 없으면 실패 코드를 반환한다."""

    stocks = load_stocks()
    SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

    summaries: list[dict[str, Any]] = []
    succeeded = 0
    failed_symbols: list[str] = []

    for stock in stocks:
        output_path = SITE_DATA_DIR / f"{stock.symbol}.json"
        existing_records = _load_stale_records(output_path)
        minimum_latest_date = _latest_record_date(existing_records)
        try:
            if stock.symbol == "QQQ":
                records = _fetch_qqq_records(stock, existing_records)
            else:
                raw_frame = fetch_stock_data(stock, minimum_latest_date=minimum_latest_date)
                records = dataframe_to_records(calculate_indicators(raw_frame))
            _validate_price_records(records, stock.symbol)
            write_json(output_path, records)
            summaries.append(build_stock_summary(stock, records))
            succeeded += 1
            LOGGER.info("[%s] JSON 생성 성공: %s", stock.symbol, output_path)
        except Exception as exc:  # 한 종목 실패가 다음 종목 처리를 막지 않도록 격리한다.
            message = str(exc)[:500]
            failed_symbols.append(stock.symbol)
            summaries.append(_error_summary(stock, output_path, message))
            LOGGER.exception("[%s] 처리 실패", stock.symbol)

    generated_at = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    sentiment, sentiment_metadata = _build_sentiment_assets(generated_at)
    qqq_records = _load_stale_records(SITE_DATA_DIR / "QQQ.json") or []
    data_version = generated_at.replace("-", "").replace(":", "").replace("T", "-").replace("Z", "")

    write_json(SITE_DATA_DIR / "stocks.json", summaries)
    write_json(
        SITE_DATA_DIR / "metadata.json",
        {
            "generatedAt": generated_at,
            "source": "Yahoo Finance via yfinance; CNN Fear & Greed Index",
            "period": "QQQ max; other symbols 3y",
            "interval": "1d",
            "autoAdjust": True,
            "dataVersion": data_version,
            "stocksAttempted": len(stocks),
            "stocksSucceeded": succeeded,
            "failedSymbols": failed_symbols,
            "qqq": {
                "firstAvailableDate": qqq_records[0]["time"] if qqq_records else None,
                "lastAvailableDate": qqq_records[-1]["time"] if qqq_records else None,
                "records": len(qqq_records),
                "updateMode": "initial max history, then 14-day overlap incremental merge",
            },
            "sentiment": sentiment_metadata,
        },
    )

    if succeeded == 0:
        LOGGER.error("모든 종목의 데이터 생성이 실패했습니다. 배포를 중단합니다.")
        return 1
    if sentiment is None:
        LOGGER.error("사용 가능한 Fear & Greed 데이터가 없어 배포를 중단합니다.")
        return 1

    LOGGER.info("데이터 생성 완료: 성공 %d, 실패 %d", succeeded, len(failed_symbols))
    return 0


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
    raise SystemExit(run())


if __name__ == "__main__":
    main()

"""관심 종목 데이터를 생성하는 명령행 진입점."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import SITE_DATA_DIR, StockConfig, load_stocks
from .fetch_data import fetch_stock_data
from .indicators import calculate_indicators
from .json_generator import (
    build_empty_error_summary,
    build_stock_summary,
    dataframe_to_records,
    write_json,
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


def run() -> int:
    """모든 종목을 처리하고 성공 종목이 하나도 없으면 실패 코드를 반환한다."""

    stocks = load_stocks()
    SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

    summaries: list[dict[str, Any]] = []
    succeeded = 0
    failed_symbols: list[str] = []

    for stock in stocks:
        output_path = SITE_DATA_DIR / f"{stock.symbol}.json"
        try:
            raw_frame = fetch_stock_data(stock)
            records = dataframe_to_records(calculate_indicators(raw_frame))
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
    write_json(SITE_DATA_DIR / "stocks.json", summaries)
    write_json(
        SITE_DATA_DIR / "metadata.json",
        {
            "generatedAt": generated_at,
            "source": "Yahoo Finance via yfinance",
            "period": "3y",
            "interval": "1d",
            "autoAdjust": True,
            "stocksAttempted": len(stocks),
            "stocksSucceeded": succeeded,
            "failedSymbols": failed_symbols,
        },
    )

    if succeeded == 0:
        LOGGER.error("모든 종목의 데이터 생성이 실패했습니다. 배포를 중단합니다.")
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

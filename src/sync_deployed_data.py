"""저장소와 현재 GitHub Pages 중 더 최신인 시장 데이터를 작업 공간에 준비한다."""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import SITE_DATA_DIR
from .json_generator import write_json
from .sentiment_data import SentimentDataError, validate_sentiment_records


LOGGER = logging.getLogger(__name__)
DEPLOYED_DATA_BASE_URL = (
    "https://pandaland1.github.io/stock-chart-dashboard/data"
)
_SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.-]{0,14}$")


class DeployedDataError(RuntimeError):
    """배포 데이터의 조회 또는 검증에 실패했다."""


def _fetch_json(url: str) -> Any:
    """캐시를 우회해 고정된 Pages 주소에서 JSON을 읽는다."""

    cache_busted_url = f"{url}?sync={time.time_ns()}"
    request = Request(
        cache_busted_url,
        headers={
            "Accept": "application/json",
            "Cache-Control": "no-cache",
            "User-Agent": "Market-Lens-data-sync/1.0",
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        raise DeployedDataError(f"배포 JSON을 읽지 못했습니다: {url}: {exc}") from exc


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DeployedDataError(f"로컬 JSON을 읽지 못했습니다: {path}: {exc}") from exc


def _parse_trade_date(value: Any, context: str) -> date | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise DeployedDataError(f"{context}의 tradeDate는 문자열이어야 합니다.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise DeployedDataError(f"{context}의 tradeDate가 올바르지 않습니다: {value}") from exc


def _validate_summaries(
    payload: Any,
    source: str,
) -> tuple[list[dict[str, Any]], dict[str, date | None]]:
    if not isinstance(payload, list) or not payload:
        raise DeployedDataError(f"{source} stocks.json은 비어 있지 않은 배열이어야 합니다.")

    summaries: list[dict[str, Any]] = []
    dates: dict[str, date | None] = {}
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise DeployedDataError(f"{source} stocks.json {index}번 항목이 객체가 아닙니다.")

        symbol = item.get("symbol")
        if not isinstance(symbol, str) or not _SYMBOL_PATTERN.fullmatch(symbol):
            raise DeployedDataError(f"{source} stocks.json의 종목 코드가 올바르지 않습니다.")
        if symbol in dates:
            raise DeployedDataError(f"{source} stocks.json에 {symbol}이 중복되었습니다.")

        trade_date = _parse_trade_date(item.get("tradeDate"), f"{source} {symbol}")
        data_path = item.get("dataPath")
        expected_path = f"./data/{symbol}.json"
        if trade_date is not None and data_path != expected_path:
            raise DeployedDataError(f"{source} {symbol}의 dataPath가 올바르지 않습니다.")
        if data_path is not None and data_path != expected_path:
            raise DeployedDataError(f"{source} {symbol}의 dataPath가 안전하지 않습니다.")

        summaries.append(item)
        dates[symbol] = trade_date

    return summaries, dates


def _validate_records(payload: Any, symbol: str, expected_date: date) -> list[dict[str, Any]]:
    if not isinstance(payload, list) or len(payload) < 2:
        raise DeployedDataError(f"배포된 {symbol}.json에는 거래일 데이터가 2건 이상 필요합니다.")

    record_dates: list[date] = []
    for index, record in enumerate(payload, start=1):
        if not isinstance(record, dict):
            raise DeployedDataError(f"배포된 {symbol}.json {index}번 항목이 객체가 아닙니다.")
        value = record.get("time")
        if not isinstance(value, str):
            raise DeployedDataError(f"배포된 {symbol}.json {index}번 날짜가 올바르지 않습니다.")
        try:
            record_dates.append(date.fromisoformat(value))
        except ValueError as exc:
            raise DeployedDataError(
                f"배포된 {symbol}.json {index}번 날짜가 올바르지 않습니다: {value}"
            ) from exc

    if record_dates != sorted(set(record_dates)):
        raise DeployedDataError(f"배포된 {symbol}.json의 거래일이 오름차순 고유값이 아닙니다.")
    if record_dates[-1] != expected_date:
        raise DeployedDataError(
            f"배포된 {symbol}.json의 최신 거래일이 stocks.json과 일치하지 않습니다."
        )
    return payload


def _validate_sentiment_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise DeployedDataError("배포 fear-greed.json은 객체여야 합니다.")
    try:
        records = validate_sentiment_records(payload.get("records"))
    except SentimentDataError as exc:
        raise DeployedDataError(f"배포 Fear & Greed 데이터가 올바르지 않습니다: {exc}") from exc
    if payload.get("firstAvailableDate") != records[0]["time"]:
        raise DeployedDataError("배포 Fear & Greed 최초 날짜가 records와 일치하지 않습니다.")
    if payload.get("lastAvailableDate") != records[-1]["time"]:
        raise DeployedDataError("배포 Fear & Greed 최신 날짜가 records와 일치하지 않습니다.")
    return {**payload, "records": records}


def _sentiment_paths(metadata: Any) -> tuple[str, str] | None:
    if not isinstance(metadata, dict):
        return None
    sentiment = metadata.get("sentiment")
    if not isinstance(sentiment, dict):
        return None
    data_path = sentiment.get("dataPath")
    analytics_path = sentiment.get("analyticsPath")
    if data_path != "./data/sentiment/fear-greed.json":
        return None
    if analytics_path != "./data/sentiment/analytics.json":
        return None
    return "sentiment/fear-greed.json", "sentiment/analytics.json"


def restore_latest_deployed_data(
    data_dir: Path = SITE_DATA_DIR,
    *,
    fetch_json: Callable[[str], Any] = _fetch_json,
    base_url: str = DEPLOYED_DATA_BASE_URL,
) -> bool:
    """Pages의 전체 데이터셋이 더 최신이면 검증 후 로컬 데이터에 복원한다."""

    local_payload = _load_json(data_dir / "stocks.json")
    local_summaries, local_dates = _validate_summaries(local_payload, "로컬")

    base_url = base_url.rstrip("/")
    deployed_payload = fetch_json(f"{base_url}/stocks.json")
    deployed_summaries, deployed_dates = _validate_summaries(deployed_payload, "배포")

    common_symbols = set(local_dates).intersection(deployed_dates)
    local_only_symbols = set(local_dates).difference(deployed_dates)
    deployed_only_symbols = set(deployed_dates).difference(local_dates)

    if local_only_symbols:
        LOGGER.info(
            "새로 추가된 로컬 종목은 그대로 유지합니다: %s",
            ", ".join(sorted(local_only_symbols)),
        )
    if deployed_only_symbols:
        LOGGER.info(
            "로컬 설정에서 제거된 배포 종목은 복원하지 않습니다: %s",
            ", ".join(sorted(deployed_only_symbols)),
        )

    older_symbols: list[str] = []
    newer_symbols: list[str] = []
    for symbol in common_symbols:
        local_date = local_dates[symbol]
        deployed_date = deployed_dates[symbol]
        if local_date is not None and deployed_date is None:
            older_symbols.append(symbol)
        elif local_date is None and deployed_date is not None:
            newer_symbols.append(symbol)
        elif local_date is not None and deployed_date is not None:
            if deployed_date < local_date:
                older_symbols.append(symbol)
            elif deployed_date > local_date:
                newer_symbols.append(symbol)

    if older_symbols and newer_symbols:
        raise DeployedDataError(
            "로컬과 배포 데이터의 최신 거래일이 종목별로 엇갈려 배포를 중단합니다."
        )
    if older_symbols:
        LOGGER.info(
            "배포 데이터가 로컬보다 오래되어 로컬 데이터를 유지합니다: %s",
            ", ".join(older_symbols),
        )
        return False
    deployed_summary_by_symbol = {
        summary["symbol"]: summary for summary in deployed_summaries
    }
    deployed_records: dict[str, list[dict[str, Any]]] = {}
    for symbol in newer_symbols:
        trade_date = deployed_dates[symbol]
        if trade_date is None:
            continue
        records = fetch_json(f"{base_url}/{symbol}.json")
        deployed_records[symbol] = _validate_records(records, symbol, trade_date)

    deployed_metadata = fetch_json(f"{base_url}/metadata.json")
    if not isinstance(deployed_metadata, dict):
        raise DeployedDataError("배포 metadata.json은 객체여야 합니다.")

    sentiment_to_restore: dict[str, Any] | None = None
    analytics_to_restore: dict[str, Any] | None = None
    deployed_sentiment_paths = _sentiment_paths(deployed_metadata)
    local_metadata = _load_json(data_dir / "metadata.json")
    local_sentiment_paths = _sentiment_paths(local_metadata)
    if deployed_sentiment_paths:
        sentiment_relative, analytics_relative = deployed_sentiment_paths
        deployed_sentiment = _validate_sentiment_payload(
            fetch_json(f"{base_url}/{sentiment_relative}")
        )
        local_latest: str | None = None
        if local_sentiment_paths:
            try:
                local_sentiment = _validate_sentiment_payload(
                    _load_json(data_dir / local_sentiment_paths[0])
                )
                local_latest = local_sentiment["lastAvailableDate"]
            except DeployedDataError:
                LOGGER.warning("로컬 Fear & Greed 파일이 유효하지 않아 배포본으로 복구합니다.")
        if local_latest is None or deployed_sentiment["lastAvailableDate"] > local_latest:
            analytics_payload = fetch_json(f"{base_url}/{analytics_relative}")
            if not isinstance(analytics_payload, dict) or not isinstance(
                analytics_payload.get("commonPeriod"), dict
            ):
                raise DeployedDataError("배포 Sentiment 분석 파일이 올바르지 않습니다.")
            sentiment_to_restore = deployed_sentiment
            analytics_to_restore = analytics_payload

    if not newer_symbols and sentiment_to_restore is None:
        LOGGER.info("로컬과 배포 데이터의 최신 거래일 및 심리 데이터가 같아 로컬 데이터를 유지합니다.")
        return False

    for symbol, records in deployed_records.items():
        write_json(data_dir / f"{symbol}.json", records)
    if newer_symbols:
        merged_summaries = [
            deployed_summary_by_symbol.get(summary["symbol"], summary)
            if summary["symbol"] in newer_symbols
            else summary
            for summary in local_summaries
        ]
        write_json(data_dir / "stocks.json", merged_summaries)
    if sentiment_to_restore is not None and analytics_to_restore is not None:
        write_json(data_dir / "sentiment" / "fear-greed.json", sentiment_to_restore)
        write_json(data_dir / "sentiment" / "analytics.json", analytics_to_restore)
    write_json(data_dir / "metadata.json", deployed_metadata)

    LOGGER.info(
        "현재 Pages의 더 최신인 데이터를 복원했습니다: 종목=%s, 심리=%s",
        ", ".join(newer_symbols) or "없음",
        "복원" if sentiment_to_restore is not None else "유지",
    )
    return True


def run() -> int:
    try:
        restore_latest_deployed_data()
    except DeployedDataError:
        LOGGER.exception("현재 Pages 데이터 동기화에 실패했습니다.")
        return 1
    return 0


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
    raise SystemExit(run())


if __name__ == "__main__":
    main()

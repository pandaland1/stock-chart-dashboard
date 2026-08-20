"""CNN Fear & Greed 일별 관측값을 검증하고 증분 병합한다."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .json_generator import write_json


LOGGER = logging.getLogger(__name__)
CNN_SOURCE_PAGE = "https://www.cnn.com/markets/fear-and-greed"
CNN_GRAPH_ENDPOINT = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
CNN_FIRST_AVAILABLE_DATE = "2020-07-14"
SENTIMENT_SCHEMA_VERSION = 1


class SentimentDataError(RuntimeError):
    """Fear & Greed 응답을 신뢰 가능한 일별 데이터로 만들 수 없을 때 발생한다."""


def classify_fear_greed(value: float) -> str:
    """요구된 5단계 경계에 따라 영문 분류명을 반환한다."""

    if value < 0 or value > 100:
        raise SentimentDataError(f"Fear & Greed 값이 범위를 벗어났습니다: {value}")
    if value < 25:
        return "Extreme Fear"
    if value < 45:
        return "Fear"
    if value <= 55:
        return "Neutral"
    if value < 75:
        return "Greed"
    return "Extreme Greed"


def _fetch_cnn_payload(start_date: str) -> dict[str, Any]:
    url = f"{CNN_GRAPH_ENDPOINT}/{start_date}"
    request = Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": CNN_SOURCE_PAGE,
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/128.0.0.0 Safari/537.36"
            ),
        },
    )
    try:
        with urlopen(request, timeout=45) as response:  # noqa: S310 - 고정 HTTPS 호스트
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        raise SentimentDataError(f"CNN Fear & Greed 요청 실패: {exc}") from exc
    if not isinstance(payload, dict):
        raise SentimentDataError("CNN Fear & Greed 응답이 객체가 아닙니다.")
    return payload


def parse_cnn_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """CNN 그래프 응답에서 실제 관측된 날짜와 점수만 정규화한다."""

    historical = payload.get("fear_and_greed_historical")
    source = historical.get("data") if isinstance(historical, dict) else None
    if not isinstance(source, list) or not source:
        raise SentimentDataError("CNN 응답에 Fear & Greed 일별 이력이 없습니다.")

    today = datetime.now(UTC).date()
    by_date: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(source, start=1):
        if not isinstance(item, dict):
            raise SentimentDataError(f"CNN 이력 {index}번 항목이 객체가 아닙니다.")
        timestamp = item.get("x")
        value = item.get("y")
        if not isinstance(timestamp, (int, float)) or not isinstance(value, (int, float)):
            raise SentimentDataError(f"CNN 이력 {index}번 날짜 또는 점수가 유효하지 않습니다.")
        observation_date = datetime.fromtimestamp(float(timestamp) / 1000, UTC).date()
        score = float(value)
        if observation_date > today:
            raise SentimentDataError(f"미래 Fear & Greed 날짜가 포함되었습니다: {observation_date}")
        classification = classify_fear_greed(score)
        date_text = observation_date.isoformat()
        by_date[date_text] = {
            "time": date_text,
            "value": round(score, 4),
            "classification": classification,
        }

    records = [by_date[key] for key in sorted(by_date)]
    if len(records) < 2:
        raise SentimentDataError("유효한 Fear & Greed 일별 데이터가 2건 미만입니다.")
    return records


def validate_sentiment_records(payload: Any) -> list[dict[str, Any]]:
    """저장 전후에 날짜·값·분류·중복을 동일한 규칙으로 검사한다."""

    if not isinstance(payload, list) or len(payload) < 2:
        raise SentimentDataError("Fear & Greed 데이터는 2건 이상의 배열이어야 합니다.")
    today = date.today()
    dates: list[date] = []
    validated: list[dict[str, Any]] = []
    for index, record in enumerate(payload, start=1):
        if not isinstance(record, dict):
            raise SentimentDataError(f"Fear & Greed {index}번 항목이 객체가 아닙니다.")
        try:
            record_date = date.fromisoformat(record["time"])
            value = float(record["value"])
        except (KeyError, TypeError, ValueError) as exc:
            raise SentimentDataError(f"Fear & Greed {index}번 날짜 또는 값이 잘못되었습니다.") from exc
        if record_date > today:
            raise SentimentDataError(f"미래 Fear & Greed 날짜가 포함되었습니다: {record_date}")
        expected_classification = classify_fear_greed(value)
        if record.get("classification") != expected_classification:
            raise SentimentDataError(f"{record_date} Fear & Greed 분류가 값과 일치하지 않습니다.")
        dates.append(record_date)
        validated.append(
            {
                "time": record_date.isoformat(),
                "value": round(value, 4),
                "classification": expected_classification,
            }
        )
    if dates != sorted(set(dates)):
        raise SentimentDataError("Fear & Greed 날짜가 오름차순 고유값이 아닙니다.")
    return validated


def load_sentiment_file(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    try:
        records = validate_sentiment_records(payload.get("records"))
    except SentimentDataError:
        return None
    return {**payload, "records": records}


def _merge_records(
    existing_records: list[dict[str, Any]],
    new_records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged = {record["time"]: record for record in existing_records}
    merged.update({record["time"]: record for record in new_records})
    return validate_sentiment_records([merged[key] for key in sorted(merged)])


def build_sentiment_payload(
    existing: dict[str, Any] | None = None,
    *,
    fetcher: Callable[[str], dict[str, Any]] = _fetch_cnn_payload,
    now: datetime | None = None,
) -> dict[str, Any]:
    """최초 전체 수집 또는 마지막 날짜와 겹치는 증분 수집 결과를 만든다."""

    existing_records = validate_sentiment_records(existing["records"]) if existing else []
    if existing_records:
        latest = date.fromisoformat(existing_records[-1]["time"])
        start_date = max(
            date.fromisoformat(CNN_FIRST_AVAILABLE_DATE),
            latest - timedelta(days=14),
        ).isoformat()
    else:
        start_date = CNN_FIRST_AVAILABLE_DATE

    new_records = parse_cnn_payload(fetcher(start_date))
    if existing_records and new_records[-1]["time"] < existing_records[-1]["time"]:
        raise SentimentDataError(
            "새 CNN 응답의 최신 날짜가 기존 Fear & Greed 데이터보다 과거입니다."
        )
    records = _merge_records(existing_records, new_records)

    generated = (now or datetime.now(UTC)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "schemaVersion": SENTIMENT_SCHEMA_VERSION,
        "source": "CNN Fear & Greed Index",
        "sourceUrl": CNN_SOURCE_PAGE,
        "generatedAt": generated,
        "firstAvailableDate": records[0]["time"],
        "lastAvailableDate": records[-1]["time"],
        "records": records,
    }


def update_sentiment_file(
    path: Path,
    *,
    fetcher: Callable[[str], dict[str, Any]] = _fetch_cnn_payload,
    now: datetime | None = None,
    max_attempts: int = 3,
) -> dict[str, Any]:
    """완성된 전체 페이로드가 검증된 경우에만 기존 파일을 교체한다."""

    existing = load_sentiment_file(path)
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            payload = build_sentiment_payload(existing, fetcher=fetcher, now=now)
            write_json(path, payload)
            return payload
        except Exception as exc:
            last_error = exc
            LOGGER.warning("Fear & Greed 수집 실패 (%d/%d): %s", attempt, max_attempts, exc)
            if attempt < max_attempts:
                time.sleep(attempt * 2)
    raise SentimentDataError(f"Fear & Greed 갱신 실패: {last_error}") from last_error

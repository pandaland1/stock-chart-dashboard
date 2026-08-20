from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from src.sentiment_data import (
    SentimentDataError,
    build_sentiment_payload,
    classify_fear_greed,
    parse_cnn_payload,
    update_sentiment_file,
)


def cnn_payload(points: list[tuple[str, float]]) -> dict:
    return {
        "fear_and_greed_historical": {
            "data": [
                {
                    "x": datetime.fromisoformat(f"{day}T00:00:00+00:00").timestamp() * 1000,
                    "y": value,
                    "rating": "ignored",
                }
                for day, value in points
            ]
        }
    }


@pytest.mark.parametrize(
    ("value", "expected"),
    [(0, "Extreme Fear"), (24, "Extreme Fear"), (25, "Fear"), (44, "Fear"),
     (45, "Neutral"), (55, "Neutral"), (56, "Greed"), (74, "Greed"),
     (75, "Extreme Greed"), (100, "Extreme Greed")],
)
def test_classification_uses_requested_boundaries(value: float, expected: str) -> None:
    assert classify_fear_greed(value) == expected


def test_parses_observed_daily_values_without_interpolation() -> None:
    result = parse_cnn_payload(cnn_payload([("2026-08-18", 23.5), ("2026-08-20", 54.2)]))

    assert [record["time"] for record in result] == ["2026-08-18", "2026-08-20"]
    assert result[0]["classification"] == "Extreme Fear"
    assert result[1]["classification"] == "Neutral"


def test_incremental_payload_merges_overlap_deduplicates_and_sorts() -> None:
    existing = {
        "records": [
            {"time": "2026-08-18", "value": 20.0, "classification": "Extreme Fear"},
            {"time": "2026-08-19", "value": 40.0, "classification": "Fear"},
        ]
    }
    requested: list[str] = []

    result = build_sentiment_payload(
        existing,
        fetcher=lambda start: requested.append(start) or cnn_payload(
            [("2026-08-19", 41.0), ("2026-08-20", 54.0)]
        ),
        now=datetime(2026, 8, 21, tzinfo=UTC),
    )

    assert requested == ["2026-08-05"]
    assert [record["time"] for record in result["records"]] == [
        "2026-08-18", "2026-08-19", "2026-08-20"
    ]
    assert result["records"][1]["value"] == 41.0


def test_failed_update_never_overwrites_existing_file(tmp_path: Path) -> None:
    path = tmp_path / "fear-greed.json"
    original = {
        "schemaVersion": 1,
        "generatedAt": "2026-08-19T00:00:00Z",
        "firstAvailableDate": "2026-08-18",
        "lastAvailableDate": "2026-08-19",
        "records": [
            {"time": "2026-08-18", "value": 20.0, "classification": "Extreme Fear"},
            {"time": "2026-08-19", "value": 40.0, "classification": "Fear"},
        ],
    }
    path.write_text(json.dumps(original), encoding="utf-8")

    with pytest.raises(SentimentDataError):
        update_sentiment_file(
            path,
            fetcher=lambda _start: (_ for _ in ()).throw(RuntimeError("temporary outage")),
            max_attempts=1,
        )

    assert json.loads(path.read_text(encoding="utf-8")) == original

"""QQQ와 Fear & Greed 공통 거래일의 재현 가능한 통계 분석을 생성한다."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import numpy as np


FORWARD_HORIZONS = (5, 20, 60, 120, 250)
CORRELATION_WINDOWS = {"30D": 30, "90D": 90, "1Y": 252, "3Y": 756, "MAX": None}
FEAR_THRESHOLDS = (25, 15, 10)


def _round(value: float | None, places: int = 4) -> float | None:
    return round(float(value), places) if value is not None and np.isfinite(value) else None


def _mean(values: Iterable[float | None]) -> float | None:
    valid = [float(value) for value in values if value is not None and np.isfinite(value)]
    return float(np.mean(valid)) if valid else None


def pearson(values_x: list[float], values_y: list[float]) -> float | None:
    if len(values_x) != len(values_y) or len(values_x) < 3:
        return None
    x = np.asarray(values_x, dtype=float)
    y = np.asarray(values_y, dtype=float)
    if not np.all(np.isfinite(x)) or not np.all(np.isfinite(y)):
        return None
    if np.isclose(np.std(x), 0) or np.isclose(np.std(y), 0):
        return None
    return float(np.corrcoef(x, y)[0, 1])


def join_common_records(
    qqq_records: list[dict[str, Any]],
    sentiment_records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    qqq_by_date = {
        record.get("time"): (index, record)
        for index, record in enumerate(qqq_records)
        if isinstance(record, dict) and isinstance(record.get("time"), str)
    }
    common: list[dict[str, Any]] = []
    for sentiment in sentiment_records:
        qqq_match = qqq_by_date.get(sentiment.get("time"))
        qqq_index, qqq = qqq_match if qqq_match else (None, None)
        close = qqq.get("close") if isinstance(qqq, dict) else None
        value = sentiment.get("value") if isinstance(sentiment, dict) else None
        if not isinstance(close, (int, float)) or close <= 0:
            continue
        if not isinstance(value, (int, float)) or value < 0 or value > 100:
            continue
        common.append(
            {
                "time": sentiment["time"],
                "qqqClose": float(close),
                "fearGreed": float(value),
                "classification": sentiment.get("classification"),
                "qqqIndex": qqq_index,
            }
        )
    common.sort(key=lambda record: record["time"])
    return common


def _forward_returns(
    common: list[dict[str, Any]],
    index: int,
    qqq_records: list[dict[str, Any]] | None = None,
) -> dict[str, float | None]:
    start = common[index]["qqqClose"]
    returns: dict[str, float | None] = {}
    for horizon in FORWARD_HORIZONS:
        value = None
        if qqq_records is not None and isinstance(common[index].get("qqqIndex"), int):
            target_index = common[index]["qqqIndex"] + horizon
            if target_index < len(qqq_records):
                target_close = qqq_records[target_index].get("close")
                if isinstance(target_close, (int, float)) and target_close > 0:
                    value = ((float(target_close) / start) - 1) * 100
        elif index + horizon < len(common):
            value = ((common[index + horizon]["qqqClose"] / start) - 1) * 100
        returns[f"{horizon}D"] = _round(value)
    return returns


def _group_true_ranges(flags: list[bool]) -> list[tuple[int, int]]:
    groups: list[tuple[int, int]] = []
    start: int | None = None
    for index, flag in enumerate([*flags, False]):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            groups.append((start, index - 1))
            start = None
    return groups


def build_fear_episodes(
    common: list[dict[str, Any]],
    threshold: int,
    qqq_records: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """연속 임계값 구간을 하나로 묶고 최저 점수일을 대표 이벤트로 삼는다."""

    ranges = _group_true_ranges([record["fearGreed"] <= threshold for record in common])
    episodes: list[dict[str, Any]] = []
    for start, end in ranges:
        event_index = min(range(start, end + 1), key=lambda index: common[index]["fearGreed"])
        event = common[event_index]
        episodes.append(
            {
                "startDate": common[start]["time"],
                "endDate": common[end]["time"],
                "date": event["time"],
                "fearGreed": _round(event["fearGreed"], 2),
                "qqqClose": _round(event["qqqClose"], 4),
                "duration": end - start + 1,
                "forwardReturns": _forward_returns(common, event_index, qqq_records),
            }
        )
    return episodes


def _aggregate_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    averages = {
        f"{horizon}D": _round(
            _mean(event["forwardReturns"].get(f"{horizon}D") for event in events)
        )
        for horizon in FORWARD_HORIZONS
    }
    completed = {
        f"{horizon}D": sum(
            event["forwardReturns"].get(f"{horizon}D") is not None for event in events
        )
        for horizon in FORWARD_HORIZONS
    }
    return {"occurrences": len(events), "averageReturns": averages, "completedSamples": completed}


def _correlations(common: list[dict[str, Any]]) -> dict[str, Any]:
    levels: dict[str, float | None] = {}
    changes: dict[str, float | None] = {}
    observations: dict[str, int] = {}
    daily_changes = [
        {
            "fear": common[index]["fearGreed"] - common[index - 1]["fearGreed"],
            "return": ((common[index]["qqqClose"] / common[index - 1]["qqqClose"]) - 1) * 100,
        }
        for index in range(1, len(common))
    ]
    for label, size in CORRELATION_WINDOWS.items():
        level_slice = common[-size:] if size else common
        change_size = max(1, size - 1) if size else None
        change_slice = daily_changes[-change_size:] if change_size else daily_changes
        observations[label] = len(level_slice)
        levels[label] = _round(
            pearson(
                [record["fearGreed"] for record in level_slice],
                [record["qqqClose"] for record in level_slice],
            )
        )
        changes[label] = _round(
            pearson(
                [record["fear"] for record in change_slice],
                [record["return"] for record in change_slice],
            )
        )
    return {"levels": levels, "changesVsReturns": changes, "observations": observations}


def _shock_events(
    common: list[dict[str, Any]],
    direction: str,
    qqq_records: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    candidates: list[tuple[int, float]] = []
    for index in range(5, len(common)):
        change = common[index]["fearGreed"] - common[index - 5]["fearGreed"]
        if (direction == "drop" and change <= -15) or (direction == "rise" and change >= 15):
            candidates.append((index, change))

    if not candidates:
        return []
    groups: list[list[tuple[int, float]]] = [[candidates[0]]]
    for candidate in candidates[1:]:
        if candidate[0] <= groups[-1][-1][0] + 1:
            groups[-1].append(candidate)
        else:
            groups.append([candidate])

    events: list[dict[str, Any]] = []
    for group in groups:
        index, change = (
            min(group, key=lambda item: item[1])
            if direction == "drop"
            else max(group, key=lambda item: item[1])
        )
        event = common[index]
        events.append(
            {
                "date": event["time"],
                "change5D": _round(change, 2),
                "fearGreed": _round(event["fearGreed"], 2),
                "qqqClose": _round(event["qqqClose"], 4),
                "forwardReturns": _forward_returns(common, index, qqq_records),
            }
        )
    return events


def build_sentiment_analysis(
    qqq_records: list[dict[str, Any]],
    sentiment_records: list[dict[str, Any]],
) -> dict[str, Any]:
    common = join_common_records(qqq_records, sentiment_records)
    if len(common) < 3:
        raise ValueError("QQQ와 Fear & Greed 공통 관측값이 3건 미만입니다.")

    latest = common[-1]
    changes: dict[str, float | None] = {}
    for label, offset in (("1D", 1), ("5D", 5), ("20D", 20)):
        changes[label] = _round(
            latest["fearGreed"] - common[-1 - offset]["fearGreed"], 2
        ) if len(common) > offset else None

    thresholds: dict[str, Any] = {}
    for threshold in FEAR_THRESHOLDS:
        events = build_fear_episodes(common, threshold, qqq_records)
        thresholds[str(threshold)] = {
            **_aggregate_events(events),
            "events": list(reversed(events)),
        }

    shock_sets: dict[str, Any] = {}
    for direction in ("drop", "rise"):
        events = _shock_events(common, direction, qqq_records)
        aggregate = _aggregate_events(events)
        shock_sets[direction] = {
            "rule": "5D <= -15pt" if direction == "drop" else "5D >= +15pt",
            **aggregate,
            "events": list(reversed(events)),
        }

    return {
        "schemaVersion": 1,
        "methodology": {
            "fearEpisode": "연속 임계값 구간을 1회로 묶고 최저 점수일을 대표일로 사용",
            "forwardReturn": "대표일 종가 대비 N 거래일 뒤 QQQ 수정종가 수익률",
            "correlation": "Pearson 상관계수이며 인과관계를 의미하지 않음",
        },
        "commonPeriod": {
            "from": common[0]["time"],
            "through": common[-1]["time"],
            "observations": len(common),
        },
        "current": {
            "date": latest["time"],
            "value": _round(latest["fearGreed"], 2),
            "classification": latest["classification"],
            "previousClose": _round(common[-2]["fearGreed"], 2),
            "changes": changes,
            "rapidDrop": changes["5D"] is not None and changes["5D"] <= -10,
        },
        "thresholds": thresholds,
        "correlations": _correlations(common),
        "sentimentShocks": shock_sets,
    }

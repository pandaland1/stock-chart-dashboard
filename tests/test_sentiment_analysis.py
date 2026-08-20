from __future__ import annotations

import math

from src.sentiment_analysis import (
    build_fear_episodes,
    build_sentiment_analysis,
    join_common_records,
    pearson,
)


def make_data(values: list[float]) -> tuple[list[dict], list[dict]]:
    qqq = []
    sentiment = []
    for index, value in enumerate(values, start=1):
        day = f"2026-01-{index:02d}"
        qqq.append({"time": day, "close": 100 + index})
        sentiment.append(
            {
                "time": day,
                "value": value,
                "classification": "Extreme Fear" if value < 25 else "Neutral",
            }
        )
    return qqq, sentiment


def test_common_join_requires_exact_dates() -> None:
    qqq = [{"time": "2026-01-01", "close": 100}, {"time": "2026-01-03", "close": 103}]
    sentiment = [
        {"time": "2026-01-01", "value": 40, "classification": "Fear"},
        {"time": "2026-01-02", "value": 30, "classification": "Fear"},
    ]
    assert [record["time"] for record in join_common_records(qqq, sentiment)] == ["2026-01-01"]


def test_consecutive_extreme_days_are_one_episode_at_the_trough() -> None:
    qqq, sentiment = make_data([40, 20, 10, 12, 30, 9, 8, 35])
    common = join_common_records(qqq, sentiment)
    episodes = build_fear_episodes(common, 25)

    assert len(episodes) == 2
    assert episodes[0]["date"] == "2026-01-03"
    assert episodes[0]["duration"] == 3
    assert episodes[1]["date"] == "2026-01-07"


def test_pearson_handles_constant_or_identical_series() -> None:
    assert pearson([1, 2, 3], [2, 4, 6]) == 1.0
    assert pearson([1, 1, 1], [2, 3, 4]) is None


def test_analysis_contains_thresholds_changes_and_correlations() -> None:
    values = [50 - (index % 20) for index in range(30)]
    values[5:8] = [12, 8, 11]
    qqq, sentiment = make_data(values)
    result = build_sentiment_analysis(qqq, sentiment)

    assert result["commonPeriod"]["observations"] == 30
    assert result["thresholds"]["10"]["occurrences"] == 1
    assert result["current"]["changes"]["1D"] is not None
    assert "changesVsReturns" in result["correlations"]
    assert not math.isnan(result["thresholds"]["10"]["events"][0]["qqqClose"])


def test_forward_returns_count_qqq_sessions_even_when_sentiment_day_is_missing() -> None:
    qqq = [
        {"time": f"2026-02-{index:02d}", "close": 100 + index}
        for index in range(1, 9)
    ]
    sentiment = [
        {
            "time": record["time"],
            "value": 5 if index == 0 else 40,
            "classification": "Extreme Fear" if index == 0 else "Fear",
        }
        for index, record in enumerate(qqq)
        if record["time"] != "2026-02-04"
    ]

    result = build_sentiment_analysis(qqq, sentiment)
    event = result["thresholds"]["10"]["events"][0]

    expected = ((qqq[5]["close"] / qqq[0]["close"]) - 1) * 100
    assert event["forwardReturns"]["5D"] == round(expected, 4)

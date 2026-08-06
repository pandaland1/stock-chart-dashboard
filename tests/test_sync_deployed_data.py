from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from src.json_generator import write_json
from src.sync_deployed_data import DeployedDataError, restore_latest_deployed_data


BASE_URL = "https://example.test/data"


def make_records(latest_date: str) -> list[dict[str, Any]]:
    return [
        {"time": "2026-08-01", "close": 100.0},
        {"time": latest_date, "close": 101.0},
    ]


def make_summary(symbol: str, trade_date: str) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "tradeDate": trade_date,
        "dataPath": f"./data/{symbol}.json",
        "updateStatus": "success",
    }


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def test_restores_newer_fully_validated_deployed_dataset(tmp_path: Path) -> None:
    local_summary = [make_summary("PLTR", "2026-08-04")]
    deployed_summary = [make_summary("PLTR", "2026-08-05")]
    write_json(tmp_path / "stocks.json", local_summary)
    write_json(tmp_path / "PLTR.json", make_records("2026-08-04"))
    write_json(tmp_path / "metadata.json", {"generatedAt": "local"})

    responses = {
        f"{BASE_URL}/stocks.json": deployed_summary,
        f"{BASE_URL}/PLTR.json": make_records("2026-08-05"),
        f"{BASE_URL}/metadata.json": {"generatedAt": "deployed"},
    }

    restored = restore_latest_deployed_data(
        tmp_path,
        fetch_json=responses.__getitem__,
        base_url=BASE_URL,
    )

    assert restored is True
    assert read_json(tmp_path / "stocks.json") == deployed_summary
    assert read_json(tmp_path / "PLTR.json")[-1]["time"] == "2026-08-05"
    assert read_json(tmp_path / "metadata.json") == {"generatedAt": "deployed"}


def test_keeps_local_dataset_when_deployed_dataset_is_older(tmp_path: Path) -> None:
    local_summary = [make_summary("PLTR", "2026-08-05")]
    write_json(tmp_path / "stocks.json", local_summary)
    write_json(tmp_path / "PLTR.json", make_records("2026-08-05"))

    responses = {
        f"{BASE_URL}/stocks.json": [make_summary("PLTR", "2026-08-03")],
    }

    restored = restore_latest_deployed_data(
        tmp_path,
        fetch_json=responses.__getitem__,
        base_url=BASE_URL,
    )

    assert restored is False
    assert read_json(tmp_path / "stocks.json") == local_summary
    assert read_json(tmp_path / "PLTR.json")[-1]["time"] == "2026-08-05"


def test_rejects_mixed_newer_and_older_deployed_dates(tmp_path: Path) -> None:
    write_json(
        tmp_path / "stocks.json",
        [
            make_summary("PLTR", "2026-08-05"),
            make_summary("NVDA", "2026-08-05"),
        ],
    )
    responses = {
        f"{BASE_URL}/stocks.json": [
            make_summary("PLTR", "2026-08-06"),
            make_summary("NVDA", "2026-08-04"),
        ],
    }

    with pytest.raises(DeployedDataError, match="종목별로 엇갈려"):
        restore_latest_deployed_data(
            tmp_path,
            fetch_json=responses.__getitem__,
            base_url=BASE_URL,
        )


def test_validates_every_file_before_overwriting_local_data(tmp_path: Path) -> None:
    local_summary = [make_summary("PLTR", "2026-08-04")]
    write_json(tmp_path / "stocks.json", local_summary)
    write_json(tmp_path / "PLTR.json", make_records("2026-08-04"))
    write_json(tmp_path / "metadata.json", {"generatedAt": "local"})

    responses = {
        f"{BASE_URL}/stocks.json": [make_summary("PLTR", "2026-08-05")],
        f"{BASE_URL}/PLTR.json": make_records("2026-08-04"),
    }

    with pytest.raises(DeployedDataError, match="stocks.json과 일치하지 않습니다"):
        restore_latest_deployed_data(
            tmp_path,
            fetch_json=responses.__getitem__,
            base_url=BASE_URL,
        )

    assert read_json(tmp_path / "stocks.json") == local_summary
    assert read_json(tmp_path / "PLTR.json")[-1]["time"] == "2026-08-04"
    assert read_json(tmp_path / "metadata.json") == {"generatedAt": "local"}

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from src.json_generator import dataframe_to_records, to_json_value, write_json


def make_serialisation_frame() -> pd.DataFrame:
    frame = pd.DataFrame(
        {
            "Open": [10.0, 11.0],
            "High": [12.0, 13.0],
            "Low": [9.0, 10.0],
            "Close": [11.5, 12.5],
            "Volume": [np.int64(1000), np.int64(1200)],
            "sma120": [np.nan, np.float64(11.0)],
            "sma200": [np.nan, np.nan],
            "vwma100": [np.inf, 11.2],
            "bbBasis": [10.5, 11.5],
            "bbUpper": [12.5, 13.5],
            "bbLower": [8.5, 9.5],
        },
        index=pd.to_datetime(["2026-08-04 15:30", "2026-08-05 15:30"]),
    )
    return frame


def test_dataframe_records_use_dates_and_json_null() -> None:
    records = dataframe_to_records(make_serialisation_frame())

    assert records[0]["time"] == "2026-08-04"
    assert records[1]["time"] == "2026-08-05"
    assert records[0]["sma120"] is None
    assert records[0]["vwma100"] is None
    assert records[0]["volume"] == 1000


def test_numpy_and_timestamp_values_become_builtin_types() -> None:
    assert to_json_value(np.int64(7)) == 7
    assert to_json_value(np.float64(3.14159), decimal_places=2) == 3.14
    assert to_json_value(pd.Timestamp("2026-08-05")) == "2026-08-05"
    assert to_json_value(-np.inf) is None


def test_strict_json_serialisation(tmp_path) -> None:
    records = dataframe_to_records(make_serialisation_frame())
    output = tmp_path / "sample.json"

    write_json(output, records)
    loaded = json.loads(output.read_text(encoding="utf-8"))

    assert loaded == records
    assert "NaN" not in output.read_text(encoding="utf-8")
    assert "Infinity" not in output.read_text(encoding="utf-8")

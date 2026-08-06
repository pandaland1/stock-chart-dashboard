"""프로젝트 경로와 관심 종목 설정을 관리한다."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config" / "stocks.json"
SITE_DATA_DIR = PROJECT_ROOT / "site" / "data"

_SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.-]{0,14}$")


@dataclass(frozen=True, slots=True)
class StockConfig:
    """관심 종목 한 건."""

    symbol: str
    name: str


def load_stocks(path: Path = DEFAULT_CONFIG_PATH) -> list[StockConfig]:
    """JSON 설정 파일을 검증하고 관심 종목 목록을 반환한다."""

    if not path.exists():
        raise FileNotFoundError(f"종목 설정 파일을 찾을 수 없습니다: {path}")

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"종목 설정 JSON 형식이 올바르지 않습니다: {exc}") from exc

    if not isinstance(payload, list) or not payload:
        raise ValueError("종목 설정은 한 개 이상의 항목을 가진 배열이어야 합니다.")

    stocks: list[StockConfig] = []
    seen_symbols: set[str] = set()

    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"종목 설정 {index}번 항목은 객체여야 합니다.")

        raw_symbol = item.get("symbol")
        raw_name = item.get("name")
        if not isinstance(raw_symbol, str) or not isinstance(raw_name, str):
            raise ValueError(f"종목 설정 {index}번 항목의 symbol과 name은 문자열이어야 합니다.")

        symbol = raw_symbol.strip().upper()
        name = raw_name.strip()
        if not _SYMBOL_PATTERN.fullmatch(symbol):
            raise ValueError(f"허용되지 않는 종목 코드입니다: {raw_symbol!r}")
        if not name:
            raise ValueError(f"{symbol}의 회사명이 비어 있습니다.")
        if symbol in seen_symbols:
            raise ValueError(f"중복된 종목 코드입니다: {symbol}")

        seen_symbols.add(symbol)
        stocks.append(StockConfig(symbol=symbol, name=name))

    return stocks

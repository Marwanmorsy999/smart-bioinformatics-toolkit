"""Serialization helpers for CLI outputs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd


def write_json(data: dict[str, Any], path: str | Path) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def write_csv(dataframe: pd.DataFrame, path: str | Path) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    dataframe.to_csv(output, index=False)

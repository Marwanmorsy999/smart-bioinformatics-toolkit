"""CSV injection guard shared by all exports (Python side, JS parity)."""
from __future__ import annotations
import re


def safe_csv_cell(value: object) -> str:
    """RFC4180 quote + neutralise spreadsheet formula injection."""
    if value is None:
        return ""
    text = str(value)
    if any(ch in text for ch in (',', '"', '\n', '\r')):
        text = '"' + text.replace('"', '""') + '"'
    m = re.match(r'^("?)([=+\-@\t\r])', text)
    if m:
        text = m.group(1) + "'" + text[m.end(1):]
    return text

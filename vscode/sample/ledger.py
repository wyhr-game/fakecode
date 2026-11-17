"""一个小型的记账工具，用来当魈公引擎的内置示例。

为什么内置这份东西：
  用户第一次打开 `新建文件开始` 时，如果没有选过目录，
  总得有东西可以打。这份代码是自己写的，随便分发，不涉及任何第三方许可。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from datetime import date
from typing import Iterable

DATA_FILE = os.path.join(os.path.dirname(__file__), "ledger.json")


@dataclass
class Entry:
    """一条账。正数是收入，负数是支出。"""

    day: str
    amount: float
    note: str = ""
    tags: list[str] = field(default_factory=list)

    def is_income(self) -> bool:
        return self.amount > 0


class Ledger:
    """账本：负责增删查、算总和、按天汇总。"""

    def __init__(self, entries: Iterable[Entry] | None = None) -> None:
        self.entries: list[Entry] = list(entries or [])

    def add(self, amount: float, note: str = "", tags: list[str] | None = None) -> Entry:
        if amount == 0:
            raise ValueError("金额不能是 0")
        entry = Entry(day=date.today().isoformat(), amount=amount, note=note, tags=list(tags or []))
        self.entries.append(entry)
        return entry

    def total(self) -> float:
        return round(sum(e.amount for e in self.entries), 2)

    def by_day(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for e in self.entries:
            out[e.day] = round(out.get(e.day, 0.0) + e.amount, 2)
        return dict(sorted(out.items()))

    def by_tag(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for e in self.entries:
            for tag in e.tags:
                out[tag] = round(out.get(tag, 0.0) + e.amount, 2)
        return dict(sorted(out.items(), key=lambda kv: kv[1]))

    def income(self) -> float:
        return round(sum(e.amount for e in self.entries if e.is_income()), 2)

    def expense(self) -> float:
        return round(sum(-e.amount for e in self.entries if not e.is_income()), 2)

    def save(self, path: str = DATA_FILE) -> None:
        rows = [asdict(e) for e in self.entries]
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, path: str = DATA_FILE) -> "Ledger":
        if not os.path.exists(path):
            return cls()
        with open(path, "r", encoding="utf-8") as fh:
            rows = json.load(fh)
        return cls(Entry(**row) for row in rows)

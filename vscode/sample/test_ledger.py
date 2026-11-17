"""账本的单元测试。用标准库 unittest，不引依赖。"""

from __future__ import annotations

import os
import tempfile
import unittest

from ledger import Entry, Ledger


class TestLedger(unittest.TestCase):
    def setUp(self) -> None:
        self.ledger = Ledger()

    def test_add_rejects_zero(self) -> None:
        with self.assertRaises(ValueError):
            self.ledger.add(0)

    def test_total_sums_both_directions(self) -> None:
        self.ledger.add(120.5, "工资", ["收入"])
        self.ledger.add(-30.0, "午饭", ["吃饭"])
        self.assertEqual(self.ledger.total(), 90.5)

    def test_income_and_expense(self) -> None:
        self.ledger.add(200, "兼职")
        self.ledger.add(-50, "打车")
        self.assertEqual(self.ledger.income(), 200.0)
        self.assertEqual(self.ledger.expense(), 50.0)

    def test_by_day_groups(self) -> None:
        self.ledger.entries = [
            Entry(day="2026-11-01", amount=10),
            Entry(day="2026-11-01", amount=5),
            Entry(day="2026-11-02", amount=-3),
        ]
        self.assertEqual(self.ledger.by_day(), {"2026-11-01": 15.0, "2026-11-02": -3.0})

    def test_by_tag_sums_each_tag(self) -> None:
        self.ledger.entries = [
            Entry(day="2026-11-01", amount=10, tags=["吃饭"]),
            Entry(day="2026-11-02", amount=-4, tags=["吃饭", "外卖"]),
        ]
        self.assertEqual(self.ledger.by_tag(), {"吃饭": 6.0, "外卖": -4.0})

    def test_save_and_load_roundtrip(self) -> None:
        self.ledger.add(66.6, "测试", ["demo"])
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ledger.json")
            self.ledger.save(path)
            again = Ledger.load(path)
        self.assertEqual(again.total(), 66.6)
        self.assertEqual(again.entries[0].note, "测试")


if __name__ == "__main__":
    unittest.main()

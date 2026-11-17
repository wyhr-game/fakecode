"""把账本渲染成终端表格。

只做一件事：把数字排整齐，别让眼睛去找小数点。
"""

from __future__ import annotations

from ledger import Ledger

WIDTH = 46


def _line(ch: str = "─") -> str:
    return ch * WIDTH


def _row(left: str, right: str, pad: int = WIDTH) -> str:
    space = max(1, pad - len(left) - len(right))
    return left + " " * space + right


def render_summary(ledger: Ledger) -> str:
    rows = [
        _line("═"),
        _row("账本汇总", ""),
        _line(),
        _row("收入", "%.2f" % ledger.income()),
        _row("支出", "%.2f" % ledger.expense()),
        _line(),
        _row("结余", "%.2f" % ledger.total()),
        _line("═"),
    ]
    return "\n".join(rows)


def render_by_day(ledger: Ledger) -> str:
    rows = [_line("═"), _row("按天汇总", ""), _line()]
    for day, amount in ledger.by_day().items():
        mark = "+" if amount >= 0 else ""
        rows.append(_row(day, "%s%.2f" % (mark, amount)))
    rows.append(_line("═"))
    return "\n".join(rows)


def render_by_tag(ledger: Ledger) -> str:
    rows = [_line("═"), _row("按标签汇总", ""), _line()]
    for tag, amount in ledger.by_tag().items():
        mark = "+" if amount >= 0 else ""
        rows.append(_row(tag, "%s%.2f" % (mark, amount)))
    rows.append(_line("═"))
    return "\n".join(rows)

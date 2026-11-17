"""命令行入口：add / sum / day / tag 四个子命令。

没装依赖也能跑，参数用 argparse，输出用人能看懂的中文。
"""

from __future__ import annotations

import argparse
import sys

from ledger import Ledger
from report import render_by_day, render_by_tag, render_summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ledger", description="一个小记账工具")
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("add", help="记一笔，正数收入、负数支出")
    add.add_argument("amount", type=float)
    add.add_argument("-n", "--note", default="")
    add.add_argument("-t", "--tag", action="append", default=[])

    sub.add_parser("sum", help="看总额")
    sub.add_parser("day", help="按天看")
    sub.add_parser("tag", help="按标签看")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    ledger = Ledger.load()

    if args.command == "add":
        try:
            entry = ledger.add(args.amount, note=args.note, tags=args.tag)
        except ValueError as err:
            print("记不进去：", err, file=sys.stderr)
            return 2
        ledger.save()
        print("已记录 %s %+.2f %s" % (entry.day, entry.amount, entry.note))
        return 0

    if args.command == "sum":
        print(render_summary(ledger))
    elif args.command == "day":
        print(render_by_day(ledger))
    elif args.command == "tag":
        print(render_by_tag(ledger))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

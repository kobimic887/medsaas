"""Compare the original Asinex .xls attachment with every stock pack offered by the app."""
import argparse
import hashlib
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
import subprocess

import xlrd


def check(workbook):
    root = Path(__file__).resolve().parents[1]
    # Exercise the quote's source mapping as well as the prices and their units.
    stock_packs = json.loads(subprocess.check_output([
        "node", "--input-type=module", "-e", """
        import { workbookPacksForRow } from './shared/compoundPriceBook.js';
        const families = ['BAS', 'LAS', 'PRO'];
        console.log(JSON.stringify(families.map(family => workbookPacksForRow('stock', family + ' 1'))));
        """
    ], cwd=root))
    data = workbook.read_bytes()
    sheet = xlrd.open_workbook(file_contents=data).sheet_by_name("ASINEX Price List USD")
    if sheet.cell_value(3, 2) != "1-10":
        raise ValueError("Expected the 1–10 compounds tier at C4")
    for col, family in enumerate(stock_packs, start=2):
        if sheet.cell_value(4, col) != family["category"]:
            raise ValueError(f"Unexpected family at {chr(65 + col)}5")
        if len(family["packs"]) != 8:
            raise ValueError("Expected eight offered pack sizes for each stock family")
        for row, pack in enumerate(reversed(family["packs"]), start=5):
            cell = f"{chr(65 + col)}{row + 1}"
            amount = Decimal(str(sheet.cell_value(row, col)))
            if (sheet.cell_value(row, 0) != f'{pack["mg"]} mg'
                    or pack["sourceCell"] != f"{sheet.name}!{cell}"
                    or pack["listCurrency"] != "usd" or not amount.is_finite()
                    or amount <= 0 or amount * 100 != pack["unitAmountCents"]):
                raise ValueError(f"{sheet.name}!{cell} differs from the offered pack")
    print(f"Matched all 24 stock prices and pack sizes. SHA-256 {hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    try:
        check(parser.parse_args().workbook)
    except (InvalidOperation, ValueError, IndexError, OSError, xlrd.XLRDError) as exc:
        parser.exit(1, f"Workbook check failed: {exc}\n")

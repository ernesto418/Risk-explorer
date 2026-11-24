"""Independent check (openpyxl, not the tool's own reader): lists every cell whose value differs between two
workbooks, over all sheets (formulas are compared as their text, array formulas included).
Usage: python3 xlsx_diff.py before.xlsx after.xlsx  ->  JSON {"diff": [[sheet, cell, old, new]], "styles": {...}}"""
import json, sys
from openpyxl import load_workbook
from openpyxl.worksheet.formula import ArrayFormula
def val(cell):
    return cell.value.text if isinstance(cell.value, ArrayFormula) else cell.value
a, b = load_workbook(sys.argv[1]), load_workbook(sys.argv[2])
diff = []
assert a.sheetnames == b.sheetnames, 'sheet list changed'
for n in a.sheetnames:
    x, y = a[n], b[n]
    for r in range(1, max(x.max_row, y.max_row) + 1):
        for c in range(1, max(x.max_column, y.max_column) + 1):
            u, v = val(x.cell(r, c)), val(y.cell(r, c))
            if (u if u is not None else '') != (v if v is not None else ''):
                diff.append([n, x.cell(r, c).coordinate, u, v])
    assert [str(m) for m in x.merged_cells.ranges] == [str(m) for m in y.merged_cells.ranges], 'merged cells changed in ' + n
# style of each new cell equals the style of the cell above it (new rows are formatted like the others)
styles = {}
for n, coord, u, v in diff:
    cell = b[n][coord]
    if u in (None, '') and cell.row > 1:
        above = b[n].cell(cell.row - 1, cell.column)
        styles[n + '!' + coord] = cell.style_id == above.style_id
print(json.dumps({'diff': diff, 'styles': styles}, default=str))

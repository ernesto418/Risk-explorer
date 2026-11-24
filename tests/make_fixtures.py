"""Regenerates all fixtures (fictional data only). Needs openpyxl and LibreOffice (soffice)."""
import os, re, shutil, subprocess, sys, tempfile, zipfile
from openpyxl import Workbook, load_workbook
H = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(H, 'fixtures')
# 1) sample.xlsx from the generator; 2) a LibreOffice-saved copy (shared strings, like Excel); 3) an "Excel-style" copy
#    with rich-text runs, phonetic runs and escaped carriage returns
subprocess.run([sys.executable, os.path.join(H, '..', 'sample', 'make_sample.py'), os.path.join(D, 'sample.xlsx')], check=True)
shutil.copy(os.path.join(D, 'sample.xlsx'), os.path.join(H, '..', 'sample', 'sample-risk-workbook.xlsx'))
with tempfile.TemporaryDirectory() as t:
    subprocess.run(['soffice', '--headless', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', t, os.path.join(D, 'sample.xlsx')], check=True, capture_output=True)
    shutil.copy(os.path.join(t, 'sample.xlsx'), os.path.join(D, 'libreoffice-copy.xlsx'))
zin = zipfile.ZipFile(os.path.join(D, 'libreoffice-copy.xlsx')); zout = zipfile.ZipFile(os.path.join(D, 'excel-style.xlsx'), 'w', zipfile.ZIP_DEFLATED)
def rich(m):
    txt = m.group(2); cut = txt.find(' ', len(txt) // 2)
    if '[RMG' not in txt or cut < 0: return m.group(0)
    return '<si><r><rPr><b/><sz val="11"/></rPr><t xml:space="preserve">%s</t></r><r><t xml:space="preserve">%s</t></r><rPh sb="0" eb="1"><t>IGNORED</t></rPh><phoneticPr fontId="1"/></si>' % (txt[:cut], txt[cut:])
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename == 'xl/sharedStrings.xml':
        data = re.sub(r'<si>\s*<t( [^>]*)?>(.*?)</t>\s*</si>', rich, data.decode('utf8').replace('&#10;', '_x000D_&#10;'), flags=re.S).encode('utf8')
    zout.writestr(item, data)
zout.close()
def sample(): return load_workbook(os.path.join(D, 'sample.xlsx'))
wb = sample(); ws = wb['Risik analysis Alpha']          # two risks edited: used by the change-log tests
ws['J8'] = 'rarely'; ws['O8'] = ws['O8'].value.rsplit('\n', 1)[0] + '\n- A brand new mitigation line [RMG02]'; ws['F9'] = 'Changed description'
wb.save(os.path.join(D, 'modified.xlsx'))
wb = sample(); ws = wb['Risik analysis Alpha']          # markup in cells must be shown as text, never executed
ws['F7'] = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>'
ws['O7'] = ws['O7'].value + '\n- <svg onload=window.__xss=3></svg> [RMG02]'; ws['G7'] = '"><iframe src="javascript:window.__xss=4"></iframe>'
wb['Risk Mitigation Groups']['I2'] = '<b onmouseover=window.__xss=5>Identity</b>'
wb.save(os.path.join(D, 'xss.xlsx'))
open(os.path.join(D, 'not-a-workbook.xlsx'), 'wb').write(b'this is not a zip archive ' * 8)
open(os.path.join(D, 'encrypted.xlsx'), 'wb').write(bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + b'\0' * 600)
w2 = Workbook(); w2.active['A1'] = 'unrelated'; w2.save(os.path.join(D, 'other-workbook.xlsx'))
print('fixtures written to', D)

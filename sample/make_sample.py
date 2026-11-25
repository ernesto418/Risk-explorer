"""Generates a FICTIONAL sample workbook in the layout the tool expects.

All content is invented (a made-up "telemetry platform"). The workbook deliberately
contains formatting and consistency mistakes so that every check of the tool can be
seen in action.  Usage:  python3 make_sample.py [output.xlsx]

Mitigation items (RMI) live only in "Risk mitigations individual" (RMI ID + text). Risks and groups list RMI IDs
in their "RMI ID" column (one per line); "Risk treatment option" / "Content" / "Groups" / "Assigned" are formulas
(openpyxl stores no results; Excel and LibreOffice calculate them when the file is opened).
"""
import random
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.formula import ArrayFormula

random.seed(2003)
OUT = sys.argv[1] if len(sys.argv) > 1 else "sample-risk-workbook.xlsx"

FREQ = {"rarely": 2, "medium": 3, "frequently": 6, "very frequently": 7}
EFFECT = {"negligible": 1, "limited": 3, "considerable": 5, "threatining the existence of the organisation": 7}
FREQ_K, EFFECT_K = list(FREQ), list(EFFECT)
CATS = ["Risk avoidance", "Risk mitigation / reduction", "Risk transference / sharing", "Risk acceptance"]

COMPONENTS = {"Edge Gateway": "GW", "Device Firmware": "FW", "Cloud API": "API", "Operator Console": "OC",
              "Update Server": "UPD", "Telemetry Database": "DB", "Identity Provider": "IDP"}

ASSUMPTIONS = [
    ("A.1", "Gateways are installed in locked cabinets", "Physical access to deployed gateways requires a key held by the operator.", "Edge Gateway", "Valid", "Valid", ""),
    ("A.2", "Cloud provider operates certified data centres", "Physical and environmental security of the hosting region is covered by the provider's certification.", "Cloud API; Telemetry Database", "Valid", "Valid", "Certificate renewed yearly"),
    ("A.3", "Operators are trained and trustworthy", "Operator staff completed security awareness training and are bound by contract.", "Operator Console", "Valid", "To be reviewed", ""),
    ("A.4", "Devices have a hardware root of trust", "Every device contains a secure element that protects keys.", "Device Firmware; Edge Gateway", "Valid", "Valid", ""),
    ("A.5", "Customer network is untrusted", "No security guarantee is assumed for the network the gateway is attached to.", "Edge Gateway", "Valid", "Valid", ""),
    ("A.6", "Time source is reliable", "A trustworthy time source is available to all backend components.", "Cloud API; Identity Provider", "Valid", "Valid", ""),
    ("A.7", "Update packages are built on a hardened build system", "The build pipeline is isolated and access controlled.", "Update Server; Device Firmware", "Not valid", "Valid", "Build system hardening planned for Beta"),
    ("A.8", "Identity provider is operated by corporate IT", "Availability and patching of the identity provider are a corporate responsibility.", "Identity Provider", "Valid", "Valid", ""),
    ("A.9", "Telemetry contains no personal data", "Payloads are restricted to machine data by design.", "Telemetry Database", "Valid", "To be reviewed", "Re-check when new sensors are added"),
    ("A.10", "A second hosting region is available", "Reserved for a future disaster recovery concept.", "Cloud API", "Not valid", "Valid", "Not used by any risk yet"),
]

GROUPS = {
    "RMG01": ("Risk mitigation / reduction", "Identity & access management", [
        "Enforce multi-factor authentication for all operator accounts",
        "Apply role based access control with least privilege",
        "Rotate service credentials automatically every 90 days",
        "Lock accounts after five failed login attempts",
        "Review access rights every quarter"]),
    "RMG02": ("Risk mitigation / reduction", "Secure communication", [
        "Use mutually authenticated TLS 1.3 for all device connections",
        "Pin the backend certificate in the device firmware",
        "Encrypt telemetry payloads end to end",
        "Reject messages with stale timestamps or reused nonces"]),
    "RMG03": ("Risk mitigation / reduction", "Secure boot & firmware integrity", [
        "Verify firmware signatures in the boot loader",
        "Store device keys in the secure element",
        "Sign update packages with an offline key",
        "Enable rollback protection for firmware versions",
        "Disable debug interfaces in production devices"]),
    "RMG04": ("Risk mitigation / reduction", "Logging & monitoring", [
        "Forward security events to the central SIEM",
        "Alert on anomalous device behaviour",
        "Keep tamper evident audit logs for administrative actions",
        "Monitor certificate expiry dates"]),
    "RMG05": ("Risk mitigation / reduction", "Backup & recovery", [
        "Create encrypted database backups every night",
        "Test restore procedures twice a year",
        "Replicate the telemetry database to a standby instance",
        "Document and rehearse the disaster recovery plan"]),
    "RMG06": ("Risk mitigation / reduction", "Hardening & patch management", [
        "Apply security patches within 30 days of release",
        "Harden operating system images according to the baseline",
        "Scan container images for known vulnerabilities",
        "Remove unused services and open ports"]),
    "RMG07": ("Risk mitigation / reduction", "Secure development lifecycle", [
        "Perform threat modelling for every new feature",
        "Run static code analysis in the build pipeline",
        "Commission an independent penetration test before each release",
        "Track third party components in a software bill of materials"]),
    "RMG08": ("Risk mitigation / reduction", "Network segmentation", [
        "Separate management and telemetry networks",
        "Restrict inbound traffic with an allow list firewall",
        "Rate limit API requests per client",
        "Terminate external connections in a demilitarised zone"]),
    "RMG09": ("Risk transference / sharing", "Operational procedures", [
        "Maintain an incident response on-call rota"]),
    "RMG10": ("Risk mitigation / reduction", "Physical protection", [       # only linked to not-relevant risks
        "Seal gateway housings with tamper evident labels"]),
}

THREATS = [
    (1, "Fire", "Not relevant: covered by the hosting provider (see A.2).", []),
    (9, "Failure or Disruption of Communication Networks", "Indirectly relevant, covered by G 0.25.", []),
    (14, "Interception of Information / Espionage", "Directly relevant", ["Edge Gateway", "Cloud API"]),
    (15, "Eavesdropping", "Directly relevant", ["Edge Gateway", "Operator Console"]),
    (16, "Theft of Devices, Storage Media and Documents", "Directly relevant", ["Edge Gateway"]),
    (18, "Bad Planning or Lack of Adaptation", "Directly relevant", ["Cloud API", "Update Server"]),
    (19, "Disclosure of Sensitive Information", "Directly relevant", ["Telemetry Database", "Operator Console", "Cloud API"]),
    (21, "Manipulation with Hardware or Software", "Directly relevant", ["Device Firmware", "Edge Gateway", "Update Server"]),
    (22, "Manipulation of Information", "Directly relevant", ["Telemetry Database", "Cloud API"]),
    (23, "Unauthorised Access to IT Systems", "Directly relevant", ["Cloud API", "Operator Console", "Identity Provider", "Edge Gateway"]),
    (25, "Failure of Devices or Systems", "Directly relevant", ["Telemetry Database", "Update Server", "Identity Provider"]),
    (28, "Software Vulnerabilities or Errors", "Directly relevant", ["Device Firmware", "Cloud API", "Operator Console"]),
    (30, "Unauthorised Use or Administration of Devices and Systems", "Directly relevant", ["Operator Console", "Edge Gateway"]),
    (32, "Abuse of Authorisations", "Directly relevant", ["Operator Console", "Identity Provider"]),
    (36, "Identity Theft", "Directly relevant", ["Identity Provider", "Operator Console"]),
    (39, "Malware", "Directly relevant", ["Operator Console", "Update Server"]),
    (40, "Denial of Service", "Directly relevant", ["Cloud API", "Edge Gateway", "Identity Provider"]),
    (43, "Replaying Messages", "Directly relevant", ["Edge Gateway", "Cloud API"]),
    (45, "Data Loss", "Directly relevant", ["Telemetry Database"]),
    (46, "Loss of Integrity of Sensitive Information", "Directly relevant", ["Telemetry Database", "Device Firmware"]),
]
THREAT_GROUPS = {14: ["RMG02", "RMG08"], 15: ["RMG02"], 16: ["RMG03", "RMG04"], 18: ["RMG07", "RMG06"], 19: ["RMG01", "RMG02", "RMG04"],
                 21: ["RMG03", "RMG07"], 22: ["RMG02", "RMG04", "RMG01"], 23: ["RMG01", "RMG08", "RMG06"], 25: ["RMG05", "RMG04"],
                 28: ["RMG06", "RMG07"], 30: ["RMG01", "RMG04"], 32: ["RMG01", "RMG04"], 36: ["RMG01"], 39: ["RMG06", "RMG04"],
                 40: ["RMG08", "RMG05"], 43: ["RMG02"], 45: ["RMG05"], 46: ["RMG03", "RMG05", "RMG02"]}
THREAT_CIA = {14: "Confidentiality", 15: "Confidentiality", 16: "Confidentiality, Availability", 18: "Confidentiality, Integrity, Availability",
              19: "Confidentiality", 21: "Confidentiality, Integrity, Availability", 22: "Integrity", 23: "Confidentiality, Integrity",
              25: "Availability", 28: "Confidentiality, Integrity, Availability", 30: "Confidentiality, Integrity", 32: "Confidentiality, Integrity",
              36: "Confidentiality, Integrity", 39: "Integrity, Availability", 40: "Availability", 43: "Integrity", 45: "Availability", 46: "Integrity"}
COMP_ASSUMPTIONS = {"Edge Gateway": ["A.1", "A.5", "A.4"], "Device Firmware": ["A.4", "A.7"], "Cloud API": ["A.2", "A.6"], "Operator Console": ["A.3"],
                    "Update Server": ["A.7"], "Telemetry Database": ["A.2", "A.9"], "Identity Provider": ["A.8", "A.6"]}
A_TITLE = {a[0]: a[1] for a in ASSUMPTIONS}

# ---------------------------------------------------------------- risks
risks = []
counter = {}
for num, name, rel, comps in THREATS:
    for comp in comps:
        ab = COMPONENTS[comp]
        counter[ab] = counter.get(ab, 0) + 1
        rid = f"R.{ab}.{counter[ab]}"
        f = random.choices(FREQ_K, [2, 4, 4, 1])[0]
        e = random.choices(EFFECT_K, [1, 3, 5, 2])[0]
        cat = random.choices(CATS, [1, 14, 1, 2])[0]
        items = []
        for g in THREAT_GROUPS[num]:
            for txt in random.sample(GROUPS[g][2], k=random.randint(1, 3)):
                items.append([txt, g])
        if cat == "Risk acceptance":
            items = items[:1] if random.random() < .4 else []
            fa, ea = "", ""
        else:
            fa = FREQ_K[max(0, FREQ_K.index(f) - random.choice([1, 1, 2, 2, 3]))]
            ea = EFFECT_K[max(0, EFFECT_K.index(e) - random.choice([0, 0, 1, 1]))]
        asm = random.sample(COMP_ASSUMPTIONS[comp], k=random.randint(0, min(2, len(COMP_ASSUMPTIONS[comp]))))
        risks.append(dict(num=num, tname=f"G 0.{num} {name}", rel=rel, rid=rid, comp=comp, cia=THREAT_CIA[num], asm=asm, f=f, e=e, cat=cat,
                          items=items, fa=fa, ea=ea,
                          desc=f"{name} affecting the {comp}: an attacker or fault could exploit the {comp.lower()} and impair "
                               f"{THREAT_CIA[num].lower().replace(', ', ' and ')} of the telemetry service.",
                          save=f"{comp}: {name.lower()}. Assessed for the Alpha release."))

def find(rid):
    return next(r for r in risks if r["rid"] == rid)

# ---------------------------------------------------------------- master list of mitigation items (RMI ID + text)
FOUR_EYES = "Introduce a four-eyes principle for configuration changes"      # used by a risk, listed by no group
TABLETOP = "Run a yearly tabletop exercise"                                   # used by no risk and no group
WAF = "Deploy a web application firewall in front of the API"                 # listed by a group, used by no risk
canon = []
for gid, (_, _, items) in GROUPS.items():
    for t in items:
        if t not in canon: canon.append(t)
canon += [FOUR_EYES, TABLETOP, WAF]
MASTER = [[f"RMI-{n + 1:03d}", t] for n, t in enumerate(canon)]
MASTER.append([f"RMI-{len(MASTER) + 1:03d}", "Monitor certificate expiry dates"])   # same text as another RMI
# column "Removed": empty / no = active, yes = removed; anything else is a format error (treated as active)
REMOVED_LINKED = f"RMI-{len(MASTER) + 1:03d}"
MASTER.append([REMOVED_LINKED, "Rotate service credentials automatically every 90 days"])   # removed, same text as an active RMI (no warning), still linked (errors)
MASTER.append([f"RMI-{len(MASTER) + 1:03d}", ""])                                # removed without text (no warning)
REMOVED = {REMOVED_LINKED: "Yes", MASTER[-1][0]: "yes"}
ID = {}
for i, t in MASTER: ID.setdefault(t, i)
TEXT = {i: t for i, t in MASTER}
REMOVED[ID[TABLETOP]] = "yes"                                                   # removed and unused: no "not used" warning
REMOVED[ID["Review access rights every quarter"]] = "maybe"                     # invalid value -> format error, stays active

for r in risks:
    r["ids"] = [ID[t] for t, g in r["items"]]

# ------------------------------------------------ deliberate mistakes (so every check has something to show)
mit = [r for r in risks if r["cat"] == CATS[1] and len(r["items"]) >= 3]
m = iter(mit)
r = next(m); r["ids"][0] = r["ids"][0].lower()                                  # RMI ID spelled differently (read as the ID)
r = next(m); r["ids"][1] = r["ids"][1] + " " + TEXT[r["ids"][1]]                # text after the RMI ID
r = next(m); r["ids"][0:2] = [r["ids"][0] + ", " + r["ids"][1]]                 # two RMI IDs on one line
r = next(m); r["ids"].append("RMI-099")                                         # RMI ID not in the master list
r = next(m); r["ids"].append(ID[FOUR_EYES])                                     # item that no group lists
r = next(m); r["ids"].append(r["ids"][0])                                       # same RMI ID twice
r = next(m); r["hand_typed"] = True                                             # treatment text typed instead of the formula
r = next(m); r["ids"][2] = TEXT[r["ids"][2]]                                    # item text instead of its RMI ID
r = next(m); r["ids"][1] = r["ids"][1].replace("-", " - ")                      # RMI ID with spaces (read as the ID)
r = next(m); r["ids"].insert(1, "")                                             # empty line inside the cell (ignored, no finding)
r = next(m); r["f_cell"] = "frequent"                                           # value not in list
r = next(m); r["index_override"] = 21                                           # index does not match
r = next(m); r["asm_override"] = "A.42 Devices are never connected to the internet"   # unknown assumption
r = next(m); r["asm_override"] = "A 3 Operators are trained and trustworthy"    # malformed assumption reference
r = next(m); r["comp_override"] = "Edge Gatway" if r["comp"] == "Edge Gateway" else r["comp"].replace("a", "aa", 1)   # component typo
r = next(m); r["cia"] = r["cia"].replace("Availability", "Availabilty") if "Availability" in r["cia"] else "Integrity, Privacy"
r = next(m); r["fa"], r["ea"] = "", ""                                          # after-treatment assessment missing
r = next(m); r["fa"], r["ea"] = "very frequently", EFFECT_K[3]                  # risk rises after treatment
r = next(m); r["red_override"] = 99                                             # wrong reduction value
r = next(m); r["asm_title_override"] = True                                     # assumption cited with a different title
dup = risks[7]; dup["rid"] = risks[6]["rid"]                                    # duplicate risk ID

# "Threat relevance" is written per risk: despite its name it says whether the RISK is relevant
for r in risks:
    r["rel"] = "Directly relevant"
for r in risks:
    if r["num"] == 16:                                                          # threat whose risks are all not relevant
        r["rel"] = "Not relevant: gateways are installed in locked cabinets (see A.1)."
        r["ids"].append(ID["Seal gateway housings with tamper evident labels"])  # RMG10 and its item: only not-relevant risks
next(r for r in risks if r["num"] == 43)["rel"] = "not relevant - replay protection is provided by the transport layer"  # mixed threat
special = [r for r in risks if r["num"] not in (16, 43) and r["rid"] not in ("R.DB.2", "R.API.1", "R.GW.2")]
special[10]["rel"] = "Indirectly relevant, covered by G 0.23."                  # relevant
special[14]["rel"] = "Currently NOT RELEVANT: feature disabled in the Alpha release"   # not relevant (any case, any position)
special[18]["rel"] = None                                                       # empty -> warning, counts as relevant
special[22]["rel"] = "Not relevent for the Alpha release"                       # typo -> warning, NOT hidden
special[5]["ids"].append(REMOVED_LINKED)                                        # a risk still listing a removed item
mis = next(x for x in risks if x["num"] == 32); mis["tid_override"] = "T.BSI.23"  # threat id / name mismatch (first row of the threat)

# group RMI IDs, with a few inconsistencies
group_ids = {g: [ID[t] for t in v[2]] for g, v in GROUPS.items()}
group_ids["RMG08"].append(ID[WAF])                                              # listed here, used by no risk
group_ids["RMG04"].append(ID["Run static code analysis in the build pipeline"])  # item listed by two groups
group_ids["RMG06"].append("RMI-098")                                            # RMI ID not in the master list
group_ids["RMG03"][3:5] = [group_ids["RMG03"][3] + "; " + group_ids["RMG03"][4]]  # two RMI IDs on one line
group_ids["RMG02"].append(REMOVED_LINKED)                                       # a group still listing a removed item
HAND_TYPED_GROUP = "RMG06"                                                      # Content typed instead of the formula

# ---------------------------------------------------------------- workbook
wb = Workbook()
wb.calculation.fullCalcOnLoad = True   # openpyxl stores no formula results: let Excel calculate them on opening
bold, head_fill = Font(bold=True), PatternFill("solid", fgColor="DDE6F0")
wrap = Alignment(wrap_text=True, vertical="top")
RMI_SHEET, GRP_SHEET = "'Risk mitigations individual'", "'Risk Mitigation Groups'"
M_LAST = 1 + len(MASTER) + 60          # formula ranges leave room for new rows
G_LAST = 1 + len(GROUPS) + 40

def texts_of(ids_cell):
    """Array formula: "- <text>" of every master item whose RMI ID is a line of ids_cell (in master order)."""
    a, b = f"{RMI_SHEET}!$A$2:$A${M_LAST}", f"{RMI_SHEET}!$B$2:$B${M_LAST}"
    return ArrayFormula(None, f'=_xlfn.TEXTJOIN(CHAR(10),TRUE,IF(ISNUMBER(FIND(CHAR(10)&{a}&CHAR(10),CHAR(10)&{ids_cell}&CHAR(10)))*({a}<>""),"- "&{b},""))')

def set_array(ws, ref, f):
    f.ref = ref
    ws[ref] = f

ws = wb.active
ws.title = "Architecture Assumptions"
ws["B2"] = "Architecture assumptions (fictional sample data)"; ws["B2"].font = Font(bold=True, size=14)
for i, hname in enumerate(["Assumption ID", "Title", "Description", "Affected components", "Linked risks", "Validity for Alpha Release", "Validity for Beta Release", "Comment"]):
    c = ws.cell(row=5, column=2 + i, value=hname); c.font = bold; c.fill = head_fill
for ri, a in enumerate(ASSUMPTIONS):
    vals = [a[0], a[1], a[2], a[3], None, a[4], a[5], a[6]]
    for ci, v in enumerate(vals):
        ws.cell(row=6 + ri, column=2 + ci, value=v or None).alignment = wrap

ws = wb.create_sheet("Risik analysis Alpha")
ws["B2"] = "Risk analysis Alpha (fictional sample data)"; ws["B2"].font = Font(bold=True, size=14)
HEAD = ["Threat ID", "Threat", "Threat relevance", "Risk ID", "Risk description", "Affected component", "Core values at risk", "Related assumptions",
        "Frequency of occurence", "Effects without additional safeguards", "Risk index", "Description for SAVe database (General Information)",
        "Risk Treatment category", "RMI ID", "Risk treatment option", "Frequency of occurence (after treatment)", "Effects after rollout of treatment ",
        "Risk index (after treatment)", "Risk reduction value"]
for i, hname in enumerate(HEAD):
    c = ws.cell(row=4, column=2 + i, value=hname); c.font = bold; c.fill = head_fill; c.alignment = wrap
row = 5
for num, name, rel, comps in THREATS:
    rs = [r for r in risks if r["num"] == num]
    first = row
    if not rs:
        ws.cell(row=row, column=2, value=f"T.BSI.{num}"); ws.cell(row=row, column=3, value=f"G 0.{num} {name}"); ws.cell(row=row, column=4, value=rel)
        row += 1
        continue
    merged = num % 2 == 0   # even threats: merged Threat ID / Threat cells; odd threats: value repeated on every row
    for k, r in enumerate(rs):
        if k == 0 or not merged:
            ws.cell(row=row, column=2, value=r.get("tid_override", f"T.BSI.{num}")); ws.cell(row=row, column=3, value=r["tname"])
        ws.cell(row=row, column=4, value=r["rel"])                              # one relevance per risk row (never merged)
        asm = r.get("asm_override") or "\n".join(f"{a} {A_TITLE[a]}" for a in r["asm"])
        if r.get("asm_title_override") and r["asm"]:
            asm = f"{r['asm'][0]} Something else entirely"
        f_cell = r.get("f_cell", r["f"])
        vals = [r["rid"], r["desc"], r.get("comp_override", r["comp"]), r["cia"], asm or None, f_cell, r["e"], None, r["save"], r["cat"],
                "\n".join(r["ids"]) or None, None, r["fa"] or None, r["ea"] or None, None, None]
        for ci, v in enumerate(vals):
            ws.cell(row=row, column=5 + ci, value=v).alignment = wrap
        if r.get("hand_typed"):
            ws.cell(row=row, column=16, value="\n".join("- " + TEXT.get(i, i) for i in r["ids"][1:]))
        else:
            set_array(ws, f"P{row}", texts_of(f"O{row}"))
        idx = r.get("index_override", FREQ[r["f"]] * EFFECT[r["e"]])
        ws.cell(row=row, column=12, value=idx)
        if r["fa"] and r["ea"]:
            ia = FREQ[r["fa"]] * EFFECT[r["ea"]]
            ws.cell(row=row, column=19, value=ia)
            ws.cell(row=row, column=20, value=r.get("red_override", idx - ia))
        row += 1
    if merged and len(rs) > 1:
        for col in (2, 3):
            ws.merge_cells(start_row=first, start_column=col, end_row=row - 1, end_column=col)
for col, w in zip("BCDEFGHIJKLMNOPQRST", [11, 30, 22, 10, 50, 18, 22, 34, 14, 18, 8, 34, 22, 12, 70, 14, 18, 8, 10]):
    ws.column_dimensions[col].width = w

ws = wb.create_sheet("Assumed Risks Beta")
ws["B2"] = "Not used by the tool - this sheet is ignored"
for i, hname in enumerate(HEAD[:6]):
    ws.cell(row=4, column=2 + i, value=hname).font = bold
ws.cell(row=5, column=2, value="T.BSI.99"); ws.cell(row=5, column=5, value="R.BETA.1"); ws.cell(row=5, column=6, value="Placeholder that must not appear in the tool")

ws = wb.create_sheet("Risk Mitigation Groups")
ws["A1"] = "Legend"; ws["A2"] = "RMG = Risk Mitigation Group"; ws["A3"] = "RMI = individual risk mitigation option"; ws["B5"] = "Some unrelated notes"
for i, hname in enumerate(["Risk Mitigation Group ID", "Risk treatment", "Security Measure Group", "RMI ID", "Content"]):
    c = ws.cell(row=1, column=7 + i, value=hname); c.font = bold; c.fill = head_fill
for ri, (gid, (treat, gname, items)) in enumerate(GROUPS.items()):
    for ci, v in enumerate([gid, treat, gname, "\n".join(group_ids[gid])]):
        ws.cell(row=2 + ri, column=7 + ci, value=v).alignment = wrap
    if gid == HAND_TYPED_GROUP:
        ws.cell(row=2 + ri, column=11, value="\n".join("- " + t for t in items))
    else:
        set_array(ws, f"K{2 + ri}", texts_of(f"J{2 + ri}"))
    ws.cell(row=2 + ri, column=11).alignment = wrap
ws.column_dimensions["I"].width = 34; ws.column_dimensions["J"].width = 12; ws.column_dimensions["K"].width = 80

# master list of individual mitigation items (headers start in A1)
ws = wb.create_sheet("Risk mitigations individual")
for i, hname in enumerate(["RMI ID", "Mitigation item", "Groups", "Assigned", " Extended Description", "Comment", "Responsible", "Removed"]):
    c = ws.cell(row=1, column=1 + i, value=hname); c.font = bold; c.fill = head_fill
people = ["Security Officer", "Platform Team", "Operations", "Development Lead"]
g_ids, g_rmi = f"{GRP_SHEET}!$G$2:$G${G_LAST}", f"{GRP_SHEET}!$J$2:$J${G_LAST}"
for n, (rid, t) in enumerate(MASTER):
    rr = 2 + n
    removed = REMOVED.get(rid, "no" if n % 5 == 0 else "No" if n % 7 == 0 else "")
    row = [rid, t or None, None, None, f"Implementation details for: {t.lower()}." if t else None, "" if n % 3 else "Reviewed in workshop", people[n % 4], removed]
    for ci, v in enumerate(row):
        ws.cell(row=rr, column=1 + ci, value=v or None).alignment = wrap
    set_array(ws, f"C{rr}", ArrayFormula(None, f'=_xlfn.TEXTJOIN(", ",TRUE,IF(ISNUMBER(FIND(CHAR(10)&A{rr}&CHAR(10),CHAR(10)&{g_rmi}&CHAR(10)))*({g_ids}<>""),{g_ids},""))'))
    ws.cell(row=rr, column=4, value=f'=IF(C{rr}="","No","Si")')
ws.column_dimensions["B"].width = 60; ws.column_dimensions["E"].width = 50

wb.save(OUT)
print("written", OUT, "-", len(risks), "risks,", len(MASTER), "mitigation items")

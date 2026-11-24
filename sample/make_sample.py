"""Generates a FICTIONAL sample workbook in the layout the tool expects.

All content is invented (a made-up "telemetry platform"). The workbook deliberately
contains formatting and consistency mistakes so that every check of the tool can be
seen in action.  Usage:  python3 make_sample.py [output.xlsx]
"""
import random
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

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

def line(txt, grp, bullet="- ", tag=None):
    t = tag if tag is not None else (f" [{grp}]" if grp else "")
    return f"{bullet}{txt}{t}"

for r in risks:
    r["lines"] = [line(t, g) for t, g in r["items"]]
    r["intro"] = "The following measures reduce the risk:"

# ------------------------------------------------ deliberate mistakes (so every check has something to show)
mit = [r for r in risks if r["cat"] == CATS[1] and len(r["items"]) >= 3]
# group assignment not processed yet for the secure development measures
for r in risks:
    r["lines"] = [l.replace(" [RMG07]", "") if random.random() < .75 else l for l in r["lines"]]
m = iter(mit)
r = next(m); r["lines"][0] = r["lines"][0][2:]                                  # missing "- "
r = next(m); r["lines"][1] = "– " + r["lines"][1][2:]                      # en dash instead of hyphen
r = next(m); r["lines"][0] = "-" + r["lines"][0][2:]                            # missing space after hyphen
r = next(m); r["lines"][1] = r["lines"][1].rsplit(" [", 1)[0] + " [RMG99]"      # unknown group
r = next(m); r["lines"][0] = r["lines"][0].replace("[RMG", "[rmg")              # tag in lower case
r = next(m); r["lines"][2] = r["lines"][2][:-1]                                 # missing closing bracket
r = next(m); r["lines"][0] = r["lines"][0].rsplit(" [", 1)[0].upper()[:3] + r["lines"][0].rsplit(" [", 1)[0][3:].replace("  ", " ") + " [RMG04]"  # tagged for a group that does not list it
r = next(m); r["lines"].append("- Introduce a four-eyes principle for configuration changes [RMG01]")  # tagged, missing in group content
r = next(m); r["intro"] = None                                                  # intro line missing
r = next(m); r["lines"].append(r["lines"][0])                                   # duplicate line
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
r = next(m); r["lines"][1] = r["lines"][1].replace("the ", "the  ", 1)          # same item, different spacing
dup = risks[7]; dup["rid"] = risks[6]["rid"]                                    # duplicate risk ID
mis = next(x for x in risks if x["num"] == 32); mis["tid_override"] = "T.BSI.23"  # threat id / name mismatch (first row of the threat)

# group content: copies of the item texts, with a few inconsistencies
content = {g: [f"- {t}" for t in v[2]] for g, v in GROUPS.items()}
content["RMG02"][1] = "- Pin the Backend Certificate in the device firmware"               # differs in case
content["RMG05"][0] = "- Create encrypted data base backups each night"                    # reworded
content["RMG06"][3] = "Remove unused services and open ports"                              # missing "- "
content["RMG08"].append("- Deploy a web application firewall in front of the API")         # exists nowhere in the risk analysis
content["RMG04"].append("- Run static code analysis in the build pipeline")                # listed here, but tagged RMG07 / untagged in the risks
content["RMG03"][2] = "- Sign update packages with an offline key [RMG06]"                 # tag points to another group

# ---------------------------------------------------------------- workbook
wb = Workbook()
bold, head_fill = Font(bold=True), PatternFill("solid", fgColor="DDE6F0")
wrap = Alignment(wrap_text=True, vertical="top")

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
        "Risk Treatment category", "Risk treatment option", "Frequency of occurence (after treatment)", "Effects after rollout of treatment ",
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
    merged = num % 2 == 0   # even threats: merged threat cells; odd threats: value repeated on every row
    for k, r in enumerate(rs):
        if k == 0 or not merged:
            ws.cell(row=row, column=2, value=r.get("tid_override", f"T.BSI.{num}")); ws.cell(row=row, column=3, value=r["tname"]); ws.cell(row=row, column=4, value=rel)
        asm = r.get("asm_override") or "\n".join(f"{a} {A_TITLE[a]}" for a in r["asm"])
        if r.get("asm_title_override") and r["asm"]:
            asm = f"{r['asm'][0]} Something else entirely"
        f_cell = r.get("f_cell", r["f"])
        vals = [r["rid"], r["desc"], r.get("comp_override", r["comp"]), r["cia"], asm or None, f_cell, r["e"], None, r["save"], r["cat"],
                "\n".join(([r["intro"]] if r["intro"] else []) + r["lines"]) or None, r["fa"] or None, r["ea"] or None, None, None]
        for ci, v in enumerate(vals):
            ws.cell(row=row, column=5 + ci, value=v).alignment = wrap
        idx = r.get("index_override", FREQ[r["f"]] * EFFECT[r["e"]])
        ws.cell(row=row, column=12, value=idx)
        if r["fa"] and r["ea"]:
            ia = FREQ[r["fa"]] * EFFECT[r["ea"]]
            ws.cell(row=row, column=18, value=ia)
            ws.cell(row=row, column=19, value=r.get("red_override", idx - ia))
        row += 1
    if merged and len(rs) > 1:
        for col in (2, 3, 4):
            ws.merge_cells(start_row=first, start_column=col, end_row=row - 1, end_column=col)
for col, w in zip("BCDEFGHIJKLMNOPQRS", [11, 30, 22, 10, 50, 18, 22, 34, 14, 18, 8, 34, 22, 70, 14, 18, 8, 10]):
    ws.column_dimensions[col].width = w

ws = wb.create_sheet("Assumed Risks Beta")
ws["B2"] = "Not used by the tool - this sheet is ignored"
for i, hname in enumerate(HEAD[:6]):
    ws.cell(row=4, column=2 + i, value=hname).font = bold
ws.cell(row=5, column=2, value="T.BSI.99"); ws.cell(row=5, column=5, value="R.BETA.1"); ws.cell(row=5, column=6, value="Placeholder that must not appear in the tool")

ws = wb.create_sheet("Risk Mitigation Groups")
ws["A1"] = "Legend"; ws["A2"] = "RMG = Risk Mitigation Group"; ws["A3"] = "RMI = individual risk mitigation option"; ws["B5"] = "Some unrelated notes"
for i, hname in enumerate(["Risk Mitigation Group ID", "Risk treatment", "Security Measure Group", "Content"]):
    c = ws.cell(row=1, column=7 + i, value=hname); c.font = bold; c.fill = head_fill
for ri, (gid, (treat, gname, _)) in enumerate(GROUPS.items()):
    for ci, v in enumerate([gid, treat, gname, "\n".join(content[gid])]):
        ws.cell(row=2 + ri, column=7 + ci, value=v).alignment = wrap
ws.column_dimensions["I"].width = 34; ws.column_dimensions["J"].width = 80

# master list of individual mitigation items (headers start in A1)
ws = wb.create_sheet("Risk mitigations individual")
for i, hname in enumerate(["RMI ID", "Mitigation item", "Groups", "Assigned", " Extended Description", "Comment", "Responsible"]):
    c = ws.cell(row=1, column=1 + i, value=hname); c.font = bold; c.fill = head_fill
canon = []
for gid, (_, _, items) in GROUPS.items():
    for t in items:
        if t not in canon: canon.append(t)
canon.append("Introduce a four-eyes principle for configuration changes")
canon.append("Run a yearly tabletop exercise")                                   # not used anywhere -> warning
canon.remove("Review access rights every quarter")                               # used, but missing here -> error
people = ["Security Officer", "Platform Team", "Operations", "Development Lead"]
for n, t in enumerate(canon):
    groups = [g for g in GROUPS if ("- " + t) in content[g]]
    stated = list(groups)
    if t == "Disable debug interfaces in production devices": stated = ["RMG02"]          # wrong Groups -> error
    assigned = "Si" if groups else "No"
    if t == "Run a yearly tabletop exercise": assigned = "Si"                            # wrong Assigned -> error
    row = [f"RMI-{n + 1:03d}", t, ("\n" if n % 2 else ", ").join(stated), assigned,
           f"Implementation details for: {t.lower()}.", "" if n % 3 else "Reviewed in workshop", people[n % 4]]
    for ci, v in enumerate(row):
        ws.cell(row=2 + n, column=1 + ci, value=v or None).alignment = wrap
ws.column_dimensions["B"].width = 60; ws.column_dimensions["E"].width = 50

wb.save(OUT)
print("written", OUT, "-", len(risks), "risks")

/* ---------------------------------------------------------------------------
 * 03-config.js — project conventions. Change values here if the workbook
 * conventions change (scale values, thresholds, allowed list values).
 * ------------------------------------------------------------------------- */

const CFG = {
  /* Risk index = frequency value × effects value (min 2, max 49). */
  freq: [
    { key: 'rarely', label: 'rarely', value: 2, match: /^rarely$/, desc: 'According to current knowledge, the event could occur at most once every five years.' },
    { key: 'medium', label: 'medium', value: 3, match: /^medium$/, desc: 'The event occurs between once every five years and once a year.' },
    { key: 'frequently', label: 'frequently', value: 6, match: /^frequently$/, desc: 'The event occurs between once a year and once a month.' },
    { key: 'very frequently', label: 'very frequently', value: 7, match: /^very frequently$/, desc: 'The event occurs several times a month.' },
  ],
  effect: [
    { key: 'negligible', label: 'negligible', value: 1, match: /^negligible$/, desc: 'The effects of the damage are low and can be neglected.' },
    { key: 'limited', label: 'limited', value: 3, match: /^limited$/, desc: 'The effects of the damage are limited and manageable.' },
    { key: 'considerable', label: 'considerable', value: 5, match: /^considerable$/, desc: 'The effects of the damage can be considerable.' },
    { key: 'existential', label: 'threatening the existence', value: 7, match: /^threat[ei]ning the existence( of the organi[sz]ation)?$/, desc: 'The effects of the damage can reach a catastrophic level that threatens the existence of the organisation.' },
  ],
  /* Colour bands of the risk index (same thresholds as the workbook's conditional formatting). */
  bands: [
    { key: 'low', label: 'Low', range: '≤ 10', max: 10 },
    { key: 'medium', label: 'Medium', range: '11–20', max: 20 },
    { key: 'high', label: 'High', range: '> 20', max: Infinity },
  ],
  categories: [
    { key: 'avoidance', label: 'Risk avoidance', short: 'Avoidance', match: /^risk avoidance$/, desc: 'Option A — restructure the process or system so that the cause of the risk is eliminated.' },
    { key: 'mitigation', label: 'Risk mitigation / reduction', short: 'Mitigation', match: /^risk mitigation ?\/ ?reduction$/, desc: 'Option B — lower the risk with additional security safeguards.' },
    { key: 'transfer', label: 'Risk transference / sharing', short: 'Transfer', match: /^risk transference ?\/ ?sharing$/, desc: 'Option C — share the risk with another party (insurance, outsourcing).' },
    { key: 'acceptance', label: 'Risk acceptance', short: 'Acceptance', match: /^risk acceptance$/, desc: 'Option D — accept the (residual) risk on a comprehensible factual basis, approved by management.' },
  ],
  coreValues: [
    { key: 'C', label: 'Confidentiality', match: /^confidentiality$/ },
    { key: 'I', label: 'Integrity', match: /^integrity$/ },
    { key: 'A', label: 'Availability', match: /^availability$/ },
  ],
  patterns: {
    threatId: /^T\.[A-Za-z]+\.\d+$/,
    riskId: /^[A-Za-z]+\.[A-Za-z]+\.\d+$/,
    assumptionId: /^A\.\d+$/,
    groupId: /^[A-Za-z0-9]+$/,
  },
};

function levelOf(idx) {
  if (idx == null) return 'none';
  for (const b of CFG.bands) if (idx <= b.max) return b.key;
  return 'high';
}
const LEVEL_LABEL = { low: 'Low', medium: 'Medium', high: 'High', none: 'Not rated' };
const LEVEL_RANK = { none: -1, low: 0, medium: 1, high: 2 };

/* The 47 elementary threats (IT-Grundschutz Compendium) with the core values primarily
   affected, as listed in BSI Standard 200-3, Table 1. */
const BSI_THREATS = [
  [1, 'Fire', 'A'], [2, 'Unfavourable Climatic Conditions', 'IA'], [3, 'Water', 'IA'], [4, 'Pollution, Dust, Corrosion', 'IA'],
  [5, 'Natural Disasters', 'A'], [6, 'Catastrophes in the Vicinity', 'A'], [7, 'Major Events in the Vicinity', 'CIA'],
  [8, 'Failure or Disruption of the Power Supply', 'IA'], [9, 'Failure or Disruption of Communication Networks', 'IA'],
  [10, 'Failure or Disruption of Mains Supply', 'A'], [11, 'Failure or Disruption of Service Providers', 'CIA'],
  [12, 'Electromagnetic Interference', 'IA'], [13, 'Interception of Compromising Emissions', 'C'],
  [14, 'Interception of Information / Espionage', 'C'], [15, 'Eavesdropping', 'C'],
  [16, 'Theft of Devices, Storage Media and Documents', 'CA'], [17, 'Loss of Devices, Storage Media and Documents', 'CA'],
  [18, 'Bad Planning or Lack of Adaptation', 'CIA'], [19, 'Disclosure of Sensitive Information', 'C'],
  [20, 'Information or Products from an Unreliable Source', 'CIA'], [21, 'Manipulation of Hardware or Software', 'CIA'],
  [22, 'Manipulation of Information', 'I'], [23, 'Unauthorised Access to IT Systems', 'CI'],
  [24, 'Destruction of Devices or Storage Media', 'A'], [25, 'Failure of Devices or Systems', 'A'],
  [26, 'Malfunction of Devices or Systems', 'CIA'], [27, 'Lack of Resources', 'A'], [28, 'Software Vulnerabilities or Errors', 'CIA'],
  [29, 'Violation of Laws or Regulations', 'CIA'], [30, 'Unauthorised Use or Administration of Devices and Systems', 'CIA'],
  [31, 'Incorrect Use or Administration of Devices and Systems', 'CIA'], [32, 'Abuse of Authorisations', 'CIA'],
  [33, 'Absence of Personnel', 'A'], [34, 'Attack', 'CIA'], [35, 'Coercion, Extortion or Corruption', 'CIA'],
  [36, 'Identity Theft', 'CIA'], [37, 'Repudiation of Actions', 'CI'], [38, 'Abuse of Personal Data', 'C'], [39, 'Malware', 'CIA'],
  [40, 'Denial of Service', 'A'], [41, 'Sabotage', 'A'], [42, 'Social Engineering', 'CI'], [43, 'Replaying Messages', 'CI'],
  [44, 'Unauthorised Entry to Premises', 'CIA'], [45, 'Data Loss', 'A'], [46, 'Loss of Integrity of Sensitive Information', 'I'],
  [47, 'Harmful Side Effects of IT-Supported Attacks', 'CIA'],
].map(([n, name, cia]) => ({ n, name, cia: cia.split('') }));

/* Issue catalogue: every check the tool performs, grouped in three categories. */
const ISSUE_CATS = {
  format: { label: 'Format error', plural: 'Format errors', icon: 'format', desc: 'A cell does not follow the agreed writing convention.' },
  consistency: { label: 'Consistency error', plural: 'Consistency errors', icon: 'consistency', desc: 'Two places in the workbook that should agree do not.' },
  warning: { label: 'Warning', plural: 'Warnings', icon: 'warning', desc: 'Not wrong as such, but incomplete or worth a second look.' },
};
const ISSUE_TYPES = {
  F_STRUCT: ['format', 'Workbook structure', 'A sheet or column the tool expects could not be found. Check sheet and header names.'],
  F_BULLET: ['format', 'Mitigation line does not start with “- ”', 'Every mitigation item must be on its own line starting with a hyphen and a space.'],
  F_INTRO: ['format', 'Treatment cell starts with a mitigation item', 'The first line of “Risk treatment option” is expected to be an introductory sentence; the items start on line 2.'],
  F_EMPTY_ITEM: ['format', 'Mitigation line without text', 'The line contains a bullet or tag but no description.'],
  F_ID: ['format', 'Malformed ID', 'The ID does not follow the project naming pattern.'],
  F_MISSING_ID: ['format', 'Missing ID', 'A row has content but no ID.'],
  F_VALUE: ['format', 'Value not in the allowed list', 'The cell must contain one of the predefined values, spelled exactly.'],
  F_THREAT_NAME: ['format', 'Threat name does not start with “G 0.n”', 'The threat column must start with the elementary threat number followed by its name.'],
  F_ASSUMPTION_REF: ['format', 'Malformed assumption reference', 'Related assumptions must start with the assumption ID written as A.<number>.'],
  C_NOT_IN_GROUP: ['consistency', 'Mitigation item without identical line in any group’s Content', 'Every mitigation item of a “Risk treatment option” must appear, with identical text, in the Content of a Risk Mitigation Group. That is how items are linked to groups.'],
  C_RMI_UNKNOWN: ['consistency', 'Mitigation item not in “Risk mitigations individual”', 'Every mitigation item written in a “Risk treatment option” or in a group’s Content must exist, with identical text, in the sheet “Risk mitigations individual”, which holds the RMI IDs.'],
  C_RMI_GROUPS: ['consistency', '“Groups” / “Assigned” disagree with the group Contents', 'In “Risk mitigations individual”, “Groups” must list the IDs of the groups whose Content holds the item, and “Assigned” must say whether there is at least one.'],
  W_UNUSED_RMI: ['warning', 'Mitigation item not used', 'The item of “Risk mitigations individual” appears neither in a “Risk treatment option” nor in a group’s Content.'],
  C_NO_MATCH: ['consistency', 'Group content line without identical line in “Risk treatment option”', 'Every line in a group’s Content must be an exact copy of a mitigation line of the risk analysis.'],
  C_DUP_ID: ['consistency', 'Duplicate ID', 'IDs must be unique.'],
  C_INDEX: ['consistency', 'Risk index ≠ frequency × effects', 'The stored risk index does not match the product of the two category values.'],
  C_REDUCTION: ['consistency', 'Risk reduction value ≠ before − after', 'The stored reduction does not match the difference of the two risk indices.'],
  C_THREAT_MISMATCH: ['consistency', 'Threat ID and threat name disagree', 'The number in T.BSI.n and in G 0.n must be the same.'],
  C_ASSUMPTION_UNKNOWN: ['consistency', 'Reference to an unknown assumption', 'The assumption ID does not exist in “Architecture Assumptions”.'],
  C_LINKED_RISKS: ['consistency', '“Linked risks” disagrees with the risk analysis', 'The assumption sheet and the “Related assumptions” column of the risk analysis should mirror each other.'],
  W_MULTI_GROUP: ['warning', 'Mitigation item listed in more than one group', 'The same item text appears in the Content of several Risk Mitigation Groups.'],
  W_VARIANTS: ['warning', 'Same mitigation item written in slightly different ways', 'The lines differ only in case, spacing or punctuation. They are treated as one item.'],
  W_NO_ITEMS: ['warning', 'Treatment without mitigation items', 'The risk is to be mitigated but no individual mitigation item is listed.'],
  W_MISSING: ['warning', 'Missing value', 'A cell that is normally filled in is empty.'],
  W_AFTER_HIGHER: ['warning', 'Risk index is higher after treatment', 'The residual risk index exceeds the initial one.'],
  W_UNUSED_GROUP: ['warning', 'Group not used by any risk', 'None of the Content lines of this group appears with identical text in the risk analysis.'],
  W_UNUSED_ASSUMPTION: ['warning', 'Assumption not referenced by any risk', 'No risk lists this assumption under “Related assumptions”.'],
  W_EMPTY_GROUP: ['warning', 'Group without content', 'The Content cell of the group is empty.'],
  W_DUP_LINE: ['warning', 'Duplicate line in the same cell', 'The same mitigation item appears twice in one cell.'],
  W_SIMILAR_NAME: ['warning', 'Component names that look alike', 'Possibly the same component spelled in two ways.'],
  W_ASSUMPTION_TITLE: ['warning', 'Assumption title differs from the assumptions sheet', 'The text after the assumption ID does not match the title in “Architecture Assumptions”.'],
  W_THREAT_RANGE: ['warning', 'Threat number outside the BSI catalogue', 'Elementary threats are numbered G 0.1 to G 0.47.'],
  W_THREAT_NAME_VARIES: ['warning', 'Same threat ID with different names', 'Rows with the same Threat ID use different threat names.'],
  W_UNCACHED: ['warning', 'Formulas without stored results', 'The workbook was saved by a program that did not store formula results. Open and save it in Excel.'],
};

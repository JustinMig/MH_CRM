/** Saved underwriting chart references, not a live carrier feed or an approval engine.
 * Transcribed without interpolating or changing the existing M&M chart values.
 * Source: JustinMig/Mayer-insurance-crm, lib/build-charts.ts,
 * Git blob 28a46f501dd384fb6e8462503998f58be7775977 (copied 2026-09-18).
 * Each row begins with total height in inches; all following entries are pounds.
 */
export const BUILD_CHART_PROVENANCE = Object.freeze({
  repository: 'JustinMig/Mayer-insurance-crm',
  path: 'lib/build-charts.ts',
  blob: '28a46f501dd384fb6e8462503998f58be7775977',
  copiedOn: '2026-09-18',
  latestCarrierRevisionVerified: false
});

const charts = [
  {
    key: 'mutual-of-omaha', company: 'Mutual of Omaha',
    source: 'Mutual of Omaha underwriting guide, PDF page 28. DI Rider maximum excluded.',
    labels: ['TLE, IULE, Living Promise — minimum weight', 'TLE, IULE — maximum weight'],
    warnings: ['The maximum shown is for TLE/IULE, not Living Promise.'],
    rows: [
      [56,74,197],[57,77,202],[58,79,208],[59,82,214],[60,85,220],
      [61,88,226],[62,91,232],[63,94,238],[64,97,245],[65,100,251],
      [66,103,258],[67,106,265],[68,109,274],[69,112,282],[70,115,289],
      [71,119,298],[72,122,305],[73,126,313],[74,129,321],[75,133,329],
      [76,136,338],[77,140,347],[78,143,358],[79,147,367],[80,151,376],
      [81,154,385],[82,158,395]
    ]
  },
  {
    key: 'american-amicable', company: 'American Amicable',
    source: 'American Amicable Senior Choice guide, PDF page 13 (printed page 14).',
    labels: ['Immediate — maximum weight', 'Graded — upper-weight band', 'Return of premium — upper-weight band', 'Immediate — minimum weight', 'Return of premium — lower-weight band'],
    warnings: ['Bands are preserved exactly as listed in the saved chart. Do not infer eligibility for gaps between bands.'],
    referralHeights: [53,54,55],
    rows: [
      [53,'173','174-180','181-190','82','77-81'],
      [54,'180','182-188','189-198','84','79-83'],
      [55,'187','189-196','197-206','86','81-85'],
      [56,'197','198-204','205-214','88','83-87'],
      [57,'204','205-212','213-222','90','85-89'],
      [58,'211','212-220','221-230','92','87-91'],
      [59,'218','219-228','229-238','94','89-93'],
      [60,'225','226-236','237-246','96','91-95'],
      [61,'233','234-244','245-254','99','94-98'],
      [62,'241','242-252','253-262','101','96-100'],
      [63,'248','249-260','261-271','105','100-104'],
      [64,'256','257-268','269-280','107','102-106'],
      [65,'264','265-276','277-288','110','105-109'],
      [66,'273','274-285','286-297','112','107-111'],
      [67,'281','282-294','295-306','116','111-115'],
      [68,'289','290-303','304-316','119','114-118'],
      [69,'298','299-312','313-325','123','118-122'],
      [70,'307','308-321','322-335','126','121-125'],
      [71,'315','316-330','331-344','131','126-130'],
      [72,'324','325-339','340-354','135','130-134'],
      [73,'334','335-349','350-364','139','134-138'],
      [74,'343','344-359','360-374','142','137-141'],
      [75,'352','353-368','369-384','146','141-145'],
      [76,'361','362-378','379-394','149','144-148'],
      [77,'370','371-388','389-404','152','147-151'],
      [78,'379','380-398','399-414','156','151-155'],
      [79,'388','398-408','409-424','160','155-159'],
      [80,'397','398-418','419-434','164','159-163'],
      [81,'406','407-428','429-440','168','162-167']
    ]
  },
  {
    key: 'physicians-mutual', company: 'Physicians Mutual',
    source: 'Physicians Life Insurance Company Secure Essential Life (L780), Product & Underwriting Guidelines, revised 05/11/2026, PDF page 8.',
    labels: ['Secure Essential Life — minimum weight', 'Secure Essential Life — maximum weight'],
    rows: [
      [56,83,182],[57,86,189],[58,89,196],[59,92,203],[60,95,209],
      [61,98,217],[62,102,224],[63,105,231],[64,108,238],[65,112,246],
      [66,115,254],[67,119,261],[68,122,269],[69,126,277],[70,129,285],
      [71,133,294],[72,137,302],[73,141,310],[74,145,319],[75,149,328],
      [76,152,336],[77,157,345],[78,161,354],[79,165,364],[80,169,373],
      [81,173,382],[82,177,392],[83,182,401]
    ]
  },
  {
    key: 'corebridge-simplinow', company: 'Corebridge Financial — SimpliNow Legacy',
    source: 'Corebridge Financial SimpliNow Legacy Underwriting Guide, AGLC201453 REV0424, PDF page 8.',
    labels: ['Legacy (graded benefit) — minimum weight', 'Legacy (graded benefit) — maximum weight', 'Legacy Max (level benefit) — minimum weight', 'Legacy Max (level benefit) — maximum weight'],
    rows: [
      [56,74,203,79,189],[57,77,210,81,196],[58,79,217,84,203],
      [59,82,225,87,210],[60,85,232,90,217],[61,88,240,93,224],
      [62,91,248,96,232],[63,94,256,99,239],[64,97,265,103,247],
      [65,100,273,106,255],[66,103,281,109,263],[67,106,290,112,271],
      [68,109,299,116,279],[69,112,307,119,287],[70,116,316,123,296],
      [71,119,326,126,304],[72,122,335,130,313],[73,126,344,133,321],
      [74,129,354,137,330],[75,133,363,141,339],[76,136,373,145,348],
      [77,140,383,148,358],[78,144,393,152,367],[79,147,403,156,376],
      [80,151,413,160,386],[81,155,424,164,396],[82,159,434,168,406]
    ]
  }
];

const heightLabel = inches => `${Math.floor(inches / 12)}′ ${inches % 12}″`;
const findChart = company => typeof company === 'string'
  ? charts.find(chart => [chart.key, chart.company].some(name => name.toLowerCase() === company.trim().toLowerCase()))
  : null;

/** Return a fresh catalogue so one open window cannot mutate another lookup. */
export function listBuildCharts() {
  return charts.map(chart => ({
    company: chart.company,
    heights: chart.rows.map(row => ({ value: row[0], label: heightLabel(row[0]) }))
  }));
}

/** Only exact imported height rows are returned. No interpolation or invented eligibility. */
export function lookupBuildChart(criteria = {}) {
  if (!criteria || typeof criteria !== 'object') return null;
  const chart = findChart(criteria.company);
  const raw = criteria.heightInches;
  if (!chart || !['string', 'number'].includes(typeof raw)) return null;
  if (typeof raw === 'string' && !/^\d+$/.test(raw.trim())) return null;
  const height = Number(raw);
  if (!Number.isInteger(height)) return null;
  const row = chart.rows.find(value => value[0] === height);
  if (!row) return null;
  const warnings = [...(chart.warnings || [])];
  if (chart.referralHeights?.includes(height)) warnings.push('Refer to Home Office when using the mobile application decision engine, as marked in the source chart.');
  return {
    company: chart.company,
    heightInches: height,
    height: heightLabel(height),
    values: chart.labels.map((label, index) => ({ label, value: `${row[index + 1]} lb` })),
    source: chart.source,
    warnings,
    referenceOnly: true
  };
}

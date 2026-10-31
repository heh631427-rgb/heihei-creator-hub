/** Playback periods never come from publication dates. Creator lifetime totals
 * can additionally use the user's confirmed historical baseline once. */
const text = value => value == null ? '' : String(value).trim();
const key = (...parts) => parts.map(value => encodeURIComponent(text(value))).join('|');
const inactive = report => report?.active === false || ['dismissed', 'rejected', 'deleted', 'superseded'].includes(report?.status);
const unique = values => [...new Set(values.filter(Boolean))];

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(value)) || String(value).startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function bounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text(month))) return { start: '', end: '' };
  const date = new Date(`${month}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0);
  return { start: `${month}-01`, end: date.toISOString().slice(0, 10) };
}
export function parseVideoViewCount(value) {
  if (value == null || text(value) === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const match = text(value).replace(/\s+/g, '').match(/^([\d.,]+)([kmb])?$/i);
  if (!match) return null;
  let digits = match[1];
  if (digits.includes(',') && digits.includes('.')) digits = digits.lastIndexOf(',') > digits.lastIndexOf('.') ? digits.replace(/\./g, '').replace(',', '.') : digits.replace(/,/g, '');
  else if (digits.includes(',')) digits = /^\d{1,3}(,\d{3})+$/.test(digits) ? digits.replace(/,/g, '') : digits.replace(',', '.');
  else if (!match[2] && /^\d{1,3}(\.\d{3})+$/.test(digits)) digits = digits.replace(/\./g, '');
  const number = Number(digits) * ({ k: 1000, m: 1000000, b: 1000000000 }[match[2]?.toLowerCase()] || 1);
  return Number.isFinite(number) ? number : null;
}
function overlaps(a, b) { return a.start <= b.end && a.end >= b.start; }
function contains(a, b) { return a.start <= b.start && a.end >= b.end; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

/** Explicit view metadata wins. Existing confirmed sales periods are safe defaults;
 * publication cohorts, filenames and historical cutoff dates are never defaults. */
function viewPeriod(row, report, sourceKind) {
  const override = report.viewsPeriodOverride === true;
  const declaredKind = override ? report.viewsKind : row.viewsKind || report.viewsKind || '';
  if (sourceKind === 'baseline' || row.reportKind === 'historicalBaseline' || report.reportKind === 'historicalBaseline') return { kind: 'historical' };
  if (declaredKind === 'lifetime_snapshot') return { kind: 'historical' };
  if (declaredKind === 'unconfirmed') return { kind: 'unconfirmed' };
  const explicitStart = text(override ? report.viewsPeriodStart : row.viewsPeriodStart || report.viewsPeriodStart);
  const explicitEnd = text(override ? report.viewsPeriodEnd : row.viewsPeriodEnd || report.viewsPeriodEnd);
  const hasExplicit = declaredKind === 'period' || !!explicitStart || !!explicitEnd;
  let start = explicitStart, end = explicitEnd;
  if (!start && !end && !['publication', 'pending'].includes(sourceKind) && !row.pendingPeriod) {
    const month = bounds(row.reportMonth || row.snapshotPeriod || row.month || report.reportMonth || report.month);
    start = text(row.periodStart || row.rangeStart || report.periodStart || report.rangeStart || month.start);
    end = text(row.periodEnd || row.rangeEnd || report.periodEnd || report.rangeEnd || month.end);
  }
  return validDate(start) && validDate(end) && start <= end ? { kind: 'period', start, end } : { kind: 'unconfirmed', invalid: hasExplicit };
}

/** Only accepted baseline rows establish the historical starting balance. A
 * losing sales row can still contain the highest playback observation, so keep
 * sourceDuplicateRows; never borrow all-source maxima or publication reports. */
function historicalViewsBaseline(state, resolveRecord) {
  const reports = (state.videoBaselines || []).filter(report => !inactive(report) && !['archived', 'pending', 'period_unconfirmed', 'unconfirmed'].includes(report.status));
  const byVideo = new Map(), presence = new Map(), cutoffs = new Set(), issues = [];
  let invalidCutoff = false;
  for (const report of reports) {
    const cutoff = text(report.cutoffDate), reportId = text(report.id);
    if (!validDate(cutoff)) {
      invalidCutoff = true;
      issues.push({ type: 'videoViewsBaselineCutoffInvalid', reportId, message: '历史播放底表缺少有效截止日期，未将其播放量加入累计；请核对底表截止日期。' });
      continue;
    }
    cutoffs.add(cutoff);
    for (const raw of [...(report.records || []), ...(report.sourceDuplicateRows || [])]) {
      if (!raw || typeof raw !== 'object' || inactive(raw)) continue;
      const row = resolveRecord(raw), videoId = text(row.videoId) || text(row.url).match(/\/video\/(\d+)/)?.[1];
      if (!videoId) continue;
      const creatorId = text(row.creatorId).replace(/^@/, '').toLowerCase();
      const productIds = unique([...(Array.isArray(row.productIds) ? row.productIds.map(text) : []), text(row.productId)]);
      const views = parseVideoViewCount(row.views), item = { videoId, creatorId, productIds, views, cutoff, reportId, source: text(row.sourceFile || report.fileName || report.sourceFile) };
      if (!presence.has(videoId) || !presence.get(videoId).creatorId && creatorId) presence.set(videoId, item);
      if (views === null) continue;
      const previous = byVideo.get(videoId);
      if (!previous) byVideo.set(videoId, item);
      else {
        const products = unique([...previous.productIds, ...productIds]);
        if (views > previous.views) byVideo.set(videoId, { ...item, creatorId: creatorId || previous.creatorId, productIds: products });
        else { previous.productIds = products; if (!previous.creatorId && creatorId) previous.creatorId = creatorId; }
      }
    }
  }
  const sortedCutoffs = [...cutoffs].sort(), cutoff = sortedCutoffs.at(-1) || '', cutoffConflict = sortedCutoffs.length > 1;
  if (cutoffConflict) issues.push({ type: 'videoViewsBaselineCutoffConflict', cutoffs: sortedCutoffs, message: '存在多个有效历史底表且截止日期不同；暂按逐视频最高历史播放和最晚截止日去重，累计覆盖范围待核对。' });
  return { records: [...byVideo.values()], missingRecords: [...presence.values()].filter(row => !byVideo.has(row.videoId)), cutoff, cutoffs: sortedCutoffs, cutoffConflict, invalidCutoff, issues };
}

/** Pure derived ledger. Raw rows stay in their existing reports; no duplicated
 * persistent collection is needed for the already-large workspace snapshot. */
export function deriveVideoViews(state, options = {}) {
  const resolveRecord = options.resolveRecord || (row => row);
  const salesOnly = options.sourceScope === 'sales';
  const includeHistoricalBaseline = salesOnly && options.includeHistoricalBaseline === true;
  const baseline = includeHistoricalBaseline ? historicalViewsBaseline(state, resolveRecord) : null;
  const exact = new Map(), unknown = [], historical = [], issues = [];
  const baselineCoveredRecords = [], baselineOverlapRecords = [];
  if (baseline) issues.push(...baseline.issues);
  const invalidReports = new Set(), creatorSources = new Map();
  const addRows = (rows, report, sourceKind, sourceId) => {
    // Creator lifetime playback follows confirmed sales-report periods. The
    // ordinary ledger still combines publication and sales observations for
    // monthly promotion; applying this filter before deduplication prevents a
    // larger publication value from replacing the actual sales observation.
    if (salesOnly && (['publication', 'pending', 'baseline'].includes(sourceKind) || report.reportPurpose === 'publication' || report.publicationOnly || report.status === 'publication_only' || ['pending', 'period_unconfirmed'].includes(report.status))) return;
    for (const raw of rows || []) {
      if (!raw || typeof raw !== 'object' || inactive(raw)) continue;
      if (salesOnly && (raw.reportPurpose === 'publication' || raw.publicationOnly || raw.pendingPeriod || raw.periodStatus === 'unconfirmed')) continue;
      const row = resolveRecord(raw), videoId = text(row.videoId) || text(row.url).match(/\/video\/(\d+)/)?.[1];
      const views = parseVideoViewCount(row.views); if (!videoId || views === null) continue;
      const creatorId = text(row.creatorId).replace(/^@/, '').toLowerCase();
      if (creatorId) { if (!creatorSources.has(videoId)) creatorSources.set(videoId, new Set()); creatorSources.get(videoId).add(creatorId); }
      const productIds = unique([...(Array.isArray(row.productIds) ? row.productIds.map(text) : []), text(row.productId)]);
      const source = text(row.sourceFile || report.fileName || report.sourceFile), reportId = text(report.id) || sourceId || key(source, row.sourceSheet);
      const period = viewPeriod(row, report, sourceKind);
      const item = { videoId, creatorId, productIds, views, source, reportId, sourceKind, ...period };
      if (period.kind !== 'period') {
        (period.kind === 'historical' ? historical : unknown).push(item);
        if (period.invalid && !invalidReports.has(reportId)) {
          invalidReports.add(reportId);
          issues.push({ type: 'missingVideoViewsPeriod', reportId, message: '这份视频报表的播放统计期间尚未完整确认，播放值保留供核对，未加入月度或累计播放量。' });
        }
        continue;
      }
      // Filter against the accepted historical balance before resolving period
      // containment, so a cross-cutoff report cannot hide a valid later month.
      if (baseline?.cutoff && period.start <= baseline.cutoff) {
        if (period.end <= baseline.cutoff) baselineCoveredRecords.push(item);
        else {
          baselineOverlapRecords.push(item);
          issues.push({ type: 'videoViewsBaselineCutoffOverlap', videoId, creatorId, reportId, periodStart: period.start, periodEnd: period.end, cutoffDate: baseline.cutoff, message: '播放统计期间跨越历史底表截止日，无法从区间总量拆出新增部分，暂未累加；请提供截止日之后的不重叠期间。' });
        }
        continue;
      }
      const identity = key(videoId, period.start, period.end), previous = exact.get(identity);
      if (!previous) exact.set(identity, { ...item, id: identity, sourceValues: new Set([views]), sources: new Set([source]), reportIds: new Set([reportId]) });
      else {
        previous.productIds = unique([...previous.productIds, ...productIds]);
        previous.sourceValues.add(views); previous.sources.add(source); previous.reportIds.add(reportId);
        if (views > previous.views || !previous.creatorId && creatorId) {
          previous.views = Math.max(previous.views, views); previous.creatorId = creatorId || previous.creatorId; previous.source = source || previous.source;
        }
      }
    }
  };
  addRows(state.videos, {}, 'sales', 'active-sales');
  addRows(state.videoViewsArchives, {}, 'view_archive', 'independent-view-period-archive');
  for (const report of state.videoReportArchives || []) if (!inactive(report) && !report.viewsSuperseded && !text(report.reason).startsWith('统计周期已确认：旧报告保留供核对')) addRows([...(report.records || []), ...(report.sourceDuplicateRows || [])], report, report.reportKind === 'historicalBaseline' ? 'baseline' : 'archive', report.id);
  for (const report of state.videoBaselines || []) if (!inactive(report) && report.status !== 'archived') addRows(report.records, report, 'baseline', report.id);
  for (const report of state.pendingVideoImports || []) {
    if (inactive(report) || ['confirmed', 'activated', 'archived'].includes(report.status)) continue;
    const publication = report.reportPurpose === 'publication' || report.publicationOnly || report.status === 'publication_only';
    addRows(report.records, report, publication ? 'publication' : 'pending', report.id);
  }
  for (const [videoId, creators] of creatorSources) if (creators.size > 1) issues.push({ type: 'videoViewsCreatorConflict', videoId, creatorIds: [...creators], message: '同一视频在不同来源中对应不同达人账号，播放量按各确认期间的来源身份保留，请核对账号；未改动原达人档案。' });
  const observations = [];
  for (const item of exact.values()) {
    if (item.sourceValues.size > 1) issues.push({ type: 'videoViewsValueConflict', videoId: item.videoId, creatorId: item.creatorId, periodStart: item.start, periodEnd: item.end, values: [...item.sourceValues].sort((a, b) => a - b), selectedViews: item.views, message: '同一视频、同一播放期间出现不同播放值，已取较大值一次，请核对来源；未将两份报表相加。' });
    const { sourceValues, sources, reportIds, ...record } = item;
    observations.push({ ...record, sources: [...sources].filter(Boolean), reportIds: [...reportIds].filter(Boolean) });
  }
  const resolved = resolvePeriods(observations);
  issues.push(...resolved.issues);
  const months = unique(observations.filter(row => row.start.slice(0, 7) === row.end.slice(0, 7)).map(row => row.start.slice(0, 7)));
  const monthResolutions = new Map();
  for (const month of months) { const resolution = resolvePeriods(observations.filter(row => row.start.slice(0, 7) === month && row.end.slice(0, 7) === month)); monthResolutions.set(month, resolution); issues.push(...resolution.issues.map(issue => ({ ...issue, month }))); }
  const uniqueIssues = [...new Map(issues.map(issue => [key(issue.type, issue.videoId, issue.reportId, JSON.stringify(issue.periods || [issue.periodStart, issue.periodEnd])), issue])).values()];
  return { ...resolved, observations, unknown, historical, monthResolutions, issues: uniqueIssues, sourceScope: salesOnly ? 'sales' : 'all', ...(baseline ? { includeHistoricalBaseline, baselineRecords: baseline.records, baselineMissingRecords: baseline.missingRecords, baselineCutoff: baseline.cutoff, baselineCutoffs: baseline.cutoffs, baselineCutoffConflict: baseline.cutoffConflict, baselineInvalidCutoff: baseline.invalidCutoff, baselineCoveredRecords, baselineOverlapRecords } : {}) };
}

/** Resolve coverage within the requested scope. Monthly detail remains usable
 * even when a later cross-month report covers it for cumulative totals. */
function resolvePeriods(observations) {
  const byVideo = new Map(), issues = [];
  for (const input of observations) { const item = { ...input, productIds: [...input.productIds] }; if (!byVideo.has(item.videoId)) byVideo.set(item.videoId, []); byVideo.get(item.videoId).push(item); }
  const records = [], blockedRecords = [];
  for (const [videoId, group] of byVideo) {
    const maximal = group.filter(item => !group.some(other => other !== item && contains(other, item) && (other.start !== item.start || other.end !== item.end)));
    for (const item of maximal) {
      for (const child of group) if (child !== item && contains(item, child)) {
        item.productIds = unique([...item.productIds, ...child.productIds]);
        if (child.views > item.views) issues.push({ type: 'videoViewsContainmentConflict', videoId, creatorId: item.creatorId, periodStart: item.start, periodEnd: item.end, message: '覆盖范围更长的播放报表数值小于被覆盖短期间，已使用长期间一次，请核对来源。' });
      }
    }
    const blocked = new Set();
    for (let i = 0; i < maximal.length; i++) for (let j = i + 1; j < maximal.length; j++) if (overlaps(maximal[i], maximal[j])) { blocked.add(maximal[i]); blocked.add(maximal[j]); }
    if (blocked.size) issues.push({ type: 'overlappingVideoViewsPeriod', videoId, creatorId: maximal[0].creatorId, periods: [...blocked].map(item => ({ start: item.start, end: item.end })), message: '同一视频的播放统计期间部分重叠，无法从区间总量拆分，重叠记录暂不计入播放汇总；请补充完整期间报表或不重叠数据。' });
    for (const item of maximal) (blocked.has(item) ? blockedRecords : records).push(item);
  }
  records.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.videoId.localeCompare(b.videoId));
  return { records, blockedRecords, issues };
}

function matches(row, options) {
  if (options.creatorId && row.creatorId !== options.creatorId) return false;
  if (options.productId && !row.productIds.includes(options.productId)) return false;
  if (options.videoIds && !options.videoIds.has(row.videoId)) return false;
  return true;
}
function fullMonthCovered(rows, month) {
  const target = bounds(month), byVideo = new Map();
  for (const row of rows) { if (!byVideo.has(row.videoId)) byVideo.set(row.videoId, []); byVideo.get(row.videoId).push(row); }
  for (const group of byVideo.values()) {
    let next = target.start;
    for (const row of group.sort((a, b) => a.start.localeCompare(b.start))) {
      if (row.start > next) return false;
      const date = new Date(`${row.end}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + 1); next = date.toISOString().slice(0, 10);
    }
    if (next <= target.end) return false;
  }
  return byVideo.size > 0;
}

/** Missing is null; an explicit zero remains zero. The creator-only ledger may
 * add its accepted historical balance, without assigning it to a calendar month. */
export function summarizeVideoViews(ledger, options = {}) {
  const month = text(options.month), target = bounds(month), relevant = ledger.records.filter(row => matches(row, options));
  const scopedObservations = ledger.observations.filter(row => !month || row.start.slice(0, 7) === month && row.end.slice(0, 7) === month);
  const observations = scopedObservations.filter(row => matches(row, options));
  const monthly = month ? ledger.monthResolutions?.get(month) || resolvePeriods(scopedObservations) : null;
  const records = monthly ? monthly.records.filter(row => matches(row, options)) : relevant;
  const monthlyVideos = new Set(records.map(row => row.videoId));
  const crossMonth = month ? relevant.filter(row => row.start.slice(0, 7) !== row.end.slice(0, 7) && overlaps(row, target) && !monthlyVideos.has(row.videoId)) : [];
  const blocked = (monthly ? monthly.blockedRecords : ledger.blockedRecords).filter(row => matches(row, options));
  const unknown = ledger.unknown.filter(row => matches(row, options)), historical = ledger.historical.filter(row => matches(row, options));
  const periods = [...new Map(records.map(row => [key(row.start, row.end), { start: row.start, end: row.end }])).values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const includeBaseline = ledger.includeHistoricalBaseline === true && !month;
  const baselineRecords = includeBaseline ? ledger.baselineRecords.filter(row => matches(row, options)) : [];
  const baselineMissingVideoCount = includeBaseline ? ledger.baselineMissingRecords.filter(row => matches(row, options)).length : 0;
  const baselineOverlapVideoCount = includeBaseline ? unique(ledger.baselineOverlapRecords.filter(row => matches(row, options)).map(row => row.videoId)).length : 0;
  const baselineCoveredRecordCount = includeBaseline ? ledger.baselineCoveredRecords.filter(row => matches(row, options)).length : 0;
  const baselineCutoff = includeBaseline && !ledger.baselineCutoffConflict ? ledger.baselineCutoff : '';
  const baselineValue = baselineRecords.length ? baselineRecords.reduce((total, row) => total + row.views, 0) : null;
  const periodValue = records.length ? records.reduce((total, row) => total + row.views, 0) : null;
  const value = baselineValue === null && periodValue === null ? null : (baselineValue ?? 0) + (periodValue ?? 0);
  const overlapVideoCount = unique(blocked.map(row => row.videoId)).length, unconfirmedReportCount = unique(unknown.map(row => row.reportId)).length;
  const baselineNeedsReview = includeBaseline && (baselineOverlapVideoCount || ledger.baselineCutoffConflict || ledger.baselineInvalidCutoff);
  const status = overlapVideoCount || baselineNeedsReview ? 'needs_review' : value === null ? (unknown.length || crossMonth.length ? 'unconfirmed' : 'unavailable') : month ? (fullMonthCovered(records, month) && !crossMonth.length ? 'complete' : 'partial') : baselineMissingVideoCount ? 'partial' : 'confirmed';
  const coverage = [];
  if (baselineCutoff) coverage.push(baselineValue !== null ? `历史播放底数截至 ${baselineCutoff}（逐视频最大值求和）` : `历史底表截止 ${baselineCutoff}；该达人暂无可用历史播放底数`);
  else if (includeBaseline && ledger.baselineCutoffConflict) coverage.push(`历史底表截止日期为 ${ledger.baselineCutoffs.join('、')}；暂按逐视频最高播放和最晚截止日去重`);
  if (periods.length) coverage.push(`已确认 ${periods.slice(0, 5).map(period => `${period.start} 至 ${period.end}`).join('；')}${periods.length > 5 ? `等 ${periods.length} 个期间` : ''}`);
  else coverage.push(month ? '暂无可确认到本月的播放量' : baselineValue !== null ? '暂无新增已确认播放期间' : '暂无已确认播放期间');
  if (baselineCoveredRecordCount) coverage.push('截止日及以前的已含期间未重复累加');
  if (baselineOverlapVideoCount) coverage.push(`${baselineOverlapVideoCount} 条视频的统计期间跨越历史底表截止日，待核对（未拆分累加）`);
  if (baselineMissingVideoCount) coverage.push(`${baselineMissingVideoCount} 条历史视频缺少播放量，未按 0 填补`);
  if (includeBaseline && ledger.baselineCutoffConflict) coverage.push('多个历史底表截止日不同，累计覆盖范围待核对');
  if (includeBaseline && ledger.baselineInvalidCutoff) coverage.push('部分历史底表截止日期无效，未计入其历史播放底数');
  if (month && value !== null && !fullMonthCovered(records, month)) coverage.push('仅为已覆盖期间，非完整月播放量');
  if (crossMonth.length) coverage.push(`${unique(crossMonth.map(row => row.videoId)).length} 条跨月视频期间未分摊到月份`);
  if (overlapVideoCount) coverage.push(`${overlapVideoCount} 条视频有部分重叠期间待核对`);
  if (unconfirmedReportCount) coverage.push(`${unconfirmedReportCount} 份报表的播放期间待确认`);
  if (historical.length) coverage.push('期间不明的历史播放参考未加入累计');
  return { value, available: value !== null, records, observations, periods, status, coverage: coverage.join('；'), source: includeBaseline && ledger.baselineCutoff ? '历史播放底数 + 截止日后出单视频报表的已确认播放期间（同视频同期间去重）' : ledger.sourceScope === 'sales' ? '出单视频报表的已确认播放统计期间累计（同视频同期间去重）' : '按已确认播放统计期间汇总（同视频同期间去重）', overlapVideoCount, unconfirmedReportCount, crossMonthVideoCount: unique(crossMonth.map(row => row.videoId)).length, ...(includeBaseline ? { baselineValue, periodValue, baselineCutoff, baselineMissingVideoCount, baselineOverlapVideoCount } : {}) };
}

/** Add or correct only a retained publication report's view metadata. Its raw
 * rows, sales, samples and creator profiles stay untouched; repeated saves are
 * idempotent and do not require re-uploading the duplicate source file. */
export function confirmVideoReportViewsPeriod(state, reportId, options = {}) {
  const report = (state.pendingVideoImports || []).find(item => item.id === reportId);
  if (!report || inactive(report)) fail('VIEW_REPORT_NOT_AVAILABLE', '未找到可更新统计期间的发布视频报表，请刷新后重试。');
  if (!(report.reportPurpose === 'publication' || report.publicationOnly || report.status === 'publication_only')) fail('VIEW_REPORT_NOT_PUBLICATION', '此入口用于补充发布视频报表的月度推广统计期间，不会改动达人累计的销量期间。');
  const start = text(options.viewsPeriodStart), end = text(options.viewsPeriodEnd);
  if (!validDate(start) || !validDate(end) || start > end) fail('INVALID_VIEWS_PERIOD', '请填写发布视频报表的有效统计开始和结束日期，不能用视频发布日期代替。');
  if (report.viewsKind === 'period' && report.viewsPeriodStart === start && report.viewsPeriodEnd === end && report.viewsPeriodOverride === true) return { state, summary: { updated: 0, unchanged: 1, warnings: [] } };
  const at = options.at || new Date().toISOString();
  const nextReport = { ...report, viewsKind: 'period', viewsPeriodStart: start, viewsPeriodEnd: end, viewsPeriodConfirmedAt: at, viewsPeriodOverride: true };
  const next = { ...state, pendingVideoImports: state.pendingVideoImports.map(item => item.id === reportId ? nextReport : item), imports: [...(state.imports || []), { id: key('confirmed-view-period', reportId, start, end, at), type: 'videoViews', fileName: report.fileName || '', sheetName: report.sheetName || '', reportId, at, viewsKind: 'period', viewsPeriodStart: start, viewsPeriodEnd: end, updated: 1 }] };
  const viewLedger = deriveVideoViews(next), affected = new Set((report.records || []).map(row => text(row.videoId)));
  const warnings = viewLedger.issues.filter(issue => affected.has(issue.videoId) || issue.reportId === reportId).map(issue => issue.message);
  return { state: next, summary: { updated: 1, unchanged: 0, viewsPeriodStart: start, viewsPeriodEnd: end, warnings: unique(warnings) } };
}

/** Validate compact report-level metadata before a publication import. */
export function publicationViewsMetadata(context = {}) {
  const kind = context.viewsKind || (context.viewsPeriodStart || context.viewsPeriodEnd ? 'period' : 'unconfirmed');
  if (kind !== 'period') return { viewsKind: kind === 'lifetime_snapshot' ? kind : 'unconfirmed' };
  const start = text(context.viewsPeriodStart), end = text(context.viewsPeriodEnd);
  if (!validDate(start) || !validDate(end) || start > end) fail('INVALID_VIEWS_PERIOD', '发布视频报表的月度推广需要有效的统计起止日期。');
  return { viewsKind: 'period', viewsPeriodStart: start, viewsPeriodEnd: end };
}

/** Sales rows may be replaced while their separately chosen playback intervals
 * remain useful. Preserve only those removed intervals, using compact records;
 * never retain an old higher value for the exact period being corrected. */
export function preserveReplacedVideoViews(previousState, nextState, incomingRows = []) {
  const interval = row => viewPeriod(row, {}, 'sales');
  const identity = (row, period) => key(row.videoId, period.start, period.end);
  const incomingKeys = new Set(), incomingByVideo = new Map(), remainingKeys = new Set(), remainingValues = new Map();
  for (const row of incomingRows) {
    const period = interval(row); if (period.kind !== 'period' || parseVideoViewCount(row.views) === null) continue;
    incomingKeys.add(identity(row, period)); if (!incomingByVideo.has(row.videoId)) incomingByVideo.set(row.videoId, []); incomingByVideo.get(row.videoId).push(period);
  }
  for (const row of nextState.videos || []) { const period = interval(row); if (period.kind === 'period') { const id = identity(row, period), views = parseVideoViewCount(row.views); remainingKeys.add(id); if (views !== null) remainingValues.set(id, Math.max(remainingValues.get(id) ?? 0, views)); } }
  const prior = previousState.videoViewsArchives || [], archive = new Map();
  for (const row of prior) { const period = interval(row); if (period.kind === 'period' && !incomingKeys.has(identity(row, period))) archive.set(key(identity(row, period), row.productId || '', row.creatorId || ''), row); }
  const preserve = (row, period, value) => {
    const compact = { videoId: row.videoId, creatorId: row.creatorId || '', productId: row.productId || '', views: value, viewsKind: 'period', viewsPeriodStart: period.start, viewsPeriodEnd: period.end };
    for (const field of ['sourceFile', 'sourceSheet', 'skuId', 'sku']) if (row[field]) compact[field] = row[field];
    const recordKey = key(identity(row, period), compact.productId, compact.creatorId), existing = archive.get(recordKey);
    if (!existing || parseVideoViewCount(existing.views) < value) archive.set(recordKey, compact);
  };
  for (const row of previousState.videos || []) {
    const period = interval(row), value = parseVideoViewCount(row.views);
    if (period.kind !== 'period' || value === null || remainingKeys.has(identity(row, period)) || !incomingByVideo.has(row.videoId)) continue;
    preserve(row, period, value);
  }
  // A sales duplicate winner can have fewer views than another row in the same
  // source. Retain only that discarded view observation, not its sales or raw row.
  for (const row of incomingRows) { const period = interval(row), value = parseVideoViewCount(row.views); if (period.kind === 'period' && value !== null && remainingValues.has(identity(row, period)) && value > remainingValues.get(identity(row, period))) preserve(row, period, value); }
  if (!prior.length && !archive.size) return nextState;
  return { ...nextState, videoViewsArchives: [...archive.values()] };
}

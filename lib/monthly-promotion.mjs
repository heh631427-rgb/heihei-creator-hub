/** Publication reports are a separate monthly promotion view. Their observations
 * never become creator lifetime sales, GMV, or confirmed playback increments. */
const text = value => value == null ? '' : String(value).trim();
const unique = values => [...new Set(values.filter(Boolean))];
const key = (...parts) => parts.map(value => encodeURIComponent(text(value))).join('|');
const inactive = report => report?.active === false || ['dismissed', 'rejected', 'deleted', 'superseded'].includes(report?.status);
const monthValid = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value));
function dateValid(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(value))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}
function monthBounds(month) { const [year, number] = month.split('-').map(Number); return { start: `${month}-01`, end: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) }; }
const overlaps = (a, b) => a.start <= b.end && a.end >= b.start;
const contains = (a, b) => a.start <= b.start && a.end >= b.end;
function optionalNumber(value, parseNumber) { return value == null || text(value) === '' || !/[0-9]/.test(text(value)) ? null : parseNumber(value); }
function wholeMonth(periods, month) {
  const target = monthBounds(month); let next = target.start;
  for (const period of [...periods].sort((a, b) => a.start.localeCompare(b.start))) {
    if (period.start > next) return false;
    const end = new Date(`${period.end}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1); next = end.toISOString().slice(0, 10);
  }
  return periods.length > 0 && next > target.end;
}

/** A confirmed report month comes from explicit statistics-period metadata,
 * never from a filename or a video's publication date. Unknown periods retain
 * a clearly labelled publication-cohort reference instead. */
export function deriveMonthlyPublicationPerformance(state, options = {}) {
  const startMonth = options.startMonth || '2026-09', resolveRecord = options.resolveRecord || (row => row), parseDate = options.parseDate || (value => text(value).slice(0, 10)), parseNumber = options.parseNumber || Number, parseViews = options.parseViews || Number;
  const publicationDates = options.publicationDates || new Map(), candidates = new Map(), references = new Map(), issues = [];
  const reports = [
    ...(state.videoReportArchives || []).filter(report => !inactive(report)),
    ...(state.pendingVideoImports || []).filter(report => !inactive(report) && !['confirmed', 'activated', 'archived'].includes(report.status)),
  ].filter(report => report.promotionReportPurpose === 'publication' || report.reportPurpose === 'publication' || report.publicationOnly || report.status === 'publication_only');
  for (const [order, report] of reports.entries()) {
    const dedicated = report.promotionReportPurpose === 'publication';
    const start = text(report.promotionPeriodStart || report.viewsPeriodStart || (dedicated ? report.periodStart : '')), end = text(report.promotionPeriodEnd || report.viewsPeriodEnd || (dedicated ? report.periodEnd : ''));
    const explicitMonth = text(report.promotionReportMonth), periodAllowed = dedicated || !['unconfirmed', 'lifetime_snapshot'].includes(report.viewsKind), validRange = periodAllowed && dateValid(start) && dateValid(end) && start <= end, validPeriod = validRange && start.slice(0, 7) === end.slice(0, 7);
    const month = validPeriod && (!explicitMonth || explicitMonth === start.slice(0, 7)) ? start.slice(0, 7) : '';
    const id = text(report.id) || key(report.sourceHash, report.fileName, order), stamp = text(report.promotionUpdatedAt || report.viewsPeriodConfirmedAt || report.classifiedAt || report.importedAt || report.archivedAt || report.confirmedAt);
    const rows = new Map();
    for (const raw of report.records || []) {
      const row = resolveRecord(raw), videoId = text(row.videoId) || text(row.url).match(/\/video\/(\d+)/)?.[1]; if (!videoId) continue;
      const postDate = publicationDates.get(videoId) || parseDate(row.postDate), rowKey = key(videoId, row.productId || 'unmapped');
      const candidate = { ...row, videoId, postDate, promotionReportId: id, promotionObservationStart: month ? start : '', promotionObservationEnd: month ? end : '' };
      const previous = rows.get(rowKey);
      if (!previous) rows.set(rowKey, candidate);
      else {
        const winner = parseNumber(candidate.itemsSold) > parseNumber(previous.itemsSold) ? candidate : previous;
        const views = [parseViews(candidate.views), parseViews(previous.views)].filter(value => value != null && Number.isFinite(value));
        rows.set(rowKey, { ...winner, ...(views.length ? { views: Math.max(...views) } : {}) });
      }
    }
    if (month && month >= startMonth) {
      // An explicit monthly publication report may contain rows with a missing
      // post date. Their period performance remains usable, but they do not
      // invent a dated publication count. Known out-of-month posts are excluded.
      const selectedRows = [...rows.values()].filter(row => !row.postDate || row.postDate.startsWith(month));
      const excluded = rows.size - selectedRows.length;
      if (excluded) issues.push({ type: 'publicationReportOutsideMonth', reportId: id, month, count: excluded, message: `${excluded} 条视频的发布日期不在发布报表月份，未计入该月推广表现。` });
      if (!candidates.has(month)) candidates.set(month, []);
      candidates.get(month).push({ id, start, end, stamp, order, rows: selectedRows, fileName: text(report.fileName || report.sourceFile), report });
    } else {
      for (const row of rows.values()) {
        const cohort = text(row.postDate).slice(0, 7); if (!monthValid(cohort) || cohort < startMonth) continue;
        if (!references.has(cohort)) references.set(cohort, []);
        references.get(cohort).push({ ...row, promotionObservationStart: '', promotionObservationEnd: '', promotionReferenceStamp: stamp, promotionCrossMonthPeriod: validRange && !validPeriod ? { start, end } : null, promotionSourceFile: text(report.fileName || row.sourceFile) });
      }
    }
  }
  const byMonth = new Map();
  for (const month of unique([...candidates.keys(), ...references.keys()])) {
    const groups = candidates.get(month) || [];
    if (groups.length) {
      const exact = new Map();
      for (const group of [...groups].sort((a, b) => b.stamp.localeCompare(a.stamp) || b.order - a.order)) { const identity = key(group.start, group.end); if (!exact.has(identity)) exact.set(identity, group); }
      const snapshots = [...exact.values()], maximal = snapshots.filter(group => !snapshots.some(other => other !== group && contains(other, group) && (other.start !== group.start || other.end !== group.end)));
      const blocked = new Set();
      for (let i = 0; i < maximal.length; i++) for (let j = i + 1; j < maximal.length; j++) if (overlaps(maximal[i], maximal[j])) { blocked.add(maximal[i]); blocked.add(maximal[j]); }
      if (blocked.size) issues.push({ type: 'overlappingPublicationReports', month, reportIds: [...blocked].map(group => group.id), message: '发布视频报表的统计期间部分重叠；重叠部分暂不相加，请使用完整月报或不重叠期间。' });
      const accepted = maximal.filter(group => !blocked.has(group)), periods = accepted.map(({ start, end }) => ({ start, end })), status = blocked.size ? 'needs_review' : wholeMonth(periods, month) ? 'complete' : 'partial';
      byMonth.set(month, { month, mode: 'publication-period', rows: accepted.flatMap(group => group.rows), reportIds: accepted.map(group => group.id), periods, available: accepted.length > 0, status, source: `发布视频报表（${month}）`, coverage: status === 'needs_review' ? '统计期间重叠，需核对；未把重叠报表相加。' : `仅统计${month}发布的视频；统计期间 ${periods.map(period => `${period.start} 至 ${period.end}`).join('；')}${status === 'partial' ? '，尚未覆盖完整月份' : ''}。` });
    } else {
      const selected = new Map();
      for (const row of references.get(month) || []) {
        const identity = key(row.videoId, row.productId || 'unmapped'), previous = selected.get(identity);
        if (!previous) selected.set(identity, row);
        else { const winner = parseNumber(row.itemsSold) > parseNumber(previous.itemsSold) ? row : previous; const views = [parseViews(row.views), parseViews(previous.views)].filter(value => value != null && Number.isFinite(value)); selected.set(identity, { ...winner, ...(views.length ? { views: Math.max(...views) } : {}) }); }
      }
      const rows = [...selected.values()], crossMonth = rows.length > 0 && rows.every(row => row.promotionCrossMonthPeriod), periods = [...new Map(rows.filter(row => row.promotionCrossMonthPeriod).map(row => [key(row.promotionCrossMonthPeriod.start, row.promotionCrossMonthPeriod.end), row.promotionCrossMonthPeriod])).values()];
      byMonth.set(month, { month, mode: crossMonth ? 'publication-cross-month' : 'publication-unconfirmed', rows, reportIds: unique(rows.map(row => row.promotionReportId)), periods, available: true, status: crossMonth ? 'cross_month_reference' : 'unconfirmed', source: crossMonth ? '跨月发布报表参考（未按月拆分）' : '发布报表参考（统计期间待确认）', coverage: crossMonth ? `报表统计期间 ${periods.map(period => `${period.start} 至 ${period.end}`).join('；')}。按视频发布日期归组展示参考，没有把跨月总量拆分为当月实际出单或播放。` : '按视频发布日期归组的报表观察值；尚未确认统计期间，不代表当月实际出单或播放。重复视频与 PID 不叠加。' });
    }
  }
  return { byMonth, issues };
}

export function summarizePublicationPerformance(entry, options = {}) {
  if (!entry) return { itemsSold: null, views: null, available: false, viewsAvailable: false, rows: [], videoCount: 0, missingPostDateCount: 0 };
  const parseNumber = options.parseNumber || Number, parseViews = options.parseViews || Number, rows = options.productId ? entry.rows.filter(row => row.productId === options.productId) : entry.rows;
  const eligibleSales = rows.filter(row => row.productId), amounts = eligibleSales.map(row => optionalNumber(row.itemsSold, parseNumber)).filter(value => value !== null), knownEmpty = entry.mode === 'publication-period' && entry.available && rows.length === 0;
  const byVideoPeriod = new Map();
  for (const row of rows) { const value = parseViews(row.views); if (value == null || !Number.isFinite(value)) continue; const identity = key(row.videoId, row.promotionObservationStart, row.promotionObservationEnd); byVideoPeriod.set(identity, Math.max(byVideoPeriod.get(identity) ?? 0, value)); }
  return { itemsSold: amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : knownEmpty ? 0 : null, available: amounts.length > 0 || knownEmpty, views: byVideoPeriod.size ? [...byVideoPeriod.values()].reduce((sum, value) => sum + value, 0) : knownEmpty ? 0 : null, viewsAvailable: byVideoPeriod.size > 0 || knownEmpty, rows, videoCount: unique(rows.filter(row => row.postDate?.startsWith(entry.month)).map(row => row.videoId)).length, missingPostDateCount: unique(rows.filter(row => !row.postDate).map(row => row.videoId)).length };
}

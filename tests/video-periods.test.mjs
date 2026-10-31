import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData } from '../lib/creator-engine.mjs';
import { previewHistoricalBaseline, confirmHistoricalBaseline, previewPendingVideoImport, confirmPendingVideoImport } from '../lib/video-periods.mjs';

const video = (changes = {}) => ({ videoId: 'V1', creatorId: 'creator', productId: 'P1', itemsSold: 500, periodStart: '2026-09-01', periodEnd: '2026-09-30', reportMonth: '2026-09', sourceFile: 'September.xlsx', ...changes });
const fixture = (changes = {}) => {
  const state = createEmptyState();
  state.creators = [{ creatorId: 'creator' }];
  state.videos = [video()];
  state.pendingVideoImports = [{ id: 'pending-1', status: 'period_unconfirmed', fileName: 'Video_Analysis_202501001-260931.xlsx', records: [video({ itemsSold: 10, periodStart: '', periodEnd: '', reportMonth: '', sourceFile: 'pending.xlsx', ...changes })] }];
  return state;
};
const october = { rangeStart: '2026-10-01', rangeEnd: '2026-10-31' };

test('actual statistics dates are required; no filename or post-date inference', () => {
  const state = fixture({ postDate: '2025-10-01' });
  for (const dates of [{}, { rangeStart: '2026-10-01' }, { rangeStart: '2026-09-31', rangeEnd: '2026-10-31' }, { rangeStart: '2026-02-29', rangeEnd: '2026-03-01' }, { rangeStart: '2026-10-31', rangeEnd: '2026-10-01' }, { rangeStart: '2026-1-01', rangeEnd: '2026-01-31' }, { rangeStart: '0000-01-01', rangeEnd: '0000-01-31' }]) {
    assert.throws(() => previewPendingVideoImport(state, 'pending-1', dates), error => error.code === 'INVALID_PERIOD');
  }
  assert.equal(previewPendingVideoImport(state, 'pending-1', { rangeStart: '2024-02-29', rangeEnd: '2024-02-29' }).reportMonth, '2024-02');
});

test('a separately confirmed month adds 500 + 10 = 510 and preserves source input', () => {
  const state = fixture();
  const original = structuredClone(state);
  const preview = previewPendingVideoImport(state, 'pending-1', october);
  assert.equal(preview.itemsSold, 10);
  assert.equal(preview.projectedItemsSold, 510);
  assert.equal(preview.requiresOverlapConfirmation, false);
  assert.equal(preview.willArchiveRecordCount, 0);
  assert.deepEqual(state, original);
  const confirmed = confirmPendingVideoImport(state, 'pending-1', { ...october, at: '2026-11-01T00:00:00.000Z' });
  assert.equal(deriveData(confirmed.state).stats.itemsSold, 510);
  assert.equal(confirmed.state.videos.length, 2);
  assert.equal(confirmed.state.pendingVideoImports[0].status, 'confirmed');
  assert.equal(confirmed.state.videos[1].periodStart, '2026-10-01');
  assert.equal(confirmed.state.imports.at(-1).type, 'videos');
  assert.deepEqual(state, original);
  assert.throws(() => confirmPendingVideoImport(confirmed.state, 'pending-1', october), error => error.code === 'PENDING_ALREADY_CONFIRMED');
});

test('a broad overlapping report previews old sources and requires explicit replacement', () => {
  const state = fixture({ itemsSold: 510 });
  const dates = { rangeStart: '2025-10-01', rangeEnd: '2026-09-30' };
  const preview = previewPendingVideoImport(state, 'pending-1', dates);
  assert.equal(preview.requiresOverlapConfirmation, true);
  assert.equal(preview.hasPartialOverlaps, false);
  assert.equal(preview.projectedItemsSold, 510);
  assert.equal(preview.willArchiveItemsSold, 500);
  assert.deepEqual(preview.overlappingPeriods[0], { periodStart: '2026-09-01', periodEnd: '2026-09-30', recordCount: 1, videoCount: 1, itemsSold: 500, sourceFiles: ['September.xlsx'], partialOverlap: false });
  assert.throws(() => confirmPendingVideoImport(state, 'pending-1', dates), error => error.code === 'OVERLAPPING_PERIOD');
  assert.throws(() => confirmPendingVideoImport(state, 'pending-1', { ...dates, replaceOverlapping: 'true' }), error => error.code === 'OVERLAPPING_PERIOD');
  const confirmed = confirmPendingVideoImport(state, 'pending-1', { ...dates, replaceOverlapping: true });
  assert.equal(confirmed.state.videos.length, 1);
  assert.equal(confirmed.state.videos[0].reportMonth, '');
  assert.equal(confirmed.state.videoReportArchives.length, 1);
  assert.equal(confirmed.state.videoReportArchives[0].records[0].itemsSold, 500);
  assert.equal(deriveData(confirmed.state).stats.itemsSold, 510);
  assert.equal(deriveData(confirmed.state).creators[0].lifetimeItemsSold, 510);
  const september = deriveData(confirmed.state, { month: '2026-09' });
  assert.equal(september.stats.itemsSold, 500);
  assert.match(september.stats.videoMetricSource, /归档/);
  assert.equal(september.creators[0].lifetimeItemsSold, 510);
});

test('same-period complete snapshot replaces and archives prior rows without duplicate sales', () => {
  const state = fixture({ itemsSold: 515 });
  const dates = { rangeStart: '2026-09-01', rangeEnd: '2026-09-30' };
  const preview = previewPendingVideoImport(state, 'pending-1', dates);
  assert.equal(preview.exactPeriods.length, 1);
  assert.equal(preview.overlappingPeriods.length, 0);
  assert.equal(preview.projectedItemsSold, 515);
  const confirmed = confirmPendingVideoImport(state, 'pending-1', dates);
  assert.equal(confirmed.state.videos.length, 1);
  assert.equal(confirmed.state.videoReportArchives[0].records[0].itemsSold, 500);
  assert.equal(deriveData(confirmed.state).stats.itemsSold, 515);
});

test('partial overlap never removes a broader historical baseline or guesses a split', () => {
  const state = fixture();
  state.videos[0] = video({ periodStart: '2026-01-01', periodEnd: '2026-09-30', reportMonth: '', itemsSold: 900 });
  const dates = { rangeStart: '2026-09-01', rangeEnd: '2026-09-30' };
  assert.equal(previewPendingVideoImport(state, 'pending-1', dates).hasPartialOverlaps, true);
  assert.throws(() => confirmPendingVideoImport(state, 'pending-1', { ...dates, replaceOverlapping: true }), error => error.code === 'PARTIAL_PERIOD_OVERLAP');
  assert.equal(state.videos[0].itemsSold, 900);
});

test('equal same-video sales in genuinely distinct months are both retained', () => {
  const state = fixture({ itemsSold: 500 });
  const confirmed = confirmPendingVideoImport(state, 'pending-1', october);
  assert.equal(deriveData(confirmed.state).stats.itemsSold, 1000);
});

test('duplicate report row keys use the last value in preview and activation', () => {
  const state = fixture();
  state.pendingVideoImports[0].records.push({ ...state.pendingVideoImports[0].records[0], itemsSold: 12 });
  const preview = previewPendingVideoImport(state, 'pending-1', october);
  assert.equal(preview.recordCount, 1);
  assert.equal(preview.itemsSold, 12);
  assert.equal(deriveData(confirmPendingVideoImport(state, 'pending-1', october).state).stats.itemsSold, 512);
});

test('missing, inactive, empty and malformed staged reports cannot activate', () => {
  const state = fixture();
  assert.throws(() => previewPendingVideoImport(state, 'missing', october), error => error.code === 'PENDING_NOT_FOUND');
  state.pendingVideoImports[0].status = 'dismissed';
  assert.throws(() => previewPendingVideoImport(state, 'pending-1', october), error => error.code === 'PENDING_NOT_AVAILABLE');
  state.pendingVideoImports[0].status = 'period_unconfirmed';
  state.pendingVideoImports[0].records = [];
  assert.throws(() => previewPendingVideoImport(state, 'pending-1', october), error => error.code === 'EMPTY_PENDING_REPORT');
  state.pendingVideoImports[0].records = [{ videoId: '', itemsSold: 10 }];
  assert.throws(() => previewPendingVideoImport(state, 'pending-1', october), error => error.code === 'INVALID_PENDING_REPORT');
});

test('archive retains every original source row while cumulative metrics use one row per key', () => {
  const state = fixture();
  state.videos.push(video({ itemsSold: 505, notes: 'corrected existing row' }));
  const dates = { rangeStart: '2026-09-01', rangeEnd: '2026-09-30' };
  const preview = previewPendingVideoImport(state, 'pending-1', dates);
  assert.equal(preview.willArchiveRecordCount, 2);
  assert.equal(preview.willArchiveItemsSold, 505);
  const result = confirmPendingVideoImport(state, 'pending-1', dates);
  assert.equal(result.state.videoReportArchives[0].records.length, 2);
  assert.equal(result.state.videoReportArchives[0].records[0].itemsSold, 500);
  assert.equal(result.state.videoReportArchives[0].records[1].itemsSold, 505);
  assert.equal(deriveData(result.state).stats.itemsSold, 10);
});

const septemberCutoff = { cutoffDate: '2026-09-30', replaceOverlapping: true, at: '2026-10-29T09:30:00.000Z' };
const baselineFixture = (itemsSold = 500) => {
  const state = fixture({ itemsSold, postDate: '2025-10-01' });
  state.videos[0].postDate = '2025-10-01';
  Object.assign(state.pendingVideoImports[0], { sha256: 'a'.repeat(64), sheetName: 'Sheet 1' });
  return state;
};
function addPending(state, id, records, extra = {}) {
  state.pendingVideoImports.push({ id, status: 'period_unconfirmed', fileName: `${id}.xlsx`, sheetName: 'Sheet 1', records, ...extra });
}

test('cutoff-only historical baseline includes old September once and keeps monthly reference', () => {
  const state = baselineFixture();
  state.pendingVideoImports[0].records.push(video({ videoId: 'V2', itemsSold: 10, postDate: '2026-03-01', periodStart: '', periodEnd: '', reportMonth: '' }));
  const original = structuredClone(state);
  const preview = previewHistoricalBaseline(state, 'pending-1', septemberCutoff);
  assert.equal(preview.mode, 'historicalBaseline');
  assert.equal(preview.itemsSold, 510);
  assert.equal(preview.projectedItemsSold, 510);
  assert.equal(preview.duplicateExistingVideos, 1);
  assert.equal(preview.duplicateExistingItemsSold, 500);
  assert.equal(preview.willArchiveItemsSold, 500);
  assert.equal(preview.requiresOverlapConfirmation, true);
  assert.throws(() => confirmHistoricalBaseline(state, 'pending-1', { cutoffDate: '2026-09-30' }), error => error.code === 'OVERLAPPING_PERIOD');
  const confirmed = confirmHistoricalBaseline(state, 'pending-1', septemberCutoff);
  assert.equal(confirmed.state.videos.length, 0);
  assert.equal(confirmed.state.videoBaselines.length, 1);
  const baseline = confirmed.state.videoBaselines[0];
  assert.equal(baseline.cutoffDate, '2026-09-30');
  assert.equal(baseline.periodStartKnown, false);
  assert.ok(baseline.records.every(row => row.periodStart === '' && row.reportMonth === '' && row.reportKind === 'historicalBaseline'));
  assert.equal(baseline.records[0].postDate, '2025-10-01');
  assert.equal(confirmed.state.pendingVideoImports[0].confirmationMode, 'historicalBaseline');
  assert.equal(deriveData(confirmed.state).stats.itemsSold, 510);
  assert.equal(deriveData(confirmed.state).creators[0].lifetimeItemsSold, 510);
  assert.equal(deriveData(confirmed.state, { month: '2026-09' }).stats.itemsSold, 500);
  assert.match(deriveData(confirmed.state, { month: '2026-09' }).stats.videoMetricSource, /归档/);
  assert.equal(deriveData(confirmed.state, { month: '2025-10' }).stats.itemsSold, 0);
  assert.deepEqual(state, original);
  assert.throws(() => confirmHistoricalBaseline(confirmed.state, 'pending-1', septemberCutoff), error => error.code === 'PENDING_ALREADY_CONFIRMED');
});

test('historical duplicates need same video identity; same publication day does not merge different videos', () => {
  const state = baselineFixture();
  const incoming = state.pendingVideoImports[0].records[0];
  state.pendingVideoImports[0].records.push({ ...incoming });
  state.pendingVideoImports[0].records.push({ ...incoming, videoId: 'V2' });
  const preview = previewHistoricalBaseline(state, 'pending-1', septemberCutoff);
  assert.equal(preview.originalRecordCount, 3);
  assert.equal(preview.recordCount, 2);
  assert.equal(preview.duplicateRows, 1);
  assert.equal(preview.conflictingRows, 0);
  assert.equal(preview.itemsSold, 1000);
  const confirmed = confirmHistoricalBaseline(state, 'pending-1', septemberCutoff);
  assert.equal(deriveData(confirmed.state).stats.itemsSold, 1000);
  assert.equal(confirmed.state.pendingVideoImports[0].records.length, 0);
  assert.equal(confirmed.state.pendingVideoImports[0].originalRecordCount, 3);
  assert.equal(confirmed.state.videoBaselines[0].sourceDuplicateRows.length, 1);
});

test('historical values 500, 480 and 500 use one per-video maximum and later sales add', () => {
  const state = baselineFixture();
  Object.assign(state.pendingVideoImports[0].records[0], { gmv: 100, views: 1000, title: 'first maximum', sourceRow: 3 });
  state.pendingVideoImports[0].records.push({ ...state.pendingVideoImports[0].records[0], itemsSold: 480, gmv: 999, views: 9000, title: 'lower snapshot', sourceRow: 4 });
  state.pendingVideoImports[0].records.push({ ...state.pendingVideoImports[0].records[0], itemsSold: 500, gmv: 111, views: 2222, title: 'latest equal maximum', sourceRow: 5 });
  const preview = previewHistoricalBaseline(state, 'pending-1', septemberCutoff);
  assert.equal(preview.conflictingRows, 0);
  assert.equal(preview.maxResolvedVideos, 1);
  assert.equal(preview.canActivate, true);
  assert.equal(preview.projectedItemsSold, 500);
  const result = confirmHistoricalBaseline(state, 'pending-1', septemberCutoff).state;
  const winning = result.videoBaselines[0].records[0];
  assert.equal(winning.itemsSold, 500);
  assert.equal(winning.gmv, 111);
  assert.equal(winning.views, 2222);
  assert.equal(winning.title, 'latest equal maximum');
  assert.equal(winning.sourceRow, 5);
  assert.equal(result.videoBaselines[0].sourceDuplicateRows.length, 2);
  assert.equal(result.videoBaselines[0].aggregationMethod, 'maxPerVideoProduct');
  assert.equal(deriveData(result).stats.itemsSold, 500);
  addPending(result, 'dated-October', [video({ itemsSold: 10, postDate: '2025-10-01', periodStart: '', periodEnd: '', reportMonth: '' })], { sourceHash: '9'.repeat(64) });
  const octoberState = confirmPendingVideoImport(result, 'dated-October', october).state;
  assert.equal(deriveData(octoberState).stats.itemsSold, 510);
});

test('historical maximum includes covered old reports and prior baseline, preserving winning source row', () => {
  const state = confirmHistoricalBaseline(baselineFixture(), 'pending-1', septemberCutoff).state;
  state.videos.push(video({ itemsSold: 600, gmv: 60, views: 6000, title: 'covered October winner', periodStart: october.rangeStart, periodEnd: october.rangeEnd, reportMonth: '2026-10', sourceFile: 'October.xlsx', sourceRow: 8 }));
  addPending(state, 'history-through-October', [video({ itemsSold: 480, gmv: 900, views: 9999 }), video({ videoId: 'V2', itemsSold: 500, postDate: '2025-10-01' })], { sourceHash: '8'.repeat(64) });
  const result = confirmHistoricalBaseline(state, 'history-through-October', { cutoffDate: '2026-10-31', replaceOverlapping: true }).state;
  const winning = result.videoBaselines[0].records.find(row => row.videoId === 'V1');
  assert.equal(winning.itemsSold, 600);
  assert.equal(winning.gmv, 60);
  assert.equal(winning.views, 6000);
  assert.equal(winning.title, 'covered October winner');
  assert.equal(winning.sourceFile, 'October.xlsx');
  assert.equal(winning.sourceRow, 8);
  assert.equal(result.videoBaselines[0].sourceDuplicateRows[0].itemsSold, 480);
  assert.equal(deriveData(result).stats.itemsSold, 1100);
  assert.ok(result.videoReportArchives.some(archive => archive.reportKind === 'historicalBaseline'));
  assert.ok(result.videoReportArchives.some(archive => archive.periodStart === '2026-10-01'));
});

test('historical cutoff requires a real date and cannot split an existing period', () => {
  const state = baselineFixture();
  for (const cutoffDate of [undefined, '', '2026-09-31', '2026-02-29', '2026-9-30', '0000-09-30']) {
    assert.throws(() => previewHistoricalBaseline(state, 'pending-1', { cutoffDate }), error => error.code === 'INVALID_BASELINE_CUTOFF');
  }
  state.videos[0] = video({ periodStart: '2026-09-15', periodEnd: '2026-10-15', reportMonth: '' });
  const preview = previewHistoricalBaseline(state, 'pending-1', septemberCutoff);
  assert.equal(preview.hasPartialOverlaps, true);
  assert.equal(preview.canActivate, false);
  assert.equal(preview.projectedItemsSold, null);
  assert.throws(() => confirmHistoricalBaseline(state, 'pending-1', septemberCutoff), error => error.code === 'PARTIAL_PERIOD_OVERLAP');
  assert.equal(state.videos[0].itemsSold, 500);
});

test('history 500 plus October 10 becomes 510 and later equal monthly values still accumulate', () => {
  const baseline = confirmHistoricalBaseline(baselineFixture(), 'pending-1', septemberCutoff).state;
  addPending(baseline, 'October', [video({ itemsSold: 10, postDate: '2025-10-01', periodStart: '', periodEnd: '', reportMonth: '' })], { sourceHash: 'b'.repeat(64) });
  const octoberState = confirmPendingVideoImport(baseline, 'October', october).state;
  assert.equal(deriveData(octoberState).stats.itemsSold, 510);
  assert.equal(deriveData(octoberState, { month: '2026-10' }).stats.itemsSold, 10);
  addPending(octoberState, 'November', [video({ itemsSold: 10, postDate: '2025-10-01', periodStart: '', periodEnd: '', reportMonth: '' })], { sourceHash: 'c'.repeat(64) });
  const novemberState = confirmPendingVideoImport(octoberState, 'November', { rangeStart: '2026-11-01', rangeEnd: '2026-11-30' }).state;
  assert.equal(deriveData(novemberState).stats.itemsSold, 520);
  assert.equal(novemberState.videoBaselines[0].cutoffDate, '2026-09-30');
});

test('confirming history retains already imported later monthly increments', () => {
  const state = baselineFixture();
  state.videos.push(video({ itemsSold: 10, periodStart: october.rangeStart, periodEnd: october.rangeEnd, reportMonth: '2026-10', sourceFile: 'October.xlsx' }));
  const preview = previewHistoricalBaseline(state, 'pending-1', septemberCutoff);
  assert.equal(preview.preservedFutureRecordCount, 1);
  assert.equal(preview.projectedItemsSold, 510);
  const confirmed = confirmHistoricalBaseline(state, 'pending-1', septemberCutoff).state;
  assert.equal(confirmed.videos.length, 1);
  assert.equal(confirmed.videos[0].reportMonth, '2026-10');
  assert.equal(confirmed.videoReportArchives[0].records[0].reportMonth, '2026-09');
  assert.equal(deriveData(confirmed).stats.itemsSold, 510);
});

test('newer complete history replaces the prior baseline and covered increments once', () => {
  const current = confirmHistoricalBaseline(baselineFixture(), 'pending-1', septemberCutoff).state;
  current.videos.push(video({ itemsSold: 10, periodStart: october.rangeStart, periodEnd: october.rangeEnd, reportMonth: '2026-10' }));
  current.videos.push(video({ itemsSold: 20, periodStart: '2026-11-01', periodEnd: '2026-11-30', reportMonth: '2026-11' }));
  addPending(current, 'new-history', [video({ itemsSold: 530, periodStart: '', periodEnd: '', reportMonth: '' })], { sha256: 'd'.repeat(64) });
  const original = structuredClone(current);
  const result = confirmHistoricalBaseline(current, 'new-history', { cutoffDate: '2026-10-31', replaceOverlapping: true });
  assert.equal(result.state.videoBaselines.length, 1);
  assert.equal(result.state.videoBaselines[0].cutoffDate, '2026-10-31');
  assert.equal(result.state.videos.length, 1);
  assert.equal(result.state.videos[0].reportMonth, '2026-11');
  assert.equal(deriveData(result.state).stats.itemsSold, 550);
  assert.equal(result.state.videoReportArchives.filter(archive => archive.reportKind === 'historicalBaseline').length, 1);
  assert.equal(result.state.videoReportArchives.find(archive => archive.reportKind === 'historicalBaseline').records[0].itemsSold, 500);
  assert.deepEqual(current, original);
  addPending(result.state, 'too-old', [video({ itemsSold: 450 })], { sha256: 'e'.repeat(64) });
  assert.equal(previewHistoricalBaseline(result.state, 'too-old', septemberCutoff).canActivate, false);
  assert.throws(() => confirmHistoricalBaseline(result.state, 'too-old', septemberCutoff), error => error.code === 'BASELINE_CUTOFF_REGRESSION');
});

test('ordinary interval import cannot add sales already covered by a cutoff-only baseline', () => {
  const state = confirmHistoricalBaseline(baselineFixture(), 'pending-1', septemberCutoff).state;
  addPending(state, 'inside-history', [video({ itemsSold: 11 })], { sha256: 'f'.repeat(64) });
  const dates = { rangeStart: '2026-09-01', rangeEnd: '2026-09-30', replaceOverlapping: true };
  const preview = previewPendingVideoImport(state, 'inside-history', dates);
  assert.equal(preview.baselineOverlaps.length, 1);
  assert.equal(preview.projectedItemsSold, null);
  assert.throws(() => confirmPendingVideoImport(state, 'inside-history', dates), error => error.code === 'BASELINE_PERIOD_OVERLAP');
  assert.equal(deriveData(state).stats.itemsSold, 500);
});

test('exact file replay skips metrics and never advances historical cutoff', () => {
  const source = baselineFixture();
  const sourceRecords = structuredClone(source.pendingVideoImports[0].records);
  const state = confirmHistoricalBaseline(source, 'pending-1', septemberCutoff).state;
  addPending(state, 'same-file-replay', structuredClone(sourceRecords), { sha256: 'a'.repeat(64) });
  const preview = previewHistoricalBaseline(state, 'same-file-replay', { cutoffDate: '2026-12-31' });
  assert.equal(preview.duplicateFile, true);
  assert.equal(preview.projectedItemsSold, 500);
  const confirmed = confirmHistoricalBaseline(state, 'same-file-replay', { cutoffDate: '2026-12-31', replaceOverlapping: true });
  assert.equal(confirmed.summary.duplicateFile, true);
  assert.equal(confirmed.summary.archivedRecords, 0);
  assert.equal(confirmed.state.videoBaselines[0].cutoffDate, '2026-09-30');
  assert.equal(deriveData(confirmed.state).stats.itemsSold, 500);
  assert.equal(confirmed.state.pendingVideoImports.at(-1).confirmationMode, 'duplicateSkipped');
  addPending(confirmed.state, 'same-file-as-month', structuredClone(sourceRecords), { sha256: 'a'.repeat(64) });
  const monthReplay = confirmPendingVideoImport(confirmed.state, 'same-file-as-month', october);
  assert.equal(monthReplay.summary.duplicateFile, true);
  assert.equal(monthReplay.state.videos.length, 0);
  assert.equal(monthReplay.state.videoReportArchives.length, state.videoReportArchives.length);
  assert.equal(deriveData(monthReplay.state).stats.itemsSold, 500);
});

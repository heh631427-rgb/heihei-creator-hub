import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData, mergeImport, normalizeRows, guessMappings } from '../lib/creator-engine.mjs';
import { stageVideoImport } from '../lib/video-staging.mjs';
import { previewPendingVideoImport, confirmPendingVideoImport } from '../lib/video-periods.mjs';

const context = (extra = {}) => ({ sourceName: 'Video_Analysis_20260928-20261027.xlsx', sheetName: 'Sheet 1', sourceHash: 'a'.repeat(64), at: '2026-10-30T10:00:00.000Z', ...extra });
const video = (extra = {}) => ({ videoId: 'NEW1', productId: 'P1', creatorId: 'known', itemsSold: 10, views: 100, postDate: '2026-10-10', sourceRow: 3, ...extra });
const october = { rangeStart: '2026-10-01', rangeEnd: '2026-10-31', at: '2026-11-01T00:00:00.000Z' };
function fixture() {
  const state = createEmptyState();
  const old = video({ videoId: 'OLD1', itemsSold: 500, views: 200, postDate: '2026-09-10', periodStart: '', periodEnd: '2026-09-30', reportKind: 'historicalBaseline' });
  state.videoBaselines = [{ id: 'baseline', sourceHash: 'b'.repeat(64), sheetName: 'Sheet 1', cutoffDate: '2026-09-30', records: [old] }];
  state.videoReportArchives = [{ id: 'september', periodStart: '2026-09-01', periodEnd: '2026-09-30', records: [{ ...old, reportKind: '', periodStart: '2026-09-01', reportMonth: '2026-09' }] }];
  state.samples = [{ id: 'manual-1', creatorId: 'known', sku: 'S1', productId: 'P1', date: '2026-09-01', quantity: 1, notes: '手工备注', _manual: { notes: true } }];
  state.creators = [{ creatorId: 'known', willingness: '高', notes: '已有档案' }];
  return state;
}

test('staging contributes publication facts and historical view references but no unconfirmed period playback or sales', () => {
  const state = fixture();
  const original = structuredClone(state);
  const rows = [video({ videoId: 'OLD1', views: 900, postDate: '2026-09-10' }), video({ creatorId: 'newcomer', itemsSold: 1000, periodStart: '2026-10-01', periodEnd: '2026-10-31', reportMonth: '2026-10', rangeStart: '2026-10-01', rangeEnd: '2026-10-31', snapshotPeriod: '2026-10', month: '2026-10', salesDate: '2026-10', reportKind: 'historicalBaseline', baselineCutoff: '2026-10-31', confirmedReportId: 'untrusted' })];
  const originalRows = structuredClone(rows);
  const result = stageVideoImport(state, rows, context({ month: '2026-10', rangeStart: '2026-10-01', rangeEnd: '2026-10-31', suggestedRangeStart: '2026-09-28', suggestedRangeEnd: '2026-10-27' }));
  assert.equal(deriveData(result.state).stats.itemsSold, 500);
  assert.equal(deriveData(result.state, { month: '2026-09' }).stats.itemsSold, 500);
  assert.equal(deriveData(result.state, { month: '2026-10' }).stats.itemsSold, 0);
  assert.equal(deriveData(result.state, { month: '2026-10' }).stats.videoCount, 1);
  assert.equal(deriveData(result.state, { month: '2026-09' }).stats.views, 200);
  assert.equal(deriveData(result.state, { month: '2026-09' }).stats.historicalViewsReference, 900);
  assert.equal(deriveData(result.state).creators.some(row => row.creatorId === 'newcomer'), false);
  for (const field of ['samples', 'orders', 'creators', 'preferences', 'productMappings', 'promotions', 'settings', 'videos', 'videoBaselines', 'videoReportArchives', 'videoViewMaxima']) assert.deepEqual(result.state[field], original[field], field);
  const pending = result.state.pendingVideoImports.at(-1);
  assert.equal(pending.status, 'period_unconfirmed');
  assert.equal(pending.periodStart, '');
  assert.equal(pending.periodEnd, '');
  assert.equal(pending.suggestedRangeStart, '2026-09-28');
  assert.equal(pending.summary.itemsSold, 1010);
  for (const row of pending.records) {
    for (const field of ['periodStart', 'periodEnd', 'reportMonth', 'rangeStart', 'rangeEnd', 'snapshotPeriod', 'month', 'salesDate']) assert.equal(row[field], '', field);
    assert.equal(row.pendingPeriod, true);
    assert.equal(row.reportKind, undefined);
    assert.equal(row.baselineCutoff, undefined);
    assert.equal(row.confirmedReportId, undefined);
  }
  assert.throws(() => mergeImport(state, 'videos', pending.records, context()), error => error.code === 'MISSING_VIDEO_PERIOD');
  assert.throws(() => previewPendingVideoImport(result.state, pending.id, { rangeStart: '2026-09-28', rangeEnd: '2026-10-27' }) && confirmPendingVideoImport(result.state, pending.id, { rangeStart: '2026-09-28', rangeEnd: '2026-10-27' }), error => error.code === 'BASELINE_PERIOD_OVERLAP');
  assert.deepEqual(state, original);
  assert.deepEqual(rows, originalRows);
});

test('same bytes and sheet are idempotent pending or already accepted, regardless of mapping/default month', () => {
  const first = stageVideoImport(fixture(), [video()], context());
  const original = structuredClone(first.state);
  const repeat = stageVideoImport(first.state, [video({ itemsSold: 999 })], context({ mappingSignature: 'changed', month: '2030-01' }));
  assert.equal(repeat.summary.duplicateFile, true);
  assert.equal(repeat.summary.added, 0);
  assert.equal(repeat.summary.pendingImportId, first.summary.pendingImportId);
  assert.deepEqual(repeat.state, original);
  assert.equal(stageVideoImport(first.state, [], context()).summary.duplicateFile, true);
  const accepted = stageVideoImport(fixture(), [video()], context({ sourceHash: 'b'.repeat(64), mappingSignature: 'different' }));
  assert.equal(accepted.summary.duplicateFile, true);
  assert.equal(accepted.state.pendingVideoImports.length, 0);
  const otherSheet = stageVideoImport(first.state, [video({ videoId: 'NEW2' })], context({ sheetName: 'Sheet 2' }));
  assert.equal(otherSheet.summary.duplicateFile, false);
  assert.equal(otherSheet.state.pendingVideoImports.length, 2);
});

test('a new pending report uses the existing explicit confirmation flow exactly once', () => {
  const staged = stageVideoImport(fixture(), [video()], context());
  const preview = previewPendingVideoImport(staged.state, staged.summary.pendingImportId, october);
  assert.equal(preview.projectedItemsSold, 510);
  assert.equal(deriveData(staged.state).stats.itemsSold, 500);
  const confirmed = confirmPendingVideoImport(staged.state, staged.summary.pendingImportId, october);
  assert.equal(deriveData(confirmed.state).stats.itemsSold, 510);
  assert.equal(confirmed.state.videos[0].pendingPeriod, false);
  assert.equal(confirmed.state.videos[0].periodStatus, 'confirmed');
  assert.equal(deriveData(confirmed.state).allSamples[0].pendingVideoCount, 0);
  assert.equal(stageVideoImport(confirmed.state, [video()], context()).summary.duplicateFile, true);
  assert.throws(() => confirmPendingVideoImport(confirmed.state, staged.summary.pendingImportId, october), error => error.code === 'PENDING_ALREADY_CONFIRMED');
});

test('compound PIDs are retained for review and never create a synthetic PID or SKU-based allocation', () => {
  const state = createEmptyState();
  state.productMappings = [{ skuId: 'SKU1', sku: 'S1', productId: 'P1' }];
  const staged = stageVideoImport(state, [video({ productId: 'P1,P2', skuId: 'SKU1', sku: 'S1', itemsSold: 50, postDate: '' })], context());
  const row = staged.state.pendingVideoImports[0].records[0];
  assert.equal(row.productId, '');
  assert.deepEqual(row.rawProductIds, ['P1', 'P2']);
  assert.equal(row.sourceProductId, 'P1,P2');
  assert.equal(row.sourceSkuId, 'SKU1');
  assert.equal(row.skuId, '');
  assert.equal(row.excludedFromMetrics, true);
  assert.equal(staged.summary.reportSummary.multiProductRows, 1);
  assert.equal(deriveData(staged.state).allPublicationVideos[0].productId, '');
  const confirmed = confirmPendingVideoImport(staged.state, staged.summary.pendingImportId, october);
  assert.equal(deriveData(confirmed.state).stats.itemsSold, 0);
  assert.equal(confirmed.state.videos[0].itemsSold, 50);
});

test('duplicate raw rows remain reviewable; confirmed period sales deduplicate while views retain the maximum', () => {
  const staged = stageVideoImport(createEmptyState(), [video({ itemsSold: 3, views: 450 }), video({ itemsSold: 5, views: 20, sourceRow: 4 })], context());
  assert.equal(staged.summary.duplicates, 1);
  assert.equal(staged.summary.reportSummary.conflictingDuplicates, 1);
  assert.equal(staged.state.pendingVideoImports[0].records.length, 2);
  assert.equal(staged.summary.reportSummary.itemsSold, 5);
  const confirmed = confirmPendingVideoImport(staged.state, staged.summary.pendingImportId, october);
  assert.equal(deriveData(confirmed.state).stats.itemsSold, 5);
  assert.equal(deriveData(confirmed.state).stats.views, 450);
});

test('invalid video identities and missing file hash cannot produce a pending container', () => {
  const state = createEmptyState();
  const result = stageVideoImport(state, [video(), null, ...['', 'bad id', '--', '-', 'undefined', 'null', 7691452588776000790].map(videoId => video({ videoId }))], context());
  assert.equal(result.summary.rejected, 8);
  assert.equal(result.state.pendingVideoImports[0].records.length, 1);
  assert.throws(() => stageVideoImport(state, [video({ videoId: '' })], context()), error => error.code === 'EMPTY_PENDING_REPORT');
  assert.throws(() => stageVideoImport(state, [video()], context({ sourceHash: '' })), error => error.code === 'MISSING_SOURCE_HASH');
  assert.equal(state.pendingVideoImports.length, 0);
});

test('normalization can retain an unconfirmed report without using Post date as a sales period', () => {
  const headers = ['Video ID', 'Post date', 'Creator name', 'Product ID', 'Video-attributed items sold'];
  const mapping = guessMappings(headers, 'videos');
  const normalized = normalizeRows('videos', [['7691452588776000790', '09/30/2026 23:04', 'known', 'P1', 3]], mapping, { ...context(), allowUnconfirmedPeriod: true, dateFormat: 'mdy', headers });
  assert.equal(normalized.records.length, 1);
  assert.equal(normalized.records[0].postDate, '2026-09-30');
  assert.equal(normalized.records[0].periodStart, '');
  const staged = stageVideoImport(fixture(), normalized.records, context());
  assert.equal(deriveData(staged.state).stats.itemsSold, 500);
  assert.equal(staged.summary.reportSummary.itemsSold, 3);
});

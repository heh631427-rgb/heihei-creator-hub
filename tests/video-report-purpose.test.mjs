import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData, fieldSchemas, guessMappings, mergeImport, normalizeRows } from '../lib/creator-engine.mjs';
import { markPendingVideoAsPublication, stageVideoImport } from '../lib/video-staging.mjs';
import { confirmHistoricalBaseline, confirmPendingVideoImport } from '../lib/video-periods.mjs';

const oldId = '7000000000000000001';
const newId = '7000000000000000002';
const otherId = '7000000000000000003';
const october = { periodStart: '2026-10-01', periodEnd: '2026-10-31', reportMonth: '2026-10' };
const november = { periodStart: '2026-11-01', periodEnd: '2026-11-30', reportMonth: '2026-11' };
const video = (changes = {}) => {
  const row = { videoId: oldId, creatorId: 'known', productId: 'P1', postDate: '2026-09-20', itemsSold: 10, views: 100, ...changes };
  return { ...row, url: `https://www.tiktok.com/@${row.creatorId}/video/${row.videoId}` };
};
const context = (hash, changes = {}) => ({ sourceName: `${hash}.xlsx`, sheetName: 'Videos', sourceHash: hash, at: '2026-10-30T10:00:00.000Z', ...changes });
const pubContext = hash => context(hash, { reportPurpose: 'publication' });
const salesContext = hash => context(hash, { reportPurpose: 'sales', replacePeriod: true });
function fixture() {
  const state = createEmptyState();
  state.videoBaselines = [{ id: 'history', cutoffDate: '2026-09-30', records: [video({ itemsSold: 500, views: 50 })] }];
  state.samples = [{ id: 'SAMPLE', orderId: 'O1', creatorId: 'known', sku: 'S1', productId: 'P1', date: '2026-09-01', quantity: 2, notes: '保留手工备注', _manual: { notes: true } }];
  state.creators = [{ creatorId: 'known', willingness: '高', notes: '已有档案' }];
  state.productMappings = [{ sku: 'S1', skuId: 'SKU1', productId: 'P1' }];
  return state;
}

test('publication-purpose reports without playback dates retain reference observations without confirming sales or playback periods', () => {
  const state = fixture(), original = structuredClone(state);
  const rows = [video({ views: 80 }), video({ videoId: newId, postDate: '2026-10-04', itemsSold: 99 }), video({ videoId: otherId, creatorId: 'outsider', productId: 'P2', postDate: '2026-10-06', itemsSold: 10000, views: 200 })];
  const result = stageVideoImport(state, rows, pubContext('publication'));
  const report = result.state.pendingVideoImports[0], all = deriveData(result.state), month = deriveData(result.state, { month: '2026-10' });
  assert.equal(report.status, 'publication_only');
  assert.equal(report.reportPurpose, 'publication');
  assert.equal(report.records[1].itemsSold, 99);
  assert.equal(report.records[1].periodStatus, 'not_applicable');
  assert.equal(report.records[1].pendingPeriod, false);
  assert.equal(report.records[1].periodStart, '');
  assert.equal(all.stats.itemsSold, 500);
  assert.equal(month.stats.itemsSold, 0);
  assert.equal(month.stats.videoCount, 2);
  assert.equal(all.stats.views, null);
  assert.equal(all.stats.historicalViewsReference, 380);
  assert.equal(all.creators.some(row => row.creatorId === 'outsider'), false);
  const candidate = all.allSamples[0].candidateVideos.find(row => row.videoId === newId);
  assert.deepEqual({ itemsSold: candidate.itemsSold, pendingPeriod: candidate.pendingPeriod, publicationOnly: candidate.publicationOnly, reportPurpose: candidate.reportPurpose }, { itemsSold: 0, pendingPeriod: false, publicationOnly: true, reportPurpose: 'publication' });
  assert.equal(all.allSamples[0].videoLinks.length, 0);
  assert.equal(result.state.videoViewMaxima.find(row => row.videoId === newId).views, 100);
  for (const field of ['samples', 'creators', 'preferences', 'orders', 'promotions', 'productMappings', 'videos', 'videoBaselines']) assert.deepEqual(result.state[field], original[field], field);
  assert.deepEqual(state, original);
});

test('publication and complete sales files may arrive in either order without replacing or adding each other’s sales', () => {
  const publication = [video({ videoId: newId, postDate: '2026-10-04', itemsSold: 1000, views: 900 })];
  const sales = [video({ ...october, itemsSold: 10, views: 300 }), video({ ...october, videoId: newId, postDate: '2026-10-04', itemsSold: 3, views: 100 })];
  const publicationFirst = mergeImport(stageVideoImport(fixture(), publication, pubContext('pub')).state, 'videos', sales, salesContext('sales')).state;
  const salesFirst = stageVideoImport(mergeImport(fixture(), 'videos', sales, salesContext('sales')).state, publication, pubContext('pub')).state;
  for (const state of [publicationFirst, salesFirst]) {
    const all = deriveData(state), month = deriveData(state, { month: '2026-10' });
    assert.equal(all.stats.itemsSold, 513);
    assert.equal(all.creators[0].lifetimeItemsSold, 513);
    assert.equal(month.stats.itemsSold, 13);
    assert.equal(month.promotions[0].itemsSold, 1000);
    assert.equal(month.promotions[0].salesDisplayMode, 'publication-unconfirmed');
    assert.equal(month.stats.videoCount, 1);
    assert.equal(all.stats.views, 400);
    assert.equal(all.stats.historicalViewsReference, 1200);
    const candidate = all.allSamples[0].candidateVideos.find(row => row.videoId === newId);
    assert.equal(candidate.itemsSold, 3);
    assert.equal(candidate.pendingPeriod, false);
    assert.equal(candidate.publicationOnly, false);
    assert.equal(candidate.reportPurpose, 'sales');
  }
});

test('creator lifetime adds actual nonoverlapping sales periods while monthly promotion remains the current month', () => {
  const octoberState = mergeImport(fixture(), 'videos', [video({ ...october, itemsSold: 10, views: 800 })], salesContext('october')).state;
  const state = mergeImport(octoberState, 'videos', [video({ ...november, itemsSold: 7, views: 400 })], salesContext('november')).state;
  assert.equal(deriveData(state).creators[0].lifetimeItemsSold, 517);
  for (const [month, sold] of [['2026-10', 10], ['2026-11', 7]]) {
    const data = deriveData(state, { month });
    assert.equal(data.creators[0].lifetimeItemsSold, 517);
    assert.equal(data.stats.itemsSold, sold);
    assert.equal(data.stats.promotionItemsSold, null);
    assert.equal(data.stats.promotionSalesMode, 'unavailable');
    assert.equal(data.stats.videoCount, 0);
  }
  assert.equal(deriveData(state).stats.views, 1200);
  assert.equal(deriveData(state).stats.historicalViewsReference, 800);
});

test('replayed publication files are idempotent and cannot be relabelled as future sales', () => {
  const first = stageVideoImport(fixture(), [video({ videoId: newId, itemsSold: 88 })], pubContext('same-file'));
  const repeated = stageVideoImport(first.state, [video({ itemsSold: 999 })], context('same-file', { reportPurpose: 'publication', month: '2030-01', mappingSignature: 'changed' }));
  assert.equal(repeated.summary.duplicateFile, true);
  assert.equal(repeated.state, first.state);
  const mistakenSales = mergeImport(first.state, 'videos', [video({ ...november, itemsSold: 888 })], context('same-file', { mappingSignature: 'changed', replacePeriod: true }));
  assert.equal(mistakenSales.summary.duplicateFile, true);
  assert.equal(deriveData(mistakenSales.state).stats.itemsSold, 500);
  assert.throws(() => mergeImport(first.state, 'videos', [{ ...first.state.pendingVideoImports[0].records[0], ...october }], salesContext('new-hash')), error => error.code === 'PUBLICATION_REPORT_NOT_SALES');
  assert.throws(() => mergeImport(first.state, 'videos', [video({ ...october })], pubContext('new-hash')), error => error.code === 'PUBLICATION_REPORT_NOT_SALES');
});

test('explicit pending-to-publication classification preserves raw sales observations and cannot activate them later', () => {
  const staged = stageVideoImport(fixture(), [video({ videoId: newId, postDate: '2026-10-08', itemsSold: 2266, views: 900 })], context('legacy-pending'));
  const old = structuredClone(staged.state), before = deriveData(staged.state);
  const result = markPendingVideoAsPublication(staged.state, staged.summary.pendingImportId, { at: '2026-10-30T11:00:00.000Z' });
  const report = result.state.pendingVideoImports[0], after = deriveData(result.state);
  assert.equal(report.status, 'publication_only');
  assert.equal(report.records[0].itemsSold, 2266);
  assert.equal(report.summary.itemsSold, 2266);
  assert.equal(report.classifiedAt, '2026-10-30T11:00:00.000Z');
  assert.equal(after.stats.itemsSold, before.stats.itemsSold);
  assert.equal(after.stats.videoCount, before.stats.videoCount);
  assert.equal(after.stats.views, before.stats.views);
  assert.equal(result.state.pendingVideoImports.filter(row => row.status === 'period_unconfirmed').length, 0);
  assert.equal(result.state.videoViewMaxima.find(row => row.videoId === newId).views, 900);
  assert.equal(markPendingVideoAsPublication(result.state, report.id).state, result.state);
  assert.throws(() => confirmPendingVideoImport(result.state, report.id, { rangeStart: '2026-10-01', rangeEnd: '2026-10-31' }), error => error.code === 'PENDING_NOT_AVAILABLE');
  assert.throws(() => confirmHistoricalBaseline(result.state, report.id, { cutoffDate: '2026-10-31' }), error => error.code === 'PENDING_NOT_AVAILABLE');
  assert.deepEqual(staged.state, old);
  const confirmed = confirmPendingVideoImport(staged.state, report.id, { rangeStart: '2026-10-01', rangeEnd: '2026-10-31' }).state;
  assert.throws(() => markPendingVideoAsPublication(confirmed, report.id), error => error.code === 'PENDING_NOT_AVAILABLE');
});

test('same-period full sales updates replace, and extended intervals require complete explicit overlap replacement', () => {
  const partialMonth = { ...october, periodEnd: '2026-10-28' };
  const initial = mergeImport(fixture(), 'videos', [video({ ...partialMonth, itemsSold: 10, views: 900 }), video({ ...partialMonth, videoId: newId, itemsSold: 5 })], salesContext('partial')).state;
  const corrected = mergeImport(initial, 'videos', [video({ ...partialMonth, itemsSold: 8, views: 400 })], salesContext('corrected')).state;
  assert.equal(deriveData(corrected).stats.itemsSold, 508);
  assert.equal(corrected.videos.length, 1);
  assert.equal(deriveData(corrected).stats.views, 400);
  assert.equal(deriveData(corrected).stats.historicalViewsReference, 900);
  assert.equal(mergeImport(corrected, 'videos', [video({ ...partialMonth, itemsSold: 999 })], salesContext('corrected')).summary.duplicateFile, true);
  assert.throws(() => mergeImport(corrected, 'videos', [video({ ...october, itemsSold: 20 })], salesContext('extended')), error => error.code === 'OVERLAPPING_PERIOD');
  const extended = mergeImport(corrected, 'videos', [video({ ...october, itemsSold: 20 })], { ...salesContext('extended'), replaceOverlapping: true }).state;
  assert.equal(deriveData(extended).stats.itemsSold, 520);
  assert.equal(deriveData(extended, { month: '2026-10' }).stats.itemsSold, 20);
  assert.equal(deriveData(extended).stats.views, 100);
  assert.equal(deriveData(extended).stats.historicalViewsReference, 900);
  assert.equal(extended.videos.length, 1);
  assert.throws(() => mergeImport(extended, 'videos', [video({ ...october, periodStart: '2026-10-15', periodEnd: '2026-11-15', reportMonth: '', itemsSold: 99 })], { ...salesContext('partial-overlap'), replaceOverlapping: true }), error => error.code === 'PARTIAL_PERIOD_REPLACEMENT');
});

test('compound PIDs are quarantined on direct sales imports while valid unmapped IDs and undated video sales survive', () => {
  const headers = ['Video ID', 'Creator name', 'Product ID', 'Post date', 'Items sold', 'Video views', 'SKU ID'];
  const mapping = guessMappings(headers, 'videos');
  const normalized = normalizeRows('videos', [[newId, 'known', 'P1,P2', '10/04/2026', 50, 900, 'SKU1'], [otherId, 'known', 'LEGIT_UNKNOWN', '', 7, 100, '']], mapping, { ...salesContext('products'), month: '2026-10' });
  assert.equal(normalized.records.length, 2);
  assert.equal(normalized.records[0].productId, '');
  assert.deepEqual(normalized.records[0].rawProductIds, ['P1', 'P2']);
  assert.equal(normalized.records[0].sourceProductId, 'P1,P2');
  assert.equal(normalized.records[0].sourceSkuId, 'SKU1');
  const state = mergeImport(fixture(), 'videos', normalized.records, salesContext('products')).state;
  assert.equal(state.videos[0].itemsSold, 50);
  assert.equal(state.videos[0].productReviewRequired, true);
  assert.equal(state.videos[1].productId, 'LEGIT_UNKNOWN');
  const data = deriveData(state);
  assert.equal(data.stats.itemsSold, 507);
  assert.equal(data.stats.videoCount, 3);
  assert.equal(data.stats.undatedVideoCount, 1);
  assert.equal(data.stats.views, 1000);
  assert.equal(data.stats.historicalViewsReference, 1050);
  assert.equal(deriveData(state, { month: '2026-10' }).stats.itemsSold, 7);
  assert.equal(data.promotions.some(row => row.productId === 'P1,P2'), false);
  assert.equal(data.allPublicationVideos.find(row => row.videoId === newId).productId, '');
  // Merge callers that bypass normalizeRows receive the same quarantine.
  const direct = mergeImport(fixture(), 'videos', [video({ ...october, productId: 'P1;P2', skuId: 'SKU1' })], salesContext('direct')).state;
  assert.equal(direct.videos[0].productId, '');
  assert.equal(deriveData(direct).stats.itemsSold, 500);
});

test('publication normalization ignores sales-period defaults and retains an invalid source sales date as audit evidence', () => {
  const headers = ['Video ID', 'Creator name', 'Product ID', 'Post date', 'Items sold', '出单日期'];
  const normalized = normalizeRows('videos', [[newId, 'known', 'P1', '10/06/2026', 123, 'not a sales interval']], guessMappings(headers, 'videos'), { ...pubContext('normalization'), month: '2026-11', rangeStart: '2026-11-01', rangeEnd: '2026-11-30' });
  assert.equal(normalized.rejected, 0);
  assert.equal(normalized.records.length, 1);
  assert.equal(normalized.records[0].postDate, '2026-10-06');
  assert.equal(normalized.records[0].periodStart, '');
  assert.equal(normalized.records[0].reportMonth, '');
  assert.equal(normalized.records[0].unconfirmedSourcePeriod.salesDate, 'not a sales interval');
  const staged = stageVideoImport(fixture(), normalized.records, pubContext('normalization')).state;
  assert.equal(deriveData(staged).stats.itemsSold, 500);
  assert.equal(deriveData(staged, { month: '2026-10' }).stats.videoCount, 1);
});

test('creator average-views label keeps legacy imports and uses the latest preference value without computing a video average', () => {
  assert.equal(fieldSchemas.preferences.find(field => field.key === 'latestViews').label, '达人视频均播放量');
  for (const label of ['达人视频均播放量', '视频均播放量', '平均播放量', 'Avg video views', 'Average video views', '最新播放量', 'Views']) {
    assert.equal(guessMappings(['Creator name', label], 'preferences').latestViews, '1', label);
  }
  const state = mergeImport(fixture(), 'preferences', [{ creatorId: 'known', latestViews: 120, latestViewsAsOf: '2026-10-01' }]).state;
  const withVideos = stageVideoImport(state, [video({ videoId: newId, views: 1000000 })], pubContext('large-views')).state;
  assert.equal(deriveData(withVideos).creators[0].views, 120);
  const updated = mergeImport(withVideos, 'preferences', [{ creatorId: 'known', latestViews: 80, latestViewsAsOf: '2026-10-30' }]).state;
  assert.equal(deriveData(updated).creators[0].views, 80);
  assert.equal(deriveData(updated).creators[0].avgViews, null);
});

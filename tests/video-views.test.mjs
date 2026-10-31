import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData, mergeImport } from '../lib/creator-engine.mjs';
import { confirmHistoricalBaseline, confirmPendingVideoImport } from '../lib/video-periods.mjs';

const id = '7000000000000000001';
const otherId = '7000000000000000002';
const video = (changes = {}) => ({ videoId: id, creatorId: 'creator', productId: 'P1', postDate: '2026-06-15', reportMonth: '2026-10', periodStart: '2026-10-01', periodEnd: '2026-10-31', itemsSold: 10, views: 1000, gmv: 20, url: `https://www.tiktok.com/@creator/video/${id}`, ...changes });
const pending = (records, changes = {}) => ({ id: 'pending', status: 'period_unconfirmed', fileName: 'pending.xlsx', records, ...changes });
const october = { rangeStart: '2026-10-01', rangeEnd: '2026-10-31' };
const nextPeriod = { reportMonth: '2026-11', periodStart: '2026-11-01', periodEnd: '2026-11-30' };

test('views add separate playback months and deduplicate PID rows while historical references retain maxima', () => {
  const state = createEmptyState();
  state.videos = [video(), video({ ...nextPeriod, itemsSold: 2, views: 600 }), video({ productId: 'P2', itemsSold: 3, views: 900 }), video({ videoId: otherId, views: 250, itemsSold: 1 })];
  const all = deriveData(state), june = deriveData(state, { month: '2026-06' }), octoberResult = deriveData(state, { month: '2026-10' });
  assert.equal(all.stats.views, 1850);
  assert.equal(all.stats.historicalViewsReference, 1250);
  assert.equal(all.stats.itemsSold, 16);
  assert.equal(all.stats.gmv, 80);
  assert.equal(all.stats.videoCount, 2);
  assert.ok(all.videos.filter(row => row.videoId === id).every(row => row.views === 1000));
  assert.equal(june.stats.views, null);
  assert.equal(june.stats.historicalViewsReference, 1250);
  assert.equal(june.stats.itemsSold, 0);
  assert.equal(octoberResult.stats.views, 1250);
  assert.equal(octoberResult.stats.itemsSold, 14);
  assert.deepEqual(june.promotions.map(row => [row.productId, row.views]).sort(), [['P1', null], ['P2', null]]);
  assert.deepEqual(june.promotions.map(row => [row.productId, row.historicalViewsReference]).sort(), [['P1', 1250], ['P2', 1000]]);
});

test('a lower same-period correction replaces period playback while retaining the historical reference peak', () => {
  const first = mergeImport(createEmptyState(), 'videos', [video()], { sourceName: 'first.xlsx', at: '2026-11-01T00:00:00.000Z' }).state;
  const untouched = structuredClone(first);
  const result = mergeImport(first, 'videos', [video({ itemsSold: 4, views: 600 })], { sourceName: 'correction.xlsx' }).state;
  assert.deepEqual(first, untouched);
  assert.equal(result.videos[0].views, 600);
  assert.equal(result.videos[0].itemsSold, 4);
  assert.equal(result.videoViewMaxima[0].views, 1000);
  assert.equal(result.videoViewMaxima[0].sourceFile, 'first.xlsx');
  assert.equal(deriveData(result).stats.views, 600);
  assert.equal(deriveData(result).stats.historicalViewsReference, 1000);
  assert.equal(deriveData(result).stats.itemsSold, 4);
});

test('full-period replacement preserves peaks for removed videos without resurrecting their publications', () => {
  const original = mergeImport(createEmptyState(), 'videos', [video(), video({ videoId: otherId, views: 2000 })]).state;
  const replaced = mergeImport(original, 'videos', [video({ videoId: otherId, views: 300, itemsSold: 3 })], { replacePeriod: true }).state;
  assert.equal(replaced.videos.length, 1);
  assert.equal(replaced.videoViewMaxima.length, 2);
  assert.equal(deriveData(replaced).stats.videoCount, 1);
  assert.equal(deriveData(replaced).stats.views, 300);
  assert.equal(deriveData(replaced).stats.historicalViewsReference, 2000);
  const returned = mergeImport(replaced, 'videos', [video({ ...nextPeriod, views: 500, itemsSold: 2 })]).state;
  assert.equal(deriveData(returned).stats.views, 800);
  assert.equal(deriveData(returned).stats.historicalViewsReference, 3000);
  assert.equal(deriveData(returned).stats.videoCount, 2);
  assert.equal(deriveData(returned).stats.itemsSold, 5);
});

test('overlapping-period replacement retains old peaks, and rejected overlap does not mutate input', () => {
  const state = mergeImport(createEmptyState(), 'videos', [video()]).state;
  const original = structuredClone(state);
  const replacement = video({ reportMonth: '', periodStart: '2026-10-01', periodEnd: '2026-11-30', itemsSold: 15, views: 500 });
  assert.throws(() => mergeImport(state, 'videos', [replacement]), error => error.code === 'OVERLAPPING_PERIOD');
  assert.deepEqual(state, original);
  const result = mergeImport(state, 'videos', [replacement], { replaceOverlapping: true }).state;
  assert.equal(result.videos[0].views, 500);
  assert.equal(deriveData(result).stats.views, 500);
  assert.equal(deriveData(result).stats.historicalViewsReference, 1000);
  assert.equal(deriveData(result).stats.itemsSold, 15);
});

test('historical lower-sales higher-view rows independently establish the peak and keep the sales winner coherent', () => {
  const state = createEmptyState();
  state.pendingVideoImports = [pending([video({ itemsSold: 500, views: 1000, gmv: 50, sourceRow: 2 }), video({ itemsSold: 480, views: 9000, gmv: 99, sourceRow: 3 })])];
  const result = confirmHistoricalBaseline(state, 'pending', { cutoffDate: '2026-10-31' }).state;
  const winner = result.videoBaselines[0].records[0];
  assert.equal(winner.itemsSold, 500);
  assert.equal(winner.gmv, 50);
  assert.equal(winner.views, 1000);
  assert.equal(winner.sourceRow, 2);
  assert.equal(result.videoViewMaxima[0].views, 9000);
  assert.equal(result.videoViewMaxima[0].sourceRow, 3);
  assert.equal(deriveData(result).stats.views, null);
  assert.equal(deriveData(result).stats.historicalViewsReference, 9000);
  assert.equal(deriveData(result, { month: '2026-06' }).stats.views, null);
  assert.equal(deriveData(result, { month: '2026-06' }).stats.historicalViewsReference, 9000);
  assert.equal(deriveData(result).stats.itemsSold, 500);
});

test('accepted pending duplicate rows preserve their highest view observation before sales deduplication', () => {
  const state = createEmptyState();
  state.pendingVideoImports = [pending([video({ views: 9000, itemsSold: 20 }), video({ views: 600, itemsSold: 10 })])];
  const result = confirmPendingVideoImport(state, 'pending', october).state;
  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0].views, 600);
  assert.equal(result.videos[0].itemsSold, 10);
  assert.equal(result.videoViewMaxima[0].views, 9000);
  assert.equal(deriveData(result).stats.views, 9000);
});

test('other pending observations stay transient through unrelated accepted imports and disappear on dismissal', () => {
  const state = mergeImport(createEmptyState(), 'videos', [video()]).state;
  state.pendingVideoImports = [pending([video({ views: 50000, itemsSold: 99999 })])];
  assert.equal(deriveData(state).stats.views, 1000);
  assert.equal(deriveData(state).stats.historicalViewsReference, 50000);
  assert.equal(deriveData(state).stats.itemsSold, 10);
  const updated = mergeImport(state, 'videos', [video({ ...nextPeriod, views: 600, itemsSold: 2 })]).state;
  assert.equal(updated.videoViewMaxima[0].views, 1000);
  assert.equal(deriveData(updated).stats.views, 1600);
  assert.equal(deriveData(updated).stats.historicalViewsReference, 50000);
  updated.pendingVideoImports[0].status = 'dismissed';
  assert.equal(deriveData(updated).stats.views, 1600);
  assert.equal(deriveData(updated).stats.historicalViewsReference, 1000);
  assert.equal(deriveData(updated).stats.itemsSold, 12);
});

test('old active baseline and archive losing rows are read without a data migration', () => {
  const state = createEmptyState();
  state.videoBaselines = [{ id: 'old', active: true, cutoffDate: '2026-10-31', records: [video({ views: 1000, itemsSold: 500 })], sourceDuplicateRows: [video({ views: 9000, itemsSold: 480 })] }];
  state.videoReportArchives = [{ records: [video({ views: 5000 })], sourceDuplicateRows: [video({ views: 10000 })] }];
  const original = structuredClone(state), result = deriveData(state);
  assert.deepEqual(state, original);
  assert.equal(state.videoViewMaxima.length, 0);
  assert.equal(result.stats.views, 10000);
  assert.equal(result.stats.itemsSold, 500);
});

test('sample views sum distinct linked video peaks and creator preference snapshots retain their separate meaning', () => {
  const state = createEmptyState();
  state.samples = [{ orderId: 'O1', creatorId: 'creator', productId: 'P1', date: '2026-05-01', quantity: 2, videoIds: [id, id, otherId] }];
  state.videos = [video(), video({ productId: 'P2', views: 800, itemsSold: 5 }), video({ videoId: otherId, views: 250 })];
  state.preferences = [{ creatorId: 'creator', latestViews: 777, latestViewsAsOf: '2026-10-20' }];
  const all = deriveData(state), may = deriveData(state, { month: '2026-05' });
  assert.equal(all.samples[0].views, 1250);
  assert.equal(may.samples[0].views, 1250);
  assert.equal(may.samples[0].itemsSold, 0);
  assert.equal(all.creators[0].views, 777);
  assert.equal(all.creators[0].cooperationCount, 2);
  const next = mergeImport(state, 'preferences', [{ creatorId: 'creator', latestViews: 600, latestViewsAsOf: '2026-10-25' }]).state;
  assert.equal(deriveData(next).creators[0].views, 600);
  assert.equal(deriveData(next).stats.views, 1250);
});

test('missing PID and publication dates do not hide confirmed playback periods, and inactive reports do not contribute', () => {
  const state = createEmptyState();
  state.videos = [video({ productId: '', excludedFromMetrics: true }), video({ videoId: otherId, postDate: '', views: 300 })];
  state.pendingVideoImports = [pending([video({ views: 90000 })], { active: false }), pending([video({ views: 80000 })], { id: 'dismissed', status: 'dismissed' })];
  const all = deriveData(state), june = deriveData(state, { month: '2026-06' });
  assert.equal(all.stats.views, 1300);
  assert.equal(june.stats.views, null);
  assert.equal(june.stats.historicalViewsReference, 1000);
  assert.equal(deriveData(state, { month: '2026-10' }).stats.views, 1300);
  assert.equal(all.stats.itemsSold, 10);
  assert.equal(june.promotions.length, 0);
  assert.equal(all.stats.undatedVideoCount, 1);
});

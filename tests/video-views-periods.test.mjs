import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData, guessMappings, mergeImport, normalizeRows } from '../lib/creator-engine.mjs';
import { stageVideoImport } from '../lib/video-staging.mjs';
import { confirmPendingVideoImport } from '../lib/video-periods.mjs';
import { confirmVideoReportViewsPeriod, deriveVideoViews, parseVideoViewCount, summarizeVideoViews } from '../lib/video-views.mjs';

const video = (changes = {}) => ({ videoId: '7000000000000000001', creatorId: 'creator', productId: 'P1', postDate: '2026-08-10', periodStart: '2026-10-01', periodEnd: '2026-10-31', reportMonth: '2026-10', itemsSold: 10, views: 100, ...changes });
const stateWith = rows => ({ ...createEmptyState(), creators: [{ creatorId: 'creator' }], videos: rows });
const publication = (records, changes = {}) => ({ id: 'pub', status: 'publication_only', reportPurpose: 'publication', records, ...changes });
const viewsPeriod = (start, end) => ({ viewsKind: 'period', viewsPeriodStart: start, viewsPeriodEnd: end });

test('video view normalization accepts K/M and decimal commas without changing numeric sales', () => {
  for (const [raw, expected] of [['47.5K', 47500], ['47,5K', 47500], ['10.k', 10000], ['1.7M', 1700000], ['1,700', 1700], ['1.700', 1700], ['1.700,5', 1700.5], ['0', 0], ['', null], ['N/A', null], [-1, null]]) assert.equal(parseVideoViewCount(raw), expected, String(raw));
  const headers = ['Video ID', 'Creator name', 'Product ID', '视频观看次数', 'Items sold'];
  const result = normalizeRows('videos', [['7000000000000000001', 'creator', 'P1', '47,5K', '12']], guessMappings(headers, 'videos'), { month: '2026-10' });
  assert.equal(result.records[0].views, 47500);
  assert.equal(result.records[0].itemsSold, 12);
  assert.equal(guessMappings(['Video ID', '视频播放量'], 'videos').views, '1');
});

test('same video and exact playback period deduplicate across report purposes and PIDs', () => {
  const state = stateWith([video(), video({ productId: 'P2', views: 90 })]);
  state.pendingVideoImports = [publication([video({ views: 150, itemsSold: 999 })], viewsPeriod('2026-10-01', '2026-10-31'))];
  const result = deriveData(state, { month: '2026-10' });
  assert.equal(result.stats.views, 150);
  assert.equal(result.stats.itemsSold, 20);
  assert.equal(result.stats.videoCount, 0);
  assert.deepEqual(result.promotions, []); // The only publication rows are August posts.
  assert.equal(result.stats.promotionViews, 0);
  assert.ok(result.issues.some(issue => issue.type === 'videoViewsValueConflict'));
});

test('nonoverlapping playback periods add independently of creator tendency average', () => {
  const state = stateWith([video(viewsPeriod('2026-10-01', '2026-10-10')), video({ ...viewsPeriod('2026-10-15', '2026-10-20'), views: 20 })]);
  state.preferences = [{ creatorId: 'creator', latestViews: 77, latestViewsAsOf: '2026-10-25' }];
  const result = deriveData(state, { month: '2026-10' });
  assert.equal(result.stats.views, 120);
  assert.equal(result.stats.viewsCoverageStatus, 'partial');
  assert.equal(result.creators[0].cumulativeVideoViews, 120);
  assert.equal(result.creators[0].views, 77);
});

test('full playback period replaces contained intervals once and flags an inconsistent lower value', () => {
  const ledger = deriveVideoViews(stateWith([video(viewsPeriod('2026-10-01', '2026-10-10')), video({ ...viewsPeriod('2026-10-15', '2026-10-20'), views: 20 }), video({ views: 90 })]));
  assert.equal(summarizeVideoViews(ledger).value, 90);
  assert.equal(summarizeVideoViews(ledger, { month: '2026-10' }).status, 'complete');
  assert.ok(ledger.issues.some(issue => issue.type === 'videoViewsContainmentConflict'));
});

test('partial overlap stays missing globally, per creator and per PID rather than inventing a sum', () => {
  const state = stateWith([video(viewsPeriod('2026-10-01', '2026-10-20')), video({ ...viewsPeriod('2026-10-15', '2026-10-31'), productId: 'P2', views: 60 })]);
  const result = deriveData(state, { month: '2026-10' });
  assert.equal(result.stats.views, null);
  assert.equal(result.stats.viewsCoverageStatus, 'needs_review');
  assert.equal(result.stats.viewsOverlapVideoCount, 1);
  assert.equal(result.creators[0].cumulativeVideoViews, null);
  assert.ok(result.promotions.every(row => row.views === null));
  assert.ok(result.issues.some(issue => issue.type === 'overlappingVideoViewsPeriod'));
});

test('cross-month coverage can replace cumulative detail while separate monthly observations remain visible', () => {
  const state = stateWith([video(viewsPeriod('2026-09-01', '2026-09-30')), video({ views: 200 }), video({ ...viewsPeriod('2026-09-01', '2026-10-31'), views: 350 })]);
  assert.equal(deriveData(state).stats.views, 350);
  assert.equal(deriveData(state, { month: '2026-09' }).stats.views, 100);
  assert.equal(deriveData(state, { month: '2026-10' }).stats.views, 200);
  const onlyCrossMonth = stateWith([video(viewsPeriod('2026-09-01', '2026-10-31'))]);
  assert.equal(deriveData(onlyCrossMonth).stats.views, 100);
  assert.equal(deriveData(onlyCrossMonth, { month: '2026-10' }).stats.views, null);
  assert.equal(deriveData(onlyCrossMonth, { month: '2026-10' }).stats.crossMonthViewsVideoCount, 1);
});

test('unknown publication periods and all-source maxima stay references while the accepted baseline enters only creator lifetime playback', () => {
  const state = stateWith([]);
  state.videoBaselines = [{ id: 'baseline', cutoffDate: '2026-09-30', records: [video({ views: 900 })] }];
  state.videoViewMaxima = [video({ views: 1000 })];
  state.pendingVideoImports = [publication([video({ views: 1200 })])];
  const original = structuredClone(state), result = deriveData(state);
  assert.equal(result.stats.views, null);
  assert.equal(result.stats.viewsAvailable, false);
  assert.equal(result.stats.unconfirmedViewsReportCount, 1);
  assert.equal(result.stats.historicalViewsReference, 1200);
  assert.equal(result.creators[0].cumulativeVideoViews, 900);
  assert.equal(result.creators[0].cumulativeVideoViewsBaseline, 900);
  assert.equal(result.creators[0].cumulativeVideoViewsPeriodTotal, null);
  assert.deepEqual(state, original);
});

test('a reported zero is available, unlike an absent playback observation', () => {
  const zero = deriveData(stateWith([video({ views: 0 })]));
  const missing = deriveData(stateWith([video({ views: undefined })]));
  assert.equal(zero.stats.views, 0); assert.equal(zero.stats.viewsAvailable, true);
  assert.equal(missing.stats.views, null); assert.equal(missing.stats.viewsAvailable, false);
});

test('playback of an earlier publication stays in actual views but does not enter the current publication-month promotion', () => {
  const state = stateWith([]);
  state.pendingVideoImports = [publication([video({ productId: 'PLAYBACK', itemsSold: 999 })], viewsPeriod('2026-10-01', '2026-10-31'))];
  const result = deriveData(state, { month: '2026-10' });
  assert.ok(result.months.includes('2026-10'));
  assert.equal(result.stats.itemsSold, 0); assert.equal(result.stats.videoCount, 0);
  assert.equal(result.stats.views, 100);
  assert.equal(result.promotions.some(row => row.productId === 'PLAYBACK'), false);
  assert.equal(result.stats.promotionViews, 0);
});

test('explicit playback dates override the view period without changing actual sales dates', () => {
  const state = mergeImport(stateWith([]), 'videos', [video()], viewsPeriod('2026-11-01', '2026-11-30')).state;
  assert.equal(state.videos[0].periodStart, '2026-10-01');
  assert.equal(deriveData(state, { month: '2026-10' }).stats.itemsSold, 10);
  assert.equal(deriveData(state, { month: '2026-10' }).stats.views, null);
  assert.equal(deriveData(state, { month: '2026-11' }).stats.views, 100);
});

test('publication confirmation overrides row unknown or obsolete dates without reimporting sales', () => {
  for (const row of [video({ viewsKind: 'unconfirmed' }), video(viewsPeriod('2026-09-01', '2026-09-30'))]) {
    const state = stateWith([]); state.pendingVideoImports = [publication([row])];
    const original = structuredClone(state);
    const confirmed = confirmVideoReportViewsPeriod(state, 'pub', viewsPeriod('2026-10-01', '2026-10-31'));
    assert.equal(deriveData(confirmed.state, { month: '2026-10' }).stats.views, 100);
    assert.equal(deriveData(confirmed.state).stats.itemsSold, 0);
    assert.deepEqual(confirmed.state.pendingVideoImports[0].records, original.pendingVideoImports[0].records);
    assert.equal(confirmVideoReportViewsPeriod(confirmed.state, 'pub', viewsPeriod('2026-10-01', '2026-10-31')).state, confirmed.state);
    const corrected = confirmVideoReportViewsPeriod(confirmed.state, 'pub', viewsPeriod('2026-11-01', '2026-11-30')).state;
    assert.equal(deriveData(corrected, { month: '2026-10' }).stats.views, null);
    assert.equal(deriveData(corrected, { month: '2026-11' }).stats.views, 100);
    assert.deepEqual(state, original);
  }
});

test('publication imports keep playback metadata at report level and replay does not duplicate', () => {
  const context = { reportPurpose: 'publication', sourceHash: 'publication-views', sheetName: 'Videos', ...viewsPeriod('2026-10-01', '2026-10-31') };
  const first = stageVideoImport(stateWith([]), [video()], context);
  assert.equal(first.state.pendingVideoImports[0].viewsPeriodStart, '2026-10-01');
  assert.equal(first.state.pendingVideoImports[0].records[0].viewsPeriodStart, undefined);
  assert.equal(deriveData(first.state).stats.views, 100);
  assert.equal(deriveData(first.state).stats.itemsSold, 0);
  assert.equal(stageVideoImport(first.state, [video()], context).state, first.state);
});

test('sales corrections with a different playback period retain only the compact earlier playback observation', () => {
  const first = mergeImport(stateWith([]), 'videos', [video()], viewsPeriod('2026-10-01', '2026-10-10')).state;
  const updated = mergeImport(first, 'videos', [video({ views: 20, itemsSold: 4, raw: { huge: 'not archived' } })], viewsPeriod('2026-10-15', '2026-10-20')).state;
  assert.equal(updated.videos.length, 1);
  assert.equal(deriveData(updated).stats.itemsSold, 4);
  assert.equal(deriveData(updated).stats.views, 120);
  assert.equal(updated.videoViewsArchives.length, 1);
  assert.equal(updated.videoViewsArchives[0].raw, undefined);
  const corrected = mergeImport(updated, 'videos', [video({ views: 30, itemsSold: 4 })], viewsPeriod('2026-10-01', '2026-10-10')).state;
  assert.equal(deriveData(corrected).stats.views, 50);
  assert.equal(corrected.videoViewsArchives.some(row => row.views === 100), false);
});

test('a cross-month sales replacement preserves explicit old monthly playback detail', () => {
  const september = { periodStart: '2026-09-01', periodEnd: '2026-09-30', reportMonth: '2026-09' };
  const first = mergeImport(stateWith([]), 'videos', [video(september), video({ views: 200 })]).state;
  const updated = mergeImport(first, 'videos', [video({ periodStart: '2026-09-01', periodEnd: '2026-10-31', reportMonth: '', views: 350, itemsSold: 25 })], { replaceOverlapping: true }).state;
  assert.equal(deriveData(updated).stats.views, 350);
  assert.equal(deriveData(updated).stats.itemsSold, 25);
  assert.equal(deriveData(updated, { month: '2026-09' }).stats.views, 100);
  assert.equal(deriveData(updated, { month: '2026-10' }).stats.views, 200);
});

test('duplicate raw playback observations survive sales deduplication and a later correction can decrease them', () => {
  for (const staged of [false, true]) {
    const rows = [video({ views: 900, itemsSold: 20 }), video({ views: 60, itemsSold: 4 })];
    let state;
    if (staged) { const pending = stageVideoImport(stateWith([]), rows, { sourceHash: 'pending-duplicates' }); state = confirmPendingVideoImport(pending.state, pending.summary.pendingImportId, { rangeStart: '2026-10-01', rangeEnd: '2026-10-31' }).state; }
    else state = mergeImport(stateWith([]), 'videos', rows).state;
    assert.equal(state.videos[0].views, 60);
    assert.equal(deriveData(state).stats.views, 900);
    assert.equal(deriveData(state).stats.itemsSold, 4);
    state = mergeImport(state, 'videos', [video({ views: 30, itemsSold: 3 })]).state;
    assert.equal(deriveData(state).stats.views, 30);
    assert.equal(deriveData(state).stats.itemsSold, 3);
  }
});

test('inactive publication and compact observation sources cannot contribute views', () => {
  const state = stateWith([]);
  state.pendingVideoImports = [publication([video()], { ...viewsPeriod('2026-10-01', '2026-10-31'), status: 'dismissed' })];
  state.videoViewsArchives = [video({ ...viewsPeriod('2026-10-01', '2026-10-31'), active: false })];
  assert.equal(deriveData(state).stats.views, null);
});

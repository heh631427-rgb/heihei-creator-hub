import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData, guessMappings, mergeImport, normalizeRows } from '../lib/creator-engine.mjs';

const row = (changes = {}) => ({ videoId: 'video1', creatorId: 'creator', productId: 'P1', postDate: '2026-08-10', periodStart: '2026-10-01', periodEnd: '2026-10-31', reportMonth: '2026-10', reportPurpose: 'sales', itemsSold: 10, gmv: 10.20, views: 100, ...changes });
const fixture = (rows = []) => ({ ...createEmptyState(), creators: [{ creatorId: 'creator', historicalGmv: 999999 }], videos: rows });
const publication = records => ({ id: 'pub', status: 'publication_only', reportPurpose: 'publication', viewsKind: 'period', viewsPeriodStart: '2026-10-01', viewsPeriodEnd: '2026-10-31', records });

test('creator GMV adds its confirmed historical base and sales periods; monthly figures stay monthly', () => {
  const state = fixture([row(), row({ periodStart: '2026-11-01', periodEnd: '2026-11-30', reportMonth: '2026-11', itemsSold: 1, gmv: 0.30 })]);
  state.videoBaselines = [{ id: 'baseline', cutoffDate: '2026-09-30', records: [row({ itemsSold: 500, gmv: 100.10 })] }];
  state.pendingVideoImports = [publication([row({ gmv: 999999, itemsSold: 999999 })])];
  state.videoReportArchives = [{ id: 'old-month', periodStart: '2026-09-01', periodEnd: '2026-09-30', records: [row({ periodStart: '2026-09-01', periodEnd: '2026-09-30', reportMonth: '2026-09', gmv: 90 })] }];
  const original = structuredClone(state), all = deriveData(state), october = deriveData(state, { month: '2026-10' }), november = deriveData(state, { month: '2026-11' });
  assert.equal(all.creators[0].lifetimeGmv, 110.60);
  assert.equal(all.creators[0].gmvAvailable, true);
  assert.equal(all.creators[0].gmvCoverageStatus, 'complete');
  assert.equal(all.creators[0].gmvRecordCount, 3);
  assert.equal(all.creators[0].lifetimeItemsSold, 511);
  assert.equal(october.creators[0].lifetimeGmv, 110.60);
  assert.equal(october.stats.gmv, 10.20);
  assert.equal(october.promotions.length, 0); // Its supplied publication is an August post, not an October publication.
  assert.equal(october.stats.promotionItemsSold, 0);
  assert.equal(november.stats.gmv, 0.30);
  assert.equal(november.stats.promotionItemsSold, null); // Sales reports remain lifetime input, not a substitute publication report.
  assert.match(all.creators[0].gmvSource, /Affiliate video-attributed GMV.*2026-09-30/);
  assert.deepEqual(state, original);
});

test('same-period correction updates GMV once, another month adds, and explicit zero can replace', () => {
  let state = mergeImport(fixture(), 'videos', [row({ gmv: 50.10 })]).state;
  state = mergeImport(state, 'videos', [row({ gmv: 60.20 })]).state;
  assert.equal(state.videos.length, 1);
  assert.equal(deriveData(state).creators[0].lifetimeGmv, 60.20);
  state = mergeImport(state, 'videos', [row({ periodStart: '2026-11-01', periodEnd: '2026-11-30', reportMonth: '2026-11', gmv: 5.10 })]).state;
  assert.equal(deriveData(state).creators[0].lifetimeGmv, 65.30);
  state = mergeImport(state, 'videos', [row({ gmv: 0 })]).state;
  assert.equal(deriveData(state).creators[0].lifetimeGmv, 5.10);
  assert.equal(deriveData(state, { month: '2026-10' }).stats.gmv, 0);
});

test('unprovided GMV is not zero; partial coverage and a genuinely reported zero are distinct', () => {
  const missing = deriveData(fixture([row({ gmv: undefined })])).creators[0];
  assert.equal(missing.lifetimeGmv, null);
  assert.equal(missing.gmvAvailable, false);
  assert.equal(missing.gmvCoverageStatus, 'unavailable');
  assert.equal(missing.gmvMissingRecords, 1);
  const partial = deriveData(fixture([row({ gmv: 0 }), row({ videoId: 'video2', gmv: null })])).creators[0];
  assert.equal(partial.lifetimeGmv, 0);
  assert.equal(partial.gmvAvailable, true);
  assert.equal(partial.gmvCoverageStatus, 'partial');
  assert.equal(partial.gmvMissingRecords, 1);
  const zero = deriveData(fixture([row({ gmv: 0 })])).creators[0];
  assert.equal(zero.gmvCoverageStatus, 'complete');
  assert.equal(zero.lifetimeGmv, 0);
});

test('the exact Affiliate video-attributed GMV column accepts export amounts and retains invalid as missing', () => {
  const headers = ['Video ID', 'Creator name', 'Product ID', 'Affiliate video-attributed GMV'];
  const mapping = guessMappings(headers, 'videos');
  assert.equal(mapping.gmv, '3');
  const normalized = normalizeRows('videos', [['video1', 'creator', 'P1', '€ 1.234,56'], ['video2', 'creator', 'P1', 'not available'], ['video3', 'creator', 'P1', 0]], mapping, { month: '2026-10', reportPurpose: 'sales' });
  assert.equal(normalized.records[0].gmv, 1234.56);
  assert.equal(normalized.records[1].gmv, undefined);
  assert.equal(normalized.records[2].gmv, 0);
  assert.ok(normalized.warnings.some(message => /GMV/.test(message)));
});

test('creator playback uses only sales reports while promotion keeps only the publication-month cohort', () => {
  const state = fixture([row(), row({ periodStart: '2026-11-01', periodEnd: '2026-11-30', reportMonth: '2026-11', views: 50 })]);
  state.pendingVideoImports = [publication([row({ views: 900, gmv: 999 }), row({ videoId: 'video2', views: 150, gmv: 999 })])];
  const october = deriveData(state, { month: '2026-10' });
  assert.equal(october.creators[0].cumulativeVideoViews, 150);
  assert.match(october.creators[0].cumulativeVideoViewsSource, /出单视频报表/);
  assert.equal(october.stats.views, 1050);
  assert.equal(october.promotions.length, 0);
  assert.equal(october.stats.promotionViews, 0);
  assert.equal(deriveData(state, { month: '2026-11' }).stats.views, 50);
  assert.equal(october.creators[0].lifetimeGmv, 20.40);
});

test('confirmed sales archives after the historical cutoff add playback, but publication or unconfirmed sources do not enter creator totals', () => {
  const state = fixture([row()]);
  state.videoBaselines = [{ id: 'base', cutoffDate: '2026-08-31', records: [row({ views: 999999 })] }];
  state.videoReportArchives = [
    { id: 'old-sales', periodStart: '2026-09-01', periodEnd: '2026-09-30', records: [row({ periodStart: '2026-09-01', periodEnd: '2026-09-30', reportMonth: '2026-09', views: 20 })] },
    { id: 'old-publication', reportPurpose: 'publication', viewsKind: 'period', viewsPeriodStart: '2026-11-01', viewsPeriodEnd: '2026-11-30', records: [row({ views: 999 })] },
  ];
  state.pendingVideoImports = [{ id: 'pending-sales', status: 'period_unconfirmed', viewsKind: 'period', viewsPeriodStart: '2026-12-01', viewsPeriodEnd: '2026-12-31', records: [row({ views: 888 })] }];
  const creator = deriveData(state).creators[0];
  assert.equal(creator.cumulativeVideoViews, 1000119);
  assert.equal(creator.cumulativeVideoViewsBaseline, 999999);
  assert.equal(creator.cumulativeVideoViewsPeriodTotal, 120);
  assert.equal(creator.lifetimeGmv, 20.40);
});

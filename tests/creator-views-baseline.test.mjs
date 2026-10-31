import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData, mergeImport } from '../lib/creator-engine.mjs';
import { deriveVideoViews, summarizeVideoViews } from '../lib/video-views.mjs';

const row = (changes = {}) => ({ videoId: 'videoA', creatorId: 'creator', productId: 'P1', postDate: '2026-08-10', itemsSold: 3, gmv: 30, views: 10, periodStart: '2026-10-01', periodEnd: '2026-10-31', reportMonth: '2026-10', reportPurpose: 'sales', ...changes });
const baseline = (changes = {}) => ({ id: 'baseline', cutoffDate: '2026-09-30', records: [row({ itemsSold: 100, gmv: 1000, views: 200 })], ...changes });
const fixture = (changes = {}) => ({ ...createEmptyState(), creators: [{ creatorId: 'creator' }], videoBaselines: [baseline()], videos: [row()], videoReportArchives: [{ id: 'september', records: [row({ periodStart: '2026-09-01', periodEnd: '2026-09-30', reportMonth: '2026-09', views: 50, itemsSold: 20, gmv: 200 })] }], ...changes });
const creator = state => deriveData(state).creators[0];

test('creator playback adds historical balance once and excludes already included September without changing monthly metrics, sales or GMV', () => {
  const state = fixture(), original = structuredClone(state), data = deriveData(state), result = data.creators[0];
  assert.equal(result.cumulativeVideoViews, 210);
  assert.equal(result.cumulativeVideoViewsBaseline, 200);
  assert.equal(result.cumulativeVideoViewsPeriodTotal, 10);
  assert.equal(result.cumulativeVideoViewsBaselineCutoff, '2026-09-30');
  assert.equal(result.cumulativeVideoViewsCoverageStatus, 'confirmed');
  assert.match(result.cumulativeVideoViewsCoverage, /截止日及以前的已含期间未重复累加/);
  assert.equal(result.lifetimeItemsSold, 103);
  assert.equal(result.lifetimeGmv, 1030);
  assert.equal(result.level, 5);
  assert.equal(data.stats.views, 60);
  assert.equal(deriveData(state, { month: '2026-09' }).stats.views, 50);
  assert.equal(deriveData(state, { month: '2026-10' }).stats.views, 10);
  assert.deepEqual(state, original);
});

test('another actual period adds while a repeated same-period import does not increase creator playback', () => {
  let state = mergeImport(fixture(), 'videos', [row()]).state;
  assert.equal(creator(state).cumulativeVideoViews, 210);
  state = mergeImport(state, 'videos', [row({ periodStart: '2026-11-01', periodEnd: '2026-11-30', reportMonth: '2026-11', views: 5, itemsSold: 1, gmv: 10 })]).state;
  assert.equal(creator(state).cumulativeVideoViews, 215);
  assert.equal(creator(state).cumulativeVideoViewsPeriodTotal, 15);
  state = mergeImport(state, 'videos', [row({ periodStart: '2026-11-01', periodEnd: '2026-11-30', reportMonth: '2026-11', views: 5, itemsSold: 1, gmv: 10 })]).state;
  assert.equal(creator(state).cumulativeVideoViews, 215);
});

test('historical playback takes the per-video maximum across PIDs and losing source rows, then sums different video IDs regardless of post month', () => {
  const state = fixture({ videos: [], videoReportArchives: [], videoBaselines: [baseline({
    records: [row({ views: 100 }), row({ productId: 'P2', views: 150 }), row({ videoId: 'videoB', postDate: '2025-10-12', views: 50 })],
    sourceDuplicateRows: [row({ views: 200, itemsSold: 1, pendingPeriod: true, periodStatus: 'unconfirmed', reportPurpose: 'pending', viewsKind: 'unconfirmed' })],
  })] });
  const original = structuredClone(state), result = creator(state);
  assert.equal(result.cumulativeVideoViewsBaseline, 250);
  assert.equal(result.cumulativeVideoViews, 250);
  assert.equal(result.cumulativeVideoViewsPeriodTotal, null);
  assert.equal(summarizeVideoViews(deriveVideoViews(state, { sourceScope: 'sales', includeHistoricalBaseline: true })).baselineValue, 250);
  assert.deepEqual(state, original);
});

test('publication, pending, archived baseline and all-source historical maxima cannot inflate the accepted creator balance', () => {
  const state = fixture({
    videoViewMaxima: [{ videoId: 'videoA', views: 999999 }],
    pendingVideoImports: [
      { id: 'publication', status: 'publication_only', reportPurpose: 'publication', viewsKind: 'period', viewsPeriodStart: '2026-11-01', viewsPeriodEnd: '2026-11-30', records: [row({ views: 888888 })] },
      { id: 'pending', status: 'period_unconfirmed', records: [row({ views: 777777, pendingPeriod: true })] },
    ],
    videoReportArchives: [{ id: 'old-baseline', reportKind: 'historicalBaseline', records: [row({ views: 666666 })] }],
  });
  const result = creator(state);
  assert.equal(result.cumulativeVideoViews, 210);
  assert.equal(result.cumulativeVideoViewsBaseline, 200);
  assert.equal(result.historicalVideoViewsReference, 999999);
});

test('cross-cutoff periods are held for review before containment so a valid October child period still counts', () => {
  const state = fixture({ videos: [row(), row({ productId: 'P2', views: 90, viewsKind: 'period', viewsPeriodStart: '2026-09-15', viewsPeriodEnd: '2026-10-31' })] });
  const data = deriveData(state), result = data.creators[0];
  assert.equal(result.cumulativeVideoViews, 210);
  assert.equal(result.cumulativeVideoViewsPeriodTotal, 10);
  assert.equal(result.cumulativeVideoViewsBaselineOverlapVideoCount, 1);
  assert.equal(result.cumulativeVideoViewsCoverageStatus, 'needs_review');
  assert.match(result.cumulativeVideoViewsCoverage, /跨越历史底表截止日/);
  assert.ok(data.issues.some(issue => issue.type === 'videoViewsBaselineCutoffOverlap'));
  assert.equal(data.stats.views, null); // The ordinary ledger still flags the September archive's partial overlap.
});

test('absent or inactive historical baselines preserve the existing confirmed-period behavior', () => {
  for (const videoBaselines of [[], [baseline({ active: false })], [baseline({ status: 'archived' })], [baseline({ status: 'superseded' })], [baseline({ status: 'period_unconfirmed' })]]) {
    const result = creator(fixture({ videoBaselines }));
    assert.equal(result.cumulativeVideoViews, 60);
    assert.equal(result.cumulativeVideoViewsBaseline, null);
    assert.equal(result.cumulativeVideoViewsPeriodTotal, 60);
    assert.equal(result.cumulativeVideoViewsBaselineCutoff, '');
  }
});

test('explicit historical zero, missing historical playback and partial coverage remain distinct', () => {
  const zero = creator(fixture({ videos: [], videoReportArchives: [], videoBaselines: [baseline({ records: [row({ views: 0 })] })] }));
  assert.equal(zero.cumulativeVideoViews, 0);
  assert.equal(zero.cumulativeVideoViewsBaseline, 0);
  assert.equal(zero.cumulativeVideoViewsPeriodTotal, null);
  assert.equal(zero.cumulativeVideoViewsAvailable, true);
  const missingState = fixture({ videos: [], videoReportArchives: [], videoBaselines: [baseline({ records: [row({ views: undefined })] })] });
  const missing = creator(missingState);
  assert.equal(missing.cumulativeVideoViews, null);
  assert.equal(missing.cumulativeVideoViewsBaseline, null);
  assert.equal(missing.cumulativeVideoViewsAvailable, false);
  assert.equal(missing.cumulativeVideoViewsBaselineMissingVideoCount, 1);
  assert.match(missing.cumulativeVideoViewsCoverage, /缺少播放量，未按 0 填补/);
  const partial = creator({ ...missingState, videos: [row({ views: 5 })] });
  assert.equal(partial.cumulativeVideoViews, 5);
  assert.equal(partial.cumulativeVideoViewsBaseline, null);
  assert.equal(partial.cumulativeVideoViewsPeriodTotal, 5);
  assert.equal(partial.cumulativeVideoViewsCoverageStatus, 'partial');
});

test('different active baseline cutoffs and an invalid cutoff are visible review cases rather than silently confirmed coverage', () => {
  const multiple = creator(fixture({ videoBaselines: [baseline(), baseline({ id: 'later', cutoffDate: '2026-10-31', records: [row({ views: 100 })] })], videos: [row(), row({ periodStart: '2026-11-01', periodEnd: '2026-11-30', views: 5 })] }));
  assert.equal(multiple.cumulativeVideoViews, 205);
  assert.equal(multiple.cumulativeVideoViewsBaseline, 200);
  assert.equal(multiple.cumulativeVideoViewsBaselineCutoff, '');
  assert.equal(multiple.cumulativeVideoViewsCoverageStatus, 'needs_review');
  assert.match(multiple.cumulativeVideoViewsCoverage, /2026-09-30、2026-10-31/);
  const invalid = creator(fixture({ videoBaselines: [baseline({ cutoffDate: '' })] }));
  assert.equal(invalid.cumulativeVideoViewsBaseline, null);
  assert.equal(invalid.cumulativeVideoViews, 60);
  assert.equal(invalid.cumulativeVideoViewsCoverageStatus, 'needs_review');
});

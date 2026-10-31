import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData, mergeImport } from '../lib/creator-engine.mjs';

const video = (changes = {}) => ({ videoId: '7000000000000000001', productId: 'P1', creatorId: 'creator', postDate: '2026-06-15', itemsSold: 500, views: 1000, url: 'https://www.tiktok.com/@creator/video/7000000000000000001', ...changes });
const baseline = (records, changes = {}) => ({ id: 'history', active: true, cutoffDate: '2026-09-30', records, ...changes });
const junePeriod = { reportMonth: '2026-06', periodStart: '2026-06-01', periodEnd: '2026-06-30' };
const octoberPeriod = { reportMonth: '2026-10', periodStart: '2026-10-01', periodEnd: '2026-10-31' };

test('an old month displays its baseline publication cohort without inventing confirmed monthly sales', () => {
  const state = createEmptyState();
  state.samples = [{ creatorId: 'creator', productId: 'P1', orderId: 'O1', date: '2026-06-01', quantity: 1 }];
  state.preferences = [{ creatorId: 'creator', latestViews: 777 }];
  state.videoBaselines = [baseline([video(), video({ videoId: '7000000000000000002', postDate: '2026-07-01', itemsSold: 20 })])];
  const original = structuredClone(state), june = deriveData(state, { month: '2026-06' }), all = deriveData(state);
  assert.deepEqual(state, original);
  assert.equal(june.stats.itemsSold, 0);
  assert.equal(june.stats.displayItemsSold, 500);
  assert.equal(june.stats.displaySalesMode, 'historical-publication');
  assert.equal(june.stats.displaySalesCutoff, '2026-09-30');
  assert.equal(june.stats.displaySalesSource, '本月发布视频历史累计表现（截至2026-09-30）');
  assert.equal(june.promotions[0].itemsSold, 500);
  assert.equal(june.promotions[0].confirmedPeriodItemsSold, 0);
  assert.equal(june.promotions[0].historicalPublicationItemsSold, 500);
  assert.equal(june.promotions[0].salesDisplayMode, 'historical-publication');
  assert.equal(june.promotions[0].salesDisplayCutoff, '2026-09-30');
  assert.deepEqual(june.promotions[0].sellingCreators, ['creator']);
  assert.deepEqual(june.promotions[0].videoLinks, [video().url]);
  assert.equal(june.samples[0].itemsSold, 0);
  assert.equal(june.creators[0].itemsSold, 0);
  assert.equal(june.creators[0].lifetimeItemsSold, 520);
  assert.equal(june.creators[0].views, 777);
  assert.equal(all.stats.itemsSold, 520);
  assert.equal(all.stats.displayItemsSold, 520);
  assert.equal(all.stats.displaySalesMode, 'confirmed-total');
});

test('a real archived month including zero wins over both historical sources for the entire month', () => {
  const state = createEmptyState();
  state.videoBaselines = [baseline([video()])];
  state.videoReportArchives = [{ id: 'june', records: [video({ ...junePeriod, itemsSold: 0 })] }];
  state.promotions = [{ month: '2026-06', productId: 'P1', itemsSold: 100 }, { month: '2026-06', sku: 'unmapped', itemsSold: 999 }];
  const june = deriveData(state, { month: '2026-06' });
  assert.equal(june.stats.itemsSold, 0);
  assert.equal(june.stats.displayItemsSold, 0);
  assert.equal(june.stats.displaySalesMode, 'confirmed-period');
  assert.match(june.stats.displaySalesSource, /已归档/);
  assert.ok(june.promotions.every(row => row.itemsSold === 0 && row.salesDisplayMode === 'confirmed-period' && row.historicalPublicationItemsSold === null));
  assert.equal(deriveData(state).stats.displayItemsSold, 500);
});

test('confirmed rows waiting for a PID still prevent borrowing historical sales', () => {
  const state = createEmptyState();
  state.videoBaselines = [baseline([video()])];
  state.videos = [video({ ...junePeriod, videoId: '7000000000000000002', productId: '', excludedFromMetrics: true, itemsSold: 123 })];
  const june = deriveData(state, { month: '2026-06' });
  assert.equal(june.stats.displaySalesMode, 'confirmed-period');
  assert.equal(june.stats.itemsSold, 0);
  assert.equal(june.stats.displayItemsSold, 0);
  assert.equal(june.promotions[0].itemsSold, 0);
  assert.ok(june.issues.some(issue => issue.type === 'missingVideoProduct'));
});

test('discarded archives cannot override the historical reference, and an explicit empty monthly archive remains zero', () => {
  const state = createEmptyState();
  state.videoBaselines = [baseline([video()])];
  state.videoReportArchives = ['dismissed', 'rejected', 'deleted'].map(status => ({ id: status, status, records: [video({ ...junePeriod, itemsSold: 999 })] }));
  const june = deriveData(state, { month: '2026-06' });
  assert.equal(june.stats.itemsSold, 0);
  assert.equal(june.stats.displayItemsSold, 500);
  assert.equal(june.stats.displaySalesMode, 'historical-publication');
  state.videoReportArchives.push({ id: 'empty', ...junePeriod, records: [] });
  const emptyReport = deriveData(state, { month: '2026-06' });
  assert.equal(emptyReport.stats.displayItemsSold, 0);
  assert.equal(emptyReport.stats.displaySalesMode, 'confirmed-period');
});

test('an explicitly entered historical zero is retained per PID while other missing PIDs receive cohort reference', () => {
  const state = createEmptyState();
  state.videoBaselines = [baseline([video(), video({ productId: 'P2', itemsSold: 200 })])];
  state.promotions = [{ month: '2026-06', productId: 'P1', itemsSold: 0, sampleQuantity: 2, notes: '保留手工备注' }];
  const explicitZero = deriveData(state, { month: '2026-06' });
  assert.equal(explicitZero.stats.displaySalesMode, 'historical-promotion');
  assert.equal(explicitZero.stats.displayItemsSold, 0);
  assert.equal(explicitZero.promotions.find(row => row.productId === 'P1').itemsSold, 0);
  assert.equal(explicitZero.promotions.find(row => row.productId === 'P2').itemsSold, 200);
  assert.equal(explicitZero.stats.promotionItemsSold, 200);
  assert.equal(explicitZero.stats.promotionSalesMode, 'mixed-historical');
  for (const blank of [undefined, null, '']) {
    state.promotions[0].itemsSold = blank;
    const sampleOnly = deriveData(state, { month: '2026-06' });
    assert.equal(sampleOnly.stats.displaySalesMode, 'historical-publication');
    assert.equal(sampleOnly.stats.displayItemsSold, 700);
    assert.equal(sampleOnly.promotions.find(row => row.productId === 'P1').notes, '保留手工备注');
  }
  state.promotions[0].itemsSold = 42;
  const manual = deriveData(state, { month: '2026-06' });
  assert.equal(manual.stats.displayItemsSold, 42);
  assert.equal(manual.promotions.find(row => row.productId === 'P2').itemsSold, 200);
  assert.equal(manual.stats.promotionItemsSold, 242);
  assert.equal(manual.promotions.find(row => row.productId === 'P1').historicalItemsSold, 42);
});

test('cohort reference takes one baseline maximum per video and PID and uses the canonical publication date', () => {
  const state = createEmptyState();
  state.videoBaselines = [
    baseline([video({ itemsSold: 400 }), video({ productId: 'P2', itemsSold: 20 })]),
    baseline([video(), video({ itemsSold: 480 })], { id: 'other' }),
    baseline([video({ itemsSold: 9000 })], { id: 'inactive', active: false }),
  ];
  state.videos = [video({ ...octoberPeriod, postDate: '2026-07-01', itemsSold: 10 })];
  state.pendingVideoImports = [{ id: 'pending', status: 'period_unconfirmed', records: [video({ itemsSold: 99999 })] }];
  state.videoReportArchives = [{ reportKind: 'historicalBaseline', records: [video({ reportKind: 'historicalBaseline', itemsSold: 88888 })] }];
  const june = deriveData(state, { month: '2026-06' }), july = deriveData(state, { month: '2026-07' });
  assert.equal(june.stats.displayItemsSold, 0);
  assert.equal(july.stats.displayItemsSold, 520);
  assert.deepEqual(july.promotions.map(row => [row.productId, row.itemsSold]).sort(), [['P1', 500], ['P2', 20]]);
  assert.equal(july.stats.videoCount, 1);
  assert.equal(july.stats.itemsSold, 0);
});

test('undated, unresolved PID, and publications after their baseline cutoff do not receive invented cohort sales', () => {
  const state = createEmptyState();
  state.videoBaselines = [baseline([
    video({ postDate: '' }),
    video({ videoId: '7000000000000000002', productId: '', excludedFromMetrics: true }),
    video({ videoId: '7000000000000000003', postDate: '2026-09-20' }),
  ], { cutoffDate: '2026-09-15' })];
  state.pendingVideoImports = [{ id: 'future', status: 'period_unconfirmed', records: [video({ videoId: '7000000000000000004', postDate: '2026-10-01' })] }];
  const june = deriveData(state, { month: '2026-06' }), september = deriveData(state, { month: '2026-09' }), october = deriveData(state, { month: '2026-10' });
  assert.equal(june.stats.displayItemsSold, 0);
  assert.equal(september.stats.displayItemsSold, 0);
  assert.equal(september.stats.displaySalesCutoff, '2026-09-15');
  assert.equal(october.stats.videoCount, 1);
  assert.equal(october.stats.displaySalesMode, 'unavailable');
  assert.equal(october.stats.displayItemsSold, 0);
  assert.equal(october.stats.displaySalesCutoff, '');
});

test('later dated increments add only to confirmed totals and never to the old publication cohort', () => {
  const state = createEmptyState();
  state.videoBaselines = [baseline([video()])];
  state.promotions = [{ month: '2026-07', productId: 'P1', itemsSold: 3352 }];
  const updated = mergeImport(state, 'videos', [video({ ...octoberPeriod, itemsSold: 10 })]).state;
  const all = deriveData(updated), june = deriveData(updated, { month: '2026-06' }), july = deriveData(updated, { month: '2026-07' }), october = deriveData(updated, { month: '2026-10' });
  assert.equal(all.stats.itemsSold, 510);
  assert.equal(all.stats.displayItemsSold, 510);
  assert.equal(june.stats.itemsSold, 0);
  assert.equal(june.stats.displayItemsSold, 500);
  assert.equal(july.stats.itemsSold, 0);
  assert.equal(july.stats.displayItemsSold, 3352);
  assert.equal(july.stats.displaySalesMode, 'historical-promotion');
  assert.equal(october.stats.displayItemsSold, 10);
  assert.equal(october.stats.displaySalesMode, 'confirmed-period');
  assert.equal(all.creators[0].lifetimeItemsSold, 510);
});

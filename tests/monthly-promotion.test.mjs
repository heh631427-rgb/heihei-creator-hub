import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData } from '../lib/creator-engine.mjs';

const video = (changes = {}) => ({ videoId: 'v1', creatorId: 'creator', productId: 'P1', postDate: '2026-10-10', itemsSold: 10, views: 100, gmv: 20, url: 'https://www.tiktok.com/@creator/video/7000000000000000001', ...changes });
const publication = (records, changes = {}) => ({ id: 'pub', status: 'publication_only', reportPurpose: 'publication', viewsKind: 'period', viewsPeriodStart: '2026-10-01', viewsPeriodEnd: '2026-10-31', records, ...changes });
const sales = changes => video({ periodStart: '2026-10-01', periodEnd: '2026-10-31', reportMonth: '2026-10', reportPurpose: 'sales', ...changes });

test('publication report owns monthly promotion while sales-only videos and lifetime totals stay separate', () => {
  const state = createEmptyState(); state.creators = [{ creatorId: 'creator' }];
  state.videos = [sales({ itemsSold: 3, views: 50 }), sales({ videoId: 'sales-only', productId: 'P2', itemsSold: 7, views: 30 })];
  state.pendingVideoImports = [publication([video({ itemsSold: 12, views: 600 }), video({ videoId: 'old-post', postDate: '2026-08-10', itemsSold: 88, views: 900 })])];
  const original = structuredClone(state), data = deriveData(state, { month: '2026-10' });
  assert.equal(data.stats.itemsSold, 10); assert.equal(data.creators[0].lifetimeItemsSold, 10); assert.equal(data.creators[0].cumulativeVideoViews, 80);
  assert.equal(data.stats.promotionItemsSold, 12); assert.equal(data.stats.promotionViews, 600); assert.equal(data.stats.promotionVideoCount, 1);
  assert.equal(data.stats.promotionSalesMode, 'publication-period'); assert.deepEqual(data.promotions.map(row => row.productId), ['P1']);
  assert.equal(data.promotions[0].confirmedPeriodItemsSold, 3); assert.deepEqual(state, original);
});

test('unknown publication periods remain references and filenames cannot establish a monthly period', () => {
  const state = createEmptyState(); state.creators = [{ creatorId: 'creator' }]; state.videos = [sales({ itemsSold: 2, views: 8 })];
  state.pendingVideoImports = [publication([video({ itemsSold: 17, views: 700 })], { fileName: '20261001-20261031.xlsx', viewsKind: 'unconfirmed', viewsPeriodStart: '', viewsPeriodEnd: '' })];
  const data = deriveData(state, { month: '2026-10' });
  assert.equal(data.stats.promotionItemsSold, 17); assert.equal(data.stats.promotionViews, 700); assert.equal(data.stats.promotionSalesMode, 'publication-unconfirmed');
  assert.equal(data.stats.promotionViewsCoverageStatus, 'unconfirmed'); assert.equal(data.creators[0].lifetimeItemsSold, 2); assert.equal(data.creators[0].cumulativeVideoViews, 8);
  state.pendingVideoImports[0].viewsPeriodStart = '2026-10-01'; state.pendingVideoImports[0].viewsPeriodEnd = '2026-10-31';
  assert.equal(deriveData(state, { month: '2026-10' }).stats.promotionSalesMode, 'publication-unconfirmed');
});

test('legacy September publication metadata preserves archive playback in creator lifetime and missing dates do not invent publications', () => {
  const state = createEmptyState(); state.creators = [{ creatorId: 'creator' }];
  state.videoReportArchives = [{ id: 'sept', promotionReportPurpose: 'publication', promotionReportMonth: '2026-09', periodStart: '2026-09-01', periodEnd: '2026-09-30', records: [video({ postDate: '2026-09-10', periodStart: '2026-09-01', periodEnd: '2026-09-30', reportMonth: '2026-09', itemsSold: 4 }), video({ videoId: 'missing-date', postDate: '', periodStart: '2026-09-01', periodEnd: '2026-09-30', reportMonth: '2026-09', itemsSold: 6, views: 50 })] }];
  const data = deriveData(state, { month: '2026-09' });
  assert.equal(data.stats.promotionItemsSold, 10); assert.equal(data.stats.promotionViews, 150); assert.equal(data.stats.promotionVideoCount, 1); assert.equal(data.stats.promotionMissingPostDateCount, 1);
  assert.equal(data.creators[0].cumulativeVideoViews, 150);
});

test('same-period replacement including zero is authoritative; disjoint publication periods add without duplicating video views by PID', () => {
  const state = createEmptyState();
  state.pendingVideoImports = [publication([video({ itemsSold: 99, views: 999 })], { id: 'old', importedAt: '2026-11-01' }), publication([video({ itemsSold: 0, views: 0 })], { id: 'new', importedAt: '2026-11-02' })];
  const replaced = deriveData(state, { month: '2026-10' }); assert.equal(replaced.stats.promotionItemsSold, 0); assert.equal(replaced.stats.promotionViews, 0);
  state.pendingVideoImports = [publication([video(), video({ productId: 'P2', itemsSold: 2 })], { id: 'first', viewsPeriodEnd: '2026-10-15' }), publication([video({ itemsSold: 3, views: 40 })], { id: 'second', viewsPeriodStart: '2026-10-16' })];
  const combined = deriveData(state, { month: '2026-10' }); assert.equal(combined.stats.promotionItemsSold, 15); assert.equal(combined.stats.promotionViews, 140); assert.equal(combined.stats.promotionVideoCount, 1); assert.equal(combined.stats.promotionViewsCoverageStatus, 'complete');
});

test('partial overlap is not added; a known cross-month interval is labelled as cross-month reference', () => {
  const state = createEmptyState();
  state.pendingVideoImports = [publication([video()], { id: 'first', viewsPeriodEnd: '2026-10-20' }), publication([video()], { id: 'second', viewsPeriodStart: '2026-10-15' })];
  const overlap = deriveData(state, { month: '2026-10' }); assert.equal(overlap.stats.promotionItemsSold, null); assert.equal(overlap.stats.promotionViews, null); assert.equal(overlap.stats.promotionViewsCoverageStatus, 'needs_review');
  state.pendingVideoImports = [publication([video()], { viewsPeriodStart: '2026-09-28', viewsPeriodEnd: '2026-10-27' })];
  const cross = deriveData(state, { month: '2026-10' }); assert.equal(cross.stats.promotionSalesMode, 'publication-cross-month'); assert.match(cross.stats.promotionSalesSource, /跨月/); assert.equal(cross.stats.promotionItemsSold, 10); assert.equal(cross.stats.itemsSold, 0);
});

test('explicit monthly reports remain discoverable when every post date and playback value is missing', () => {
  const state = createEmptyState(); state.pendingVideoImports = [publication([video({ postDate: '', views: undefined, itemsSold: 7 })])];
  const all = deriveData(state), month = deriveData(state, { month: '2026-10' });
  assert.ok(all.months.includes('2026-10')); assert.equal(month.stats.promotionItemsSold, 7); assert.equal(month.stats.promotionVideoCount, 0); assert.equal(month.stats.promotionViews, null);
});

test('old playback gap fill uses baseline values and preserves genuine zero despite larger later observations', () => {
  const state = createEmptyState(); state.videoBaselines = [{ id: 'history', cutoffDate: '2026-09-30', records: [video({ postDate: '2026-08-10', views: 64498 }), video({ videoId: 'zero', productId: 'P2', postDate: '2026-08-11', views: 0, itemsSold: 0 })] }];
  state.videos = [sales({ postDate: '2026-08-10', views: 168481 })]; state.promotions = [{ month: '2026-08', productId: 'P1', itemsSold: null }, { month: '2026-08', productId: 'P2', itemsSold: 0 }];
  const august = deriveData(state, { month: '2026-08' });
  assert.equal(august.promotions.find(row => row.productId === 'P1').views, 64498); assert.equal(august.promotions.find(row => row.productId === 'P2').views, 0); assert.equal(august.promotions.find(row => row.productId === 'P2').viewsAvailable, true);
  assert.equal(august.stats.promotionViews, 64498); assert.equal(august.stats.promotionItemsSold, 10); assert.equal(deriveData(state).stats.itemsSold, 20);
});

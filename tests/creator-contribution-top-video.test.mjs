import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData } from '../lib/creator-engine.mjs';

const video = (videoId, itemsSold, patch = {}) => ({
  videoId, itemsSold, creatorId: 'creator', productId: 'P1',
  postDate: '2026-08-10', periodStart: '2026-10-01', periodEnd: '2026-10-31',
  reportMonth: '2026-10', reportPurpose: 'sales', views: 100, gmv: itemsSold * 2,
  url: `https://www.tiktok.com/@creator/video/${videoId}`, ...patch,
});
function fixture(videos = []) {
  const state = createEmptyState();
  state.samples = [{ orderId: 'sample-order', creatorId: 'creator', sku: 'SKU-A', productId: 'P1', quantity: 2, date: '2026-08-01' }];
  state.productMappings = [{ productId: 'P1', sku: 'SKU-A' }, { productId: 'P2', sku: 'SKU-B' }];
  state.videos = videos;
  return state;
}

test('zero-sales contribution keeps sample and video rows but has no highest-selling video', () => {
  const state = fixture([video('1001', 0), video('1002', 0)]), before = structuredClone(state);
  const result = deriveData(state), creator = result.creators[0], contribution = creator.productContributions[0];
  assert.equal(creator.productContributions.length, 1);
  assert.equal(contribution.productId, 'P1');
  assert.equal(contribution.itemsSold, 0); assert.equal(contribution.salesShare, 0);
  assert.equal(contribution.topVideoId, ''); assert.equal(contribution.topVideoUrl, ''); assert.equal(contribution.topVideoItemsSold, null);
  assert.equal(contribution.sampleLinked, true); assert.equal(contribution.sampleQuantity, 2);
  assert.equal(contribution.videoCount, 2); assert.equal(contribution.goodVideoCount, 0);
  assert.equal(creator.topProduct, null); assert.equal(creator.lifetimeItemsSold, 0); assert.equal(creator.level, 1);
  assert.equal(result.stats.itemsSold, 0); assert.equal(result.stats.videoCount, 2); assert.equal(result.stats.sampleQuantity, 2);
  assert.equal(result.samples.length, 1); assert.equal(result.videos.length, 2);
  assert.deepEqual(state, before);
});

test('mixed zero and positive sales select the highest positive video without removing zero rows', () => {
  const state = fixture([video('1000', 0), video('1001', 4), video('1002', 6), video('2000', 0, { productId: 'P2' })]);
  const result = deriveData(state), creator = result.creators[0];
  const positive = creator.productContributions.find(row => row.productId === 'P1'), zero = creator.productContributions.find(row => row.productId === 'P2');
  assert.equal(creator.productContributions.length, 2);
  assert.equal(positive.topVideoId, '1002'); assert.equal(positive.topVideoUrl, video('1002', 6).url); assert.equal(positive.topVideoItemsSold, 6);
  assert.equal(positive.itemsSold, 10); assert.equal(positive.videoCount, 3); assert.equal(positive.sampleQuantity, 2);
  assert.equal(zero.itemsSold, 0); assert.equal(zero.videoCount, 1);
  assert.equal(zero.topVideoId, ''); assert.equal(zero.topVideoUrl, ''); assert.equal(zero.topVideoItemsSold, null);
  assert.equal(creator.lifetimeItemsSold, 10); assert.equal(creator.level, 2); assert.equal(creator.cooperationCount, 2);
  assert.equal(result.stats.itemsSold, 10); assert.equal(result.stats.videoCount, 4); assert.equal(result.videos.length, 4);
  assert.equal(creator.productContributions.reduce((total, row) => total + row.itemsSold, 0), creator.lifetimeItemsSold);
});

test('highest video uses historical plus confirmed-period sales for the same video and preserves totals', () => {
  const state = fixture([
    video('1001', 3),
    video('1001', 2, { periodStart: '2026-11-01', periodEnd: '2026-11-30', reportMonth: '2026-11' }),
    video('1003', 54),
  ]);
  state.videoBaselines = [{ id: 'synthetic-history', cutoffDate: '2026-09-30', records: [video('1001', 50), video('1002', 0)] }];
  const before = structuredClone(state), result = deriveData(state), creator = result.creators[0], contribution = creator.productContributions[0];
  assert.equal(contribution.topVideoId, '1001'); assert.equal(contribution.topVideoUrl, video('1001', 50).url); assert.equal(contribution.topVideoItemsSold, 55);
  assert.equal(contribution.itemsSold, 109); assert.equal(contribution.videoCount, 3); assert.equal(contribution.goodVideoCount, 2);
  assert.equal(contribution.sampleQuantity, 2); assert.equal(contribution.salesShare, 1);
  assert.equal(creator.lifetimeItemsSold, 109); assert.equal(creator.lifetimeGmv, 218); assert.equal(creator.level, 5);
  assert.equal(result.stats.itemsSold, 109); assert.equal(result.stats.sampleQuantity, 2); assert.equal(result.stats.videoCount, 3);
  assert.deepEqual(state, before);
});

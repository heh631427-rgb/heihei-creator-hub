import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEmptyState, deriveData, guessMappings, mergeImport, normalizeRows } from '../lib/creator-engine.mjs';
import { confirmHistoricalBaseline, confirmPendingVideoImport } from '../lib/video-periods.mjs';

const month = '2026-10';
const order = (changes = {}) => ({ orderId: 'O1', skuId: 'S1', sku: 'SKU*2', productId: 'P1', quantity: 1, createdAt: `${month}-01`, orderType: '', status: 'Completed', sourceType: 'all_orders', ...changes });
const sample = (changes = {}) => ({ id: 'receipt-1', orderId: 'O1', skuId: 'S1', sku: 'SKU*2', productId: 'P1', creatorId: 'creator', quantity: 1, date: `${month}-01`, received: '是', ...changes });
const video = (changes = {}) => ({ videoId: '7000000000000000001', creatorId: 'creator', productId: 'P1', postDate: `${month}-15`, periodStart: `${month}-01`, periodEnd: `${month}-31`, reportMonth: month, itemsSold: 12, views: 500, url: 'https://www.tiktok.com/@creator/video/7000000000000000001', ...changes });
const monthly = state => deriveData(state, { month });
const publicationReport = (records, changes = {}) => ({ id: 'publication', status: 'publication_only', reportPurpose: 'publication', viewsKind: 'period', viewsPeriodStart: `${month}-01`, viewsPeriodEnd: `${month}-31`, records, ...changes });

test('Buyer Username identifies the recipient and retains its source alongside sales attribution', () => {
  const headers = ['Order ID', 'SKU ID', 'Buyer Username', 'Creator Handle', 'Quantity', 'Created Time'];
  const records = normalizeRows('orders', [['O1', 'S1', 'buyer', 'affiliate', 2, '2026-10-01'], ['O2', 'S2', 'other_buyer', '', 1, '2026-10-02']], guessMappings(headers, 'orders'), { headers }).records;
  assert.equal(records[0].creatorId, 'buyer');
  assert.equal(records[0].attributedCreatorId, 'affiliate');
  assert.equal(records[0].creatorMappingSource, 'buyer-username');
  assert.equal(records[0].creatorMappingColumn, 'Buyer Username');
  assert.equal(records[0].creatorMappingRole, 'buyer');
  assert.equal(records[1].creatorId, 'other_buyer');
  assert.equal(records[1].buyerUsername, 'other_buyer');
  const explicitBuyer = normalizeRows('orders', [['O3', 'S3', 'buyer']], { orderId: '0', skuId: '1', creatorId: '2' }, { headers: headers.slice(0, 3) }).records[0];
  assert.equal(explicitBuyer.creatorId, 'buyer');
  assert.equal(explicitBuyer.buyerUsername, 'buyer');
  assert.equal(explicitBuyer.creatorMappingSource, 'buyer-username');
});

test('default Buyer identity joins samples while an explicit recipient mapping and receipt ledger stay authoritative', () => {
  const headers = ['Order ID', 'SKU ID', 'Creator Handle', 'Buyer Username', 'Created Time'];
  const records = normalizeRows('orders', [['O1', 'S1', 'affiliate', 'buyer', '2026-10-01']], guessMappings(headers, 'orders'), { headers }).records;
  const state = mergeImport(createEmptyState(), 'orders', records).state;
  let result = monthly(state);
  assert.equal(result.samples[0].creatorId, 'buyer');
  assert.equal(result.samples[0].attributedCreatorId, 'affiliate');
  assert.equal(result.orders[0].creatorIdentitySource, 'buyer-username');
  assert.equal(result.creators.length, 1);
  state.samples = [sample()];
  result = monthly(state);
  assert.equal(result.samples[0].creatorId, 'creator');
  assert.equal(result.orders[0].creatorIdentitySource, 'sample-ledger');
  assert.equal(result.samples[0].creatorIdentityConflict, true);
  assert.equal(result.samples[0].orderCreatorId, 'buyer');
  const recipientHeaders = ['Order ID', 'SKU ID', 'Creator ID', 'Created Time'];
  const recipientRecords = normalizeRows('orders', [['O2', 'S2', 'recipient', '2026-10-01']], guessMappings(recipientHeaders, 'orders'), { headers: recipientHeaders }).records;
  const recipient = monthly(mergeImport(createEmptyState(), 'orders', recipientRecords).state);
  assert.equal(recipient.samples[0].creatorId, 'recipient');
  assert.equal(recipient.creators[0].cooperationCount, 1);
});

test('legacy Buyer identities now link receipts and enter the roster without losing manual profiles', () => {
  const state = createEmptyState();
  state.orders = [order({ creatorId: 'buyer', creatorHandle: 'buyer', buyerUsername: 'buyer', quantity: 3 })];
  state.creators = [{ creatorId: 'preserved_profile', notes: '保留手工档案' }];
  const original = structuredClone(state), result = monthly(state);
  assert.deepEqual(state, original);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0].creatorId, 'buyer');
  assert.equal(result.samples[0].creatorIdentitySource, 'buyer-username');
  assert.equal(result.samples[0].buyerUsername, 'buyer');
  assert.deepEqual(result.creators.map(row => row.creatorId).sort(), ['buyer', 'preserved_profile']);
  assert.equal(result.stats.promotionSampleQuantity, 3);
  assert.equal(result.stats.promotionSampleOrders, 1);
  assert.equal(result.stats.promotionSampleCreators, 1);
  assert.equal(result.stats.promotionUnlinkedSampleOrders, 0);
});

test('an exact ledger identity wins over both attribution handle and buyer, preserving manual fields', () => {
  const state = createEmptyState();
  state.samples = [sample({ notes: '已沟通', videoLinks: [video().url], _manual: { notes: true, quantity: true }, quantity: 2 })];
  state.orders = [order({ creatorId: 'affiliate', creatorMappingSource: 'explicit-column', buyerUsername: 'buyer', quantity: 3, trackingId: 'TRACK' })];
  const result = monthly(state);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0].creatorId, 'creator');
  assert.equal(result.samples[0].quantity, 2);
  assert.equal(result.samples[0].notes, '已沟通');
  assert.equal(result.samples[0].trackingId, 'TRACK');
  assert.deepEqual(result.samples[0].videoLinks, [video().url]);
  assert.equal(result.orders[0].creatorIdentitySource, 'sample-ledger');
  assert.equal(result.orders[0].matchedSampleId, 'receipt-1');
  assert.equal(result.stats.promotionSampleQuantity, 3);
  assert.equal(result.creators[0].cooperationCount, 2);
});

test('new order quantities update unprotected receipts and retransmission is idempotent', () => {
  let state = createEmptyState();
  state.samples = [sample({ notes: '人工跟进', videoLinks: [video().url] })];
  state = mergeImport(state, 'orders', [order({ quantity: 2 })]).state;
  state = mergeImport(state, 'orders', [order({ quantity: 3, status: 'Completed' })]).state;
  state = mergeImport(state, 'orders', [order({ quantity: 3, status: 'Completed' })]).state;
  let result = monthly(state);
  assert.equal(state.orders.length, 1);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0].quantity, 3);
  assert.equal(result.samples[0].notes, '人工跟进');
  assert.deepEqual(result.samples[0].videoLinks, [video().url]);
  assert.equal(result.creators[0].cooperationCount, 3);
  assert.equal(result.stats.promotionSampleOrders, 1);
  state.orders.push({ ...state.orders[0] });
  result = monthly(state);
  assert.equal(result.orders.length, 1);
  assert.equal(result.stats.promotionSampleQuantity, 3);
  assert.equal(result.samples.length, 1);
});

test('omitting a quantity column during an update preserves the existing explicit quantity', () => {
  let state = createEmptyState();
  state.orders = [order({ quantity: 4 })];
  const normalized = normalizeRows('orders', [['O1', 'S1']], { orderId: '0', skuId: '1' });
  state = mergeImport(state, 'orders', normalized.records).state;
  assert.equal(state.orders[0].quantity, 4);
  assert.equal(deriveData(state).stats.sampleQuantity, 4);
});

test('SKU ID matching is exact; only a unique compatible Seller SKU fallback joins a ledger row', () => {
  const state = createEmptyState();
  state.samples = [sample({ skuId: '', sku: 'A' })];
  state.orders = [order({ skuId: 'NEW', sku: 'A' })];
  let result = monthly(state);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0].skuId, 'NEW');
  assert.equal(result.orders[0].sampleMatchSource, 'order-sku');
  state.samples = [sample({ skuId: 'DIFFERENT', sku: 'A' })];
  result = monthly(state);
  assert.equal(result.samples.length, 2);
  assert.equal(result.orders[0].creatorId, '');
  state.samples = [sample({ id: 'a', skuId: 'SA', sku: 'A', productId: 'P1' }), sample({ id: 'b', skuId: 'SB', sku: 'A', productId: 'P2' })];
  state.orders = [order({ skuId: '', sku: 'A', productId: '' })];
  result = monthly(state);
  assert.equal(result.samples.length, 3);
  assert.equal(result.orders[0].sampleMatchSource, 'ambiguous');
  assert.ok(result.issues.some(row => row.type === 'ambiguousSampleOrder'));
});

test('a matching creator, product and date without an order key remains a review suggestion', () => {
  const state = createEmptyState();
  state.samples = [sample({ id: 'manual-1', source: '手动更新', orderId: '' })];
  state.orders = [order({ creatorId: 'creator', creatorMappingSource: 'explicit-column' })];
  const result = monthly(state);
  assert.equal(result.samples.length, 2);
  assert.equal(result.orders[0].matchedSampleId, '');
  assert.deepEqual(result.orders[0].possibleSampleIds, ['manual-1']);
  assert.ok(result.issues.some(row => row.type === 'possibleDuplicateSample'));
  assert.equal(result.stats.promotionSampleQuantity, 1);
});

test('distinct manual IDs on the same day and SKU survive derived export and reimport', () => {
  let state = createEmptyState();
  state.samples = [sample({ id: 'manual-1', source: '手动更新', orderId: '', notes: '第一件' }), sample({ id: 'manual-2', source: '手动更新', orderId: '', notes: '第二件' })];
  const headers = ['手工记录ID', '达人ID', '日期', 'SKU ID', 'Product ID', '发样数量', '备注'];
  const rows = deriveData(state).samples.map(row => [row.manualRecordId, row.creatorId, row.date, row.skuId, row.productId, row.quantity, row.notes]);
  assert.deepEqual(rows.map(row => row[0]), ['manual-1', 'manual-2']);
  const imported = normalizeRows('samples', rows, guessMappings(headers, 'samples')).records;
  state = mergeImport(state, 'samples', imported).state;
  state = mergeImport(state, 'samples', imported).state;
  assert.equal(state.samples.length, 2);
  assert.equal(deriveData(state).creators[0].cooperationCount, 2);
  assert.deepEqual(state.samples.map(row => row.notes), ['第一件', '第二件']);
  const first = { ...imported[0], orderId: 'O-new', quantity: 2 };
  state = mergeImport(state, 'samples', [first]).state;
  assert.equal(state.samples.length, 2);
  assert.equal(state.samples.find(row => row.manualRecordId === 'manual-1').orderId, 'O-new');
});

test('imported rows without manual IDs retain ordinary repeat-import deduplication', () => {
  let state = createEmptyState();
  const records = [sample({ id: undefined, orderId: '' }), sample({ id: undefined, orderId: '' })];
  state = mergeImport(state, 'samples', records).state;
  state = mergeImport(state, 'samples', records).state;
  assert.equal(state.samples.length, 1);
  assert.equal(deriveData(state).stats.sampleQuantity, 1);
});

test('a complete month with zero eligible orders suppresses ledger and historical fallback', () => {
  const state = createEmptyState();
  state.samples = [sample({ quantity: 8 })];
  state.orders = [order({ orderType: 'Normal' }), order({ orderId: 'O2', orderType: '', substatus: 'Cancelled' }), order({ orderId: 'O3', orderType: '', refundAmount: 10 })];
  state.promotions = [{ month, productId: 'P1', sampleQuantity: 20, itemsSold: 42 }];
  const result = monthly(state);
  assert.equal(result.samples[0].effective, true);
  assert.equal(result.creators[0].cooperationCount, 8);
  assert.equal(result.stats.promotionSampleQuantity, 0);
  assert.equal(result.stats.promotionSampleOrders, 0);
  assert.equal(result.promotions[0].sampleQuantity, 0);
  assert.equal(result.promotions[0].historicalSampleQuantity, 20);
  assert.equal(result.promotions[0].sampleSourceMode, 'orders');
  assert.match(result.stats.promotionSampleSource, /All Orders/);
});

test('cancellation invalidates an existing receipt but keeps its history and notes', () => {
  const state = createEmptyState();
  state.samples = [sample({ notes: '保留历史' })];
  state.orders = [order({ substatus: 'Cancelled' })];
  const result = monthly(state);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0].effective, false);
  assert.equal(result.samples[0].notes, '保留历史');
  assert.equal(result.creators[0].cooperationCount, 0);
  assert.equal(result.stats.promotionSampleQuantity, 0);
});

test('Quantity sums across SKUs without multiplying *2/*3, while PID and creator video sales sum once', () => {
  const state = createEmptyState();
  state.samples = [sample({ quantity: 9 }), sample({ id: 'receipt-2', skuId: 'S2', sku: 'SKU*3', quantity: 9 })];
  state.orders = [order({ quantity: 2 }), order({ skuId: 'S2', sku: 'SKU*3', quantity: 3 })];
  state.videos = [video({ itemsSold: 7 }), video({ videoId: '7000000000000000002', itemsSold: 13, url: 'https://www.tiktok.com/@creator/video/7000000000000000002' })];
  state.pendingVideoImports = [publicationReport(state.videos)];
  state.promotions = [{ month, productId: 'P1', sku: 'SKU*2', sampleQuantity: 99, itemsSold: 9999 }];
  state.settings.viralMinSold = 8;
  const result = monthly(state), row = result.promotions[0];
  assert.equal(result.promotions.length, 1);
  assert.equal(row.sampleQuantity, 5);
  assert.equal(row.sampleOrders, 1);
  assert.equal(row.creatorCount, 1);
  assert.equal(row.itemsSold, 20);
  assert.equal(row.videoCount, 2);
  assert.equal(result.creators[0].lifetimeItemsSold, 20);
  assert.equal(result.creators[0].cooperationCount, 5);
  assert.deepEqual(row.viralVideoLinks, [state.videos[1].url]);
  state.settings.viralMinSold = 5;
  assert.deepEqual(monthly(state).promotions[0].viralVideoLinks, [state.videos[1].url, state.videos[0].url]);
});

test('a manual cancellation affects cooperation but cannot replace the order source Quantity', () => {
  const state = createEmptyState();
  state.samples = [sample({ received: '取消' })];
  state.orders = [order()];
  const result = monthly(state);
  assert.equal(result.creators[0].cooperationCount, 0);
  assert.equal(result.stats.sampleQuantity, 0);
  assert.equal(result.stats.promotionSampleQuantity, 1);
});

test('unresolved products and creators remain visible and included in the sample quantity totals', () => {
  const state = createEmptyState();
  state.productMappings = [{ sku: 'A', skuId: 'S1', productId: 'P1' }, { sku: 'A', skuId: 'S2', productId: 'P2' }];
  state.orders = [order({ skuId: 'UNKNOWN', sku: 'A', productId: '', quantity: 5 })];
  const result = monthly(state);
  assert.equal(result.samples[0].productId, '');
  assert.equal(result.samples[0].productMatch, 'ambiguous');
  assert.equal(result.promotions.length, 1);
  assert.equal(result.promotions[0].sampleQuantity, 5);
  assert.equal(result.promotions[0].unlinkedSampleOrders, 1);
  assert.equal(result.stats.promotionSampleQuantity, 5);
  assert.equal(result.creators.length, 0);
});

test('all-month sample summaries deduplicate physical order IDs across chosen sources and retain historical quantities', () => {
  const state = createEmptyState();
  state.samples = [sample({ date: '2026-08-01', quantity: 2, _manual: { quantity: true } })];
  state.orders = [order({ quantity: 3 })];
  state.promotions = [{ month: '2026-07', sku: 'OLD-UNMAPPED', sampleQuantity: 4, itemsSold: 500, notes: '历史参考' }];
  const result = deriveData(state);
  assert.equal(result.stats.promotionSampleOrders, 1);
  assert.equal(result.stats.promotionSampleQuantity, 9);
  assert.equal(result.stats.promotionSampleCreators, 1);
  assert.match(result.stats.promotionSampleSource, /按月份/);
  assert.equal(result.promotions.find(row => row.month === '2026-07').sampleQuantity, 4);
  assert.equal(result.promotions.find(row => row.month === '2026-07').notes, '历史参考');
  assert.equal(result.stats.itemsSold, 0);
  assert.equal(result.creators[0].lifetimeItemsSold, 0);
});

test('PID-only monthly summaries never create individual receipts or creator sales', () => {
  const state = mergeImport(createEmptyState(), 'promotions', [{ month, productId: 'P1', sampleQuantity: 100, itemsSold: 2000 }]).state;
  const result = monthly(state);
  assert.equal(result.samples.length, 0);
  assert.equal(result.creators.length, 0);
  assert.equal(result.stats.promotionSampleQuantity, 100);
  assert.equal(result.stats.promotionSampleOrders, 0);
  assert.equal(result.promotions[0].sampleSourceMode, 'historical-promotion');
  assert.equal(result.stats.itemsSold, 0);
});

test('monthly selling-video counts use the publication report cohort and exclude old posts and unconfirmed sales files', () => {
  const state = createEmptyState();
  state.videos = [video({ postDate: '2026-09-20', itemsSold: 20, url: '' }), video({ videoId: '7000000000000000002', itemsSold: 3, url: 'https://www.tiktok.com/@creator/video/7000000000000000002' }), video({ videoId: '7000000000000000003', itemsSold: 0 })];
  state.pendingVideoImports = [{ id: 'pending', status: 'period_unconfirmed', records: [video({ videoId: '7000000000000000004', itemsSold: 9999 })] }];
  state.pendingVideoImports.push(publicationReport(state.videos));
  state.settings.viralMinSold = 5;
  const result = monthly(state), row = result.promotions[0];
  assert.equal(row.videoCount, 2);
  assert.equal(row.sellingVideoCount, 1);
  assert.equal(row.itemsSold, 3);
  assert.deepEqual(row.primarySalesVideos, [
    { videoId: '7000000000000000002', url: state.videos[1].url, itemsSold: 3, isViral: false },
  ]);
  assert.equal(deriveData(state, { month: '2026-09' }).stats.promotionItemsSold, null);
  assert.equal(result.stats.itemsSold, 23);
});

test('same-PID daily video rows aggregate before positive-video counting and viral ranking', () => {
  const state = createEmptyState();
  state.videos = [video({ itemsSold: 3, periodStart: '2026-10-01', periodEnd: '2026-10-01' }), video({ itemsSold: 4, periodStart: '2026-10-02', periodEnd: '2026-10-02' }), video({ productId: 'P2', itemsSold: 1, periodStart: '2026-10-02', periodEnd: '2026-10-02' })];
  state.pendingVideoImports = [publicationReport(state.videos.slice(0, 1), { id: 'day-1', viewsPeriodEnd: '2026-10-01' }), publicationReport(state.videos.slice(1), { id: 'day-2', viewsPeriodStart: '2026-10-02', viewsPeriodEnd: '2026-10-02' })];
  const rows = monthly(state).promotions;
  assert.equal(rows.find(row => row.productId === 'P1').itemsSold, 7);
  assert.equal(rows.find(row => row.productId === 'P1').sellingVideoCount, 1);
  assert.equal(rows.find(row => row.productId === 'P1').primarySalesVideos[0].isViral, true);
  assert.equal(rows.find(row => row.productId === 'P1').primarySalesVideos[0].itemsSold, 7);
  assert.equal(rows.find(row => row.productId === 'P2').sellingVideoCount, 1);
  assert.equal(rows.find(row => row.productId === 'P2').primarySalesVideos[0].itemsSold, 1);
});

test('confirmed zero reports have zero selling videos; historical totals without detail remain unknown', () => {
  const state = createEmptyState();
  state.promotions = [{ month, productId: 'P1', itemsSold: 99, videoLinks: [video().url] }];
  let result = monthly(state);
  assert.equal(result.promotions[0].sellingVideoCount, null);
  assert.deepEqual(result.promotions[0].primarySalesVideos, []);
  assert.deepEqual(result.promotions[0].manualVideoLinks, [video().url]);
  state.videos = [video({ itemsSold: 0 })];
  state.pendingVideoImports = [publicationReport(state.videos)];
  result = monthly(state);
  assert.equal(result.promotions[0].itemsSold, 0);
  assert.equal(result.promotions[0].sellingVideoCount, 0);
  assert.deepEqual(result.promotions[0].primarySalesVideos, []);
});

test('historical publication cohorts expose labeled selling-video detail without turning it into monthly sales', () => {
  const state = createEmptyState();
  state.videoBaselines = [{ id: 'baseline', active: true, cutoffDate: '2026-09-30', records: [video({ postDate: '2026-08-15', itemsSold: 500 }), video({ videoId: '7000000000000000002', postDate: '2026-08-16', itemsSold: 0 })] }];
  const result = deriveData(state, { month: '2026-08' }), row = result.promotions[0];
  assert.equal(row.salesDisplayMode, 'historical-publication');
  assert.equal(row.sellingVideoCount, 1);
  assert.equal(row.primarySalesVideos[0].itemsSold, 500);
  assert.equal(row.itemsSold, 500);
  assert.equal(result.stats.itemsSold, 0);
});

test('historical template rows sum SKU quantities but take the repeated PID sales only once', () => {
  const state = createEmptyState();
  const historicalMonth = '2026-08';
  state.promotions = [{ month: historicalMonth, productId: 'P1', sku: 'A', sampleQuantity: 2, itemsSold: 30 }, { month: historicalMonth, productId: 'P1', sku: 'B', sampleQuantity: 3, itemsSold: 30 }];
  let result = deriveData(state, { month: historicalMonth });
  assert.equal(result.promotions.length, 1);
  assert.equal(result.promotions[0].sampleQuantity, 5);
  assert.equal(result.promotions[0].itemsSold, 30);
  assert.equal(result.stats.displayItemsSold, 30);
  assert.equal(result.stats.itemsSold, 0);
  assert.equal(result.promotions[0].historicalRows.length, 2);
  state.promotions[1].itemsSold = 99;
  result = deriveData(state, { month: historicalMonth });
  assert.equal(result.promotions[0].itemsSold, 30);
  assert.ok(result.issues.some(row => row.type === 'historicalPromotionSalesConflict'));
});

test('confirming a proposed sample video changes sample attribution only, not creator, PID, month or views totals', () => {
  let state = createEmptyState();
  state.samples = [sample()];
  state.videos = [video()];
  const before = monthly(state);
  assert.deepEqual(before.samples[0].videoLinks, []);
  assert.deepEqual(before.samples[0].candidateVideoLinks, [video().url]);
  assert.equal(before.samples[0].itemsSold, 0);
  state = mergeImport(state, 'samples', [{ ...sample(), videoLinks: [video().url] }]).state;
  const after = monthly(state);
  assert.deepEqual(after.samples[0].videoLinks, [video().url]);
  assert.equal(after.samples[0].candidateVideoCount, 0);
  assert.equal(after.samples[0].matchedVideoCount, 1);
  assert.equal(after.samples[0].itemsSold, 12);
  for (const key of ['itemsSold', 'videoCount', 'views']) assert.equal(after.stats[key], before.stats[key]);
  assert.equal(after.creators[0].lifetimeItemsSold, before.creators[0].lifetimeItemsSold);
  assert.equal(after.promotions[0].itemsSold, before.promotions[0].itemsSold);
});

test('candidate export columns never map into confirmed links and unknown-creator receipt rows can be reimported', () => {
  const headers = ['Order ID', 'SKU ID', '达人ID', '已确认视频链接', '候选视频链接（未确认）', '候选视频数'];
  let mapping = guessMappings(headers, 'samples');
  assert.equal(mapping.videoLinks, '3');
  const records = normalizeRows('samples', [['O1', 'S1', '', '', video().url, 1]], mapping).records;
  assert.equal(records.length, 1);
  assert.equal(records[0].creatorId, '');
  assert.deepEqual(records[0].videoLinks, []);
  assert.deepEqual(records[0].videoIds, []);
  mapping = guessMappings(['Order ID', 'SKU ID', '候选视频链接（未确认）', '候选视频数'], 'samples');
  assert.equal(mapping.videoLinks, '');
  assert.equal(mapping.url, '');
  assert.equal(guessMappings(['全部已确认视频链接'], 'samples').videoLinks, '0');
});

test('inactive, rejected or deleted staged reports cannot keep contributing candidate links', () => {
  for (const changes of [{ active: false }, { status: 'rejected' }, { status: 'deleted' }, { status: 'dismissed' }]) {
    const state = createEmptyState();
    state.samples = [sample()];
    state.pendingVideoImports = [{ id: 'pending', status: 'period_unconfirmed', records: [video()], ...changes }];
    const result = monthly(state);
    assert.equal(result.samples[0].candidateVideoCount, 0);
    assert.equal(result.samples[0].matchedVideoCount, 0);
    assert.equal(result.stats.itemsSold, 0);
  }
});

test('accepting staged records clears pending flags for both dated increments and historical baselines', () => {
  const state = createEmptyState();
  state.pendingVideoImports = [{ id: 'pending', status: 'period_unconfirmed', records: [video({ periodStart: '', periodEnd: '', reportMonth: '', postDate: '2026-09-20', pendingPeriod: true, reportKind: 'period_unconfirmed' })] }];
  const dated = confirmPendingVideoImport(state, 'pending', { rangeStart: '2026-10-01', rangeEnd: '2026-10-31' }).state;
  assert.equal(dated.videos[0].pendingPeriod, false);
  assert.equal(dated.videos[0].reportKind, '');
  assert.equal(deriveData(dated).stats.itemsSold, 12);
  const historical = confirmHistoricalBaseline(state, 'pending', { cutoffDate: '2026-09-30' }).state;
  assert.equal(historical.videoBaselines[0].records[0].pendingPeriod, false);
  assert.equal(historical.videoBaselines[0].records[0].reportKind, 'historicalBaseline');
  assert.equal(deriveData(historical).stats.itemsSold, 12);
});

test('blank order types still reject explanation rows, Normal orders, refunds and cancellations', () => {
  const headers = ['Order ID', 'SKU ID', 'Quantity', 'Normal or Pre-order', 'Order Substatus', 'Created Time'];
  const normalized = normalizeRows('orders', [
    ['O1', 'S1', 2, '', 'Completed', '2026-10-01'],
    ['O2', 'S2', 1, 'Normal', 'Completed', '2026-10-01'],
    ['O3', 'S3', 1, '', 'Cancelled', '2026-10-01'],
    ['O4', 'S4', 1, '', 'Refunded', '2026-10-01'],
    ['Unique order ID from platform', 'SKU ID', 1, '', '', ''],
    ['', '', '', '', '', ''],
  ], guessMappings(headers, 'orders'), { headers });
  assert.equal(normalized.records.length, 4);
  assert.equal(normalized.rejected, 1);
  const state = mergeImport(createEmptyState(), 'orders', normalized.records).state;
  const result = monthly(state);
  assert.equal(result.orders.length, 4);
  assert.equal(result.stats.promotionSampleQuantity, 2);
  assert.equal(result.samples.length, 1);
  state.settings.orderFilter.allowBlankType = false;
  assert.equal(monthly(state).stats.promotionSampleQuantity, 0);
});

const realSnapshot = '/workspace/scratch/1a1faba85f0d/analysis_data/live_state_before_v10.json';
if (fs.existsSync(realSnapshot)) test('revision 7 retains all explicit sample links and profiles while separating September promotion metrics', () => {
  const { state } = JSON.parse(fs.readFileSync(realSnapshot, 'utf8'));
  const original = structuredClone(state), result = deriveData(state), september = deriveData(state, { month: '2026-09' });
  assert.deepEqual(state, original);
  assert.equal(result.samples.length, 1947);
  assert.equal(result.samples.filter(row => row.videoLinks.length).length, 1463);
  assert.ok(state.creators.every(profile => result.creators.some(row => row.creatorId === profile.creatorId)));
  assert.equal(result.creators.length, 1041);
  assert.equal(result.stats.itemsSold, 9181);
  assert.equal(september.stats.itemsSold, 1789);
  assert.equal(september.stats.videoCount, 781);
  assert.equal(september.stats.views, 8342185);
  assert.equal(september.stats.historicalViewsReference, 8332807);
  assert.equal(september.stats.promotionSampleOrders, 236);
  assert.equal(september.stats.promotionSampleQuantity, 242);
  assert.equal(september.stats.promotionSampleCreators, 180);
  assert.equal(september.stats.promotionUnlinkedSampleOrders, 0);
  assert.equal(september.promotions.reduce((total, row) => total + row.sampleQuantity, 0), 242);
});

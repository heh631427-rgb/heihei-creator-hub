import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData } from '../lib/creator-engine.mjs';
import {
  deriveCommissions, guessCommissionMappings, mergeAffiliateCommissions,
  mergeTargetCommissions, normalizeCommissionRows, normalizeTargetCommission,
  parseCommissionRate, setTargetCommissionArchived, deleteTargetCommission, updateCommissionSettings,
  validateCommissionState, validateTargetCommissionInput, commissionFieldSchemas,
} from '../lib/creator-commissions.mjs';

const at = '2026-10-30T06:00:00Z';
const row = (patch = {}) => ({ orderId: 'o1', skuId: 's1', productId: 'p1', creatorId: 'alice', status: 'settled', createdAt: '2026-10-01 08:00:00', standardRate: 12, currency: 'EUR', estimatedStandard: 2.4, actualStandard: 2.1, ...patch });
const target = (patch = {}) => ({ id: 't1', scope: 'creator', creatorId: 'alice', sku: 'AU1000', commissionRate: 15, expiresOn: '2027-01-01', expiryConfirmed: true, ...patch });
const importRows = (rows, state = createEmptyState(), context = {}) => mergeAffiliateCommissions(state, rows, { at, ...context }).state;
const output = state => deriveCommissions(state, { today: '2026-10-30' });

test('source header aliases map standard and Shop Ads rates separately', () => {
  const headers = ['Order ID', 'Product ID', 'SKU ID', 'Creator Username', 'Order Status', 'Standard commission rate', 'Shop Ads commission rate', 'Time Created'];
  const mapping = guessCommissionMappings(headers);
  assert.equal(mapping.standardRate, '5'); assert.equal(mapping.shopAdsRate, '6');
  const normalized = normalizeCommissionRows('affiliateOrders', [['1', '2', '3', '@Alice', 'Pending', '13.5%', '', '30/10/2026 07:29:38']], mapping);
  assert.equal(normalized.records[0].standardRate, 13.5);
  assert.equal(normalized.records[0].shopAdsRate, undefined);
  assert.equal(normalized.records[0].createdAt, '2026-10-30 07:29:38');
  assert.equal(normalized.records[0].creatorId, 'alice');
});

test('long identifiers never round silently and localized percent inputs preserve zero', () => {
  const mapping = guessCommissionMappings(['Order ID', 'Product ID', 'SKU ID', 'Creator Username', 'Order Status']);
  const normalized = normalizeCommissionRows('affiliateOrders', [[576975643600721928, 'p1', 's1', 'alice', 'Settled']], mapping);
  assert.equal(normalized.rejected, 1); assert.equal(normalized.records.length, 0);
  assert.equal(parseCommissionRate('13,5%'), 13.5);
  assert.equal(parseCommissionRate(0.15, { spreadsheet: true }), 15);
  assert.equal(parseCommissionRate(1, { spreadsheet: true }), 100);
  assert.equal(parseCommissionRate('1'), 1);
  assert.equal(parseCommissionRate(0), 0); assert.equal(parseCommissionRate(''), null);
});

test('order plus SKU preserves multiple product lines and rejects ambiguous missing SKU updates', () => {
  const state = importRows([row(), row({ skuId: 's2', standardRate: 11 })]);
  assert.equal(output(state).summary.eligibleRows, 2);
  assert.equal(output(state).creatorProducts[0].orderCount, 1);
  const result = mergeAffiliateCommissions(state, [row({ skuId: '', standardRate: 99 })], { at });
  assert.equal(result.summary.rejected, 1);
  assert.deepEqual(output(result.state).creatorProducts[0].standardRates, [11, 12]);
});

test('ineligible updates withdraw old observations and older exports cannot revive them', () => {
  let state = importRows([row()], createEmptyState(), { sourceHash: 'first', sheetName: 'Orders' });
  state = importRows([row({ status: 'Ineligible' })], state, { sourceHash: 'cancelled', sheetName: 'Orders' });
  assert.equal(output(state).summary.eligibleRows, 0);
  assert.equal(output(state).summary.ineligibleRows, 1);
  const duplicate = mergeAffiliateCommissions(state, [row()], { sourceHash: 'first', sheetName: 'Orders', at });
  assert.equal(duplicate.summary.duplicateFile, true); assert.equal(duplicate.state, state);
  const older = mergeAffiliateCommissions(state, [row()], { sourceHash: 'different-old-export', at });
  assert.equal(output(older.state).summary.eligibleRows, 0);
  assert.ok(older.summary.warnings.some(value => value.includes('未自动恢复')));
});

test('two rate channels retain their own latest nonblank observation dates', () => {
  const state = importRows([
    row({ orderId: '1', standardRate: 10, shopAdsRate: null }),
    row({ orderId: '2', createdAt: '2026-10-15 08:00:00', standardRate: 12 }),
    row({ orderId: '3', createdAt: '2026-10-20 08:00:00', standardRate: null, shopAdsRate: 5 }),
  ]);
  const product = output(state).creatorProducts[0];
  assert.equal(product.latestStandardRate, 12); assert.equal(product.latestStandardObservedAt, '2026-10-15 08:00:00');
  assert.equal(product.latestShopAdsRate, 5); assert.equal(product.latestShopAdsObservedAt, '2026-10-20 08:00:00');
  assert.deepEqual(product.standardRates, [10, 12]);
});

test('same-time rate conflicts are retained without averaging', () => {
  const product = output(importRows([row(), row({ orderId: '2', standardRate: 15 })])).creatorProducts[0];
  assert.equal(product.latestStandardRate, null);
  assert.deepEqual(product.latestStandardRates, [12, 15]);
  assert.equal(product.standardRateConflict, true);
});

test('missing amounts stay null, zero stays zero, and currencies never combine', () => {
  let state = importRows([row({ standardRate: 0, estimatedStandard: null, actualStandard: 0, estimatedBonus: null })]);
  let product = output(state).creatorProducts[0];
  assert.equal(product.latestStandardRate, 0); assert.equal(product.estimatedStandard, null); assert.equal(product.actualStandard, 0); assert.equal(product.estimatedBonus, null);
  state = importRows([row({ orderId: '2', currency: 'GBP', estimatedStandard: 5 })], state);
  product = output(state).creatorProducts[0];
  assert.equal(product.actualStandard, null); assert.equal(product.amountsByCurrency.length, 2);
});

test('commission imports preserve every existing sales, sample and grading result', () => {
  const initial = createEmptyState(); initial.creators = [{ creatorId: 'alice', notes: '保留备注' }];
  initial.samples = [{ id: 'sample1', manualRecordId: 'sample1', creatorId: 'alice', quantity: 2, sku: 'SKU', productId: 'p1', date: '2026-10-01' }];
  const before = JSON.stringify(initial), existing = deriveData(initial);
  const next = importRows([row({ creatorId: 'new-account', quantity: 500 })], initial);
  assert.equal(JSON.stringify(initial), before);
  const result = deriveData(next);
  assert.deepEqual(result.creators, existing.creators); assert.deepEqual(result.stats, existing.stats); assert.deepEqual(result.samples, existing.samples);
  assert.equal(result.creators.some(item => item.creatorId === 'new-account'), false);
});

test('unknown target expiry years remain pending instead of being guessed', () => {
  const record = normalizeTargetCommission(target({ expiresOn: '10.1', expiryConfirmed: true }));
  assert.equal(record.expiresOn, ''); assert.equal(record.expiryOriginal, '10.1'); assert.equal(record.expiryConfirmed, false);
  const state = mergeTargetCommissions(createEmptyState(), [record], { at }).state;
  assert.equal(output(state).targets[0].expiryStatus, 'needs_confirmation');
});

test('target expiry distinguishes yesterday, today, reminder horizon and later dates', () => {
  const records = ['2026-10-29', '2026-10-30', '2026-11-29', '2026-11-30'].map((date, index) => target({ id: `t${index}`, expiresOn: date }));
  const state = mergeTargetCommissions(createEmptyState(), records, { at }).state;
  assert.deepEqual(output(state).targets.map(record => record.expiryStatus), ['expired', 'due_today', 'expiring', 'active']);
  assert.deepEqual(output(state).targets.map(record => record.daysRemaining), [-1, 0, 30, 31]);
});

test('target rate, stable ID updates, and blank reminder defaults remain independent of orders', () => {
  let state = importRows([row({ standardRate: 12, shopAdsRate: 5 })]);
  state = mergeTargetCommissions(state, [target()], { at }).state;
  const updated = mergeTargetCommissions(state, [target({ commissionRate: 17, remindDays: '' })], { at }).state;
  assert.equal(updated.targetCommissions.length, 1); assert.equal(output(updated).targets[0].commissionRate, 17);
  assert.equal(output(updated).creatorProducts[0].latestStandardRate, 12);
  assert.throws(() => normalizeTargetCommission(target({ remindDays: 'abc' })), /必须为数字/);
  assert.throws(() => updateCommissionSettings(state, { targetCommissionReminderDays: -1 }), /0到365/);
  assert.equal(output(updateCommissionSettings(updated, { targetCommissionReminderDays: 90 }).state).targets[0].expiryStatus, 'expiring');
});

test('duplicate Target arrangements deduplicate canonical dates and resolved product identity', () => {
  const base = createEmptyState(); base.productMappings = [{ sku: 'AU1000', productId: 'p1' }];
  let state = mergeTargetCommissions(base, [target({ productId: 'p1', expiryOriginal: '2027.1.1', notes: '原备注' })], { at }).state;
  state = mergeTargetCommissions(state, [target({ id: '', expiryOriginal: '', notes: '' })], { at }).state;
  assert.equal(state.targetCommissions.length, 1); assert.equal(state.targetCommissions[0].notes, '原备注');
});

test('Target group and unspecified entries never assign all creators or modify the managed roster', () => {
  const base = createEmptyState(); base.creators = [{ creatorId: 'alice' }, { creatorId: 'bob' }];
  const records = [target({ id: 'group', scope: 'group', creatorId: '', groupName: '老达人' }), target({ id: 'none', scope: 'unspecified', creatorId: '' })];
  const state = mergeTargetCommissions(base, records, { at }).state;
  assert.equal(deriveCommissions(state, { today: '2026-10-30', creatorId: 'alice' }).targets.length, 0);
  assert.deepEqual(state.creators, base.creators);
  assert.equal(output(state).targets.find(record => record.id === 'group').displayCreator, '老达人');
});

test('ambiguous bare SKU families and explicit product review never auto-select a PID', () => {
  const base = createEmptyState(); base.productMappings = [{ sku: 'AU8070', productId: 'p-old' }, { sku: 'AU8070-1', productId: 'p-new' }, { sku: 'AU8070-1&OTHER', productId: 'p-bundle' }];
  let state = mergeTargetCommissions(base, [target({ sku: 'AU8070' })], { at }).state;
  assert.equal(output(state).targets[0].productMatch, 'ambiguous');
  assert.deepEqual(output(state).targets[0].candidateProductIds.sort(), ['p-new', 'p-old']);
  state = mergeTargetCommissions(base, [target({ sku: 'AU8070-1', productReviewRequired: true, candidateProductIds: ['p-old', 'p-new'] })], { at }).state;
  assert.equal(output(state).targets[0].productId, '');
  state = mergeTargetCommissions(state, [{ ...state.targetCommissions[0], productId: 'p-new' }], { at }).state;
  assert.equal(output(state).targets[0].productId, 'p-new'); assert.equal(state.targetCommissions[0].productReviewRequired, false);
});

test('an explicit creator review flag is not cleared by a similar or coincidentally matching account', () => {
  const base = createEmptyState(); base.creators = [{ creatorId: 'dani' }, { creatorId: 'dani_other' }];
  const state = mergeTargetCommissions(base, [target({ creatorId: 'dani', creatorReviewRequired: true })], { at }).state;
  assert.equal(output(state).targets[0].creatorMatch, 'unmatched');
});

test('archive and restore are reversible; duplicate no-ID imports do not reactivate an archived Target', () => {
  let state = mergeTargetCommissions(createEmptyState(), [target()], { at }).state;
  state = setTargetCommissionArchived(state, 't1', true, { at }).state;
  assert.equal(output(state).targets[0].expiryStatus, 'archived');
  state = mergeTargetCommissions(state, [target({ id: '' })], { at }).state;
  assert.equal(output(state).targets[0].expiryStatus, 'archived');
  state = setTargetCommissionArchived(state, 't1', false, { at }).state;
  assert.equal(output(state).targets[0].expiryStatus, 'active');
});

test('delete removes only the selected Target ID and preserves unrelated data, history and the undo snapshot', () => {
  const base = importRows([row()]);
  base.samples = [{ id: 'sample-keep', creatorId: 'alice', productId: 'p1', quantity: 2 }];
  base.creators = [{ creatorId: 'alice', notes: '保留达人备注' }];
  const state = mergeTargetCommissions(base, [
    target({ id: 'delete-me', productId: 'p1' }),
    target({ id: 'same-creator-product', productId: 'p1', commissionRate: 17 }),
    target({ id: 'archived-keep', productId: 'p2', status: 'archived' }),
  ], { at }).state;
  const before = structuredClone(state), selected = structuredClone(state.targetCommissions[0]);
  const result = deleteTargetCommission(state, 'delete-me', { expectedRecord: selected });
  assert.deepEqual(result.summary, { deleted: 1, deletedId: 'delete-me' });
  assert.deepEqual(result.state.targetCommissions.map(record => record.id), ['same-creator-product', 'archived-keep']);
  assert.deepEqual(state, before, 'the pre-save state must remain usable by the existing undo snapshot');
  for (const key of Object.keys(state).filter(key => key !== 'targetCommissions')) {
    assert.equal(result.state[key], state[key], `unrelated ${key} stays untouched`);
  }
  assert.deepEqual(output(result.state).creatorProducts, output(state).creatorProducts);
  assert.deepEqual(deriveData(result.state).creators, deriveData(state).creators);
  assert.equal(validateCommissionState(result.state), result.state);
});

test('deleting an archived legacy Target needs no new required fields and leaves no reminder or restore target', () => {
  let state = mergeTargetCommissions(createEmptyState(), [target({ scope: 'group', creatorId: '', groupName: '历史群组', expiresOn: '10.1', expiryConfirmed: false })], { at }).state;
  state = setTargetCommissionArchived(state, 't1', true, { at }).state;
  const imports = state.imports;
  const next = deleteTargetCommission(state, 't1').state;
  assert.deepEqual(next.targetCommissions, []);
  assert.equal(next.imports, imports, 'prior import history is retained, not replayed');
  assert.equal(output(next).targetStats.total, 0);
  assert.deepEqual(output(next).targets, []);
  assert.throws(() => setTargetCommissionArchived(next, 't1', false, { at }), error => error.code === 'TARGET_NOT_FOUND');
  assert.throws(() => deleteTargetCommission(next, 't1'), error => error.code === 'TARGET_NOT_FOUND');
  assert.equal(validateCommissionState(next), next);
});

test('delete rejects missing, blank and ambiguous Target IDs without changing any records', () => {
  const state = mergeTargetCommissions(createEmptyState(), [target()], { at }).state;
  const before = structuredClone(state);
  for (const id of ['', ' ', null, undefined, 0]) assert.throws(() => deleteTargetCommission(state, id), error => error.code === 'TARGET_ID_REQUIRED');
  assert.throws(() => deleteTargetCommission(state, 'unknown'), error => error.code === 'TARGET_NOT_FOUND');
  const duplicate = { ...state, targetCommissions: [state.targetCommissions[0], { ...state.targetCommissions[0], commissionRate: 17 }] };
  const duplicateBefore = structuredClone(duplicate);
  assert.throws(() => deleteTargetCommission(duplicate, 't1'), error => error.code === 'AMBIGUOUS_TARGET_RECORD');
  assert.deepEqual(state, before); assert.deepEqual(duplicate, duplicateBefore);
});

test('delete refuses a changed arrangement after the confirmation was opened', () => {
  const state = mergeTargetCommissions(createEmptyState(), [target()], { at }).state;
  const reviewed = structuredClone(state.targetCommissions[0]);
  const changed = mergeTargetCommissions(state, [target({ commissionRate: 18 })], { at: '2026-10-31T00:00:00Z' }).state;
  assert.throws(() => deleteTargetCommission(changed, 't1', { expectedRecord: reviewed }), error => error.code === 'TARGET_CHANGED');
  assert.equal(changed.targetCommissions[0].commissionRate, 18);
  assert.throws(() => deleteTargetCommission(state, 't1', { expectedRecord: { ...reviewed, id: 'different' } }), error => error.code === 'TARGET_CHANGED');
  const removed = deleteTargetCommission(changed, 't1', { expectedRecord: structuredClone(changed.targetCommissions[0]) });
  assert.equal(removed.state.targetCommissions.length, 0);
});

test('spreadsheet Target rows convert typed percentages once and respect header offsets', () => {
  const headers = ['记录ID', '对象类型', '达人ID', '商品SKU', 'Target佣金率', '到期日期', '提前提醒天数'];
  const result = normalizeCommissionRows('targetCommissions', [['t1', '达人', 'alice', 'AU1000', 0.15, '2027-01-01', '']], guessCommissionMappings(headers, 'targetCommissions'), { headerRow: 5, at });
  assert.equal(result.records[0].commissionRate, 15); assert.equal(result.records[0].sourceRow, 6); assert.equal(result.records[0].remindDays, null);
  const state = mergeTargetCommissions(createEmptyState(), result.records, { at }).state;
  assert.equal(state.targetCommissions[0].commissionRate, 15);
  const invalid = normalizeCommissionRows('targetCommissions', [['t2', '达人', 'alice', 'AU1000', '15%', '2027-01-01', 'abc']], guessCommissionMappings(headers, 'targetCommissions'), { headerRow: 5, at });
  assert.equal(invalid.rejected, 1); assert.equal(invalid.records.length, 0); assert.match(invalid.warnings[0], /必须为数字/);
});

test('strict Target input requires exactly five explicit fields and allows a blank expiry without inferring identity or year', () => {
  const fields = ['scope', 'creatorId', 'sku', 'productId', 'commissionRate'];
  assert.deepEqual(commissionFieldSchemas.targetCommissions.filter(field => field.required).map(field => field.key), fields);
  const input = target({ productId: 'p1', groupName: '' });
  assert.equal(validateTargetCommissionInput(input), input);
  for (const key of fields) {
    assert.throws(() => normalizeTargetCommission({ ...input, [key]: '' }, { strictRequired: true }), error => error.code === 'INVALID_TARGET_INPUT' && error.fields.includes(key) && !!error.fieldErrors[key]);
  }
  const noExpiry = normalizeTargetCommission({ ...input, expiresOn: '' }, { strictRequired: true });
  assert.equal(noExpiry.expiresOn, ''); assert.equal(noExpiry.expiryConfirmed, false);
  for (const expiresOn of ['10.1', '2027-02-30', '2027-01']) assert.throws(() => normalizeTargetCommission({ ...input, expiresOn }, { strictRequired: true }), error => error.fields.includes('expiresOn'));
  assert.throws(() => normalizeTargetCommission({ ...input, productId: '1.234e+18' }, { strictRequired: true }), error => error.fields.includes('productId'));
  assert.equal(normalizeTargetCommission({ ...input, commissionRate: 0 }, { strictRequired: true }).commissionRate, 0);
  const rejected = mergeTargetCommissions(createEmptyState(), [target()], { strictRequired: true, at });
  assert.equal(rejected.summary.rejected, 1); assert.equal(rejected.state.targetCommissions, undefined);
});

test('strict template input reports missing fields by source row and allows optional fields to stay blank', () => {
  const headers = ['对象类型', '达人ID', '商品SKU', '产品PID', 'Target佣金率', '到期日期'];
  const mapping = guessCommissionMappings(headers, 'targetCommissions');
  const result = normalizeCommissionRows('targetCommissions', [
    ['群组', 'alice', 'AU1000-1', 'p1', '15%', '2027-01-01'],
    ['达人', 'bob', '', '', '15%', '10.1'],
  ], mapping, { headerRow: 5, strictRequired: true, at });
  assert.equal(result.records.length, 1); assert.equal(result.rejected, 1);
  assert.equal(result.records[0].sourceRow, 6); assert.equal(result.records[0].groupName, ''); assert.equal(result.records[0].creatorId, 'alice');
  assert.match(result.warnings[0], /第 7 行未导入/); assert.match(result.warnings[0], /商品SKU/); assert.match(result.warnings[0], /产品PID/); assert.match(result.warnings[0], /完整年月日/);
  const merged = mergeTargetCommissions(createEmptyState(), result.records, { strictRequired: true, at });
  assert.equal(merged.summary.added, 1); assert.equal(validateCommissionState(merged.state), merged.state);
});

test('named group or unspecified Targets belong only to their explicit creator, with no extra required group', () => {
  const base = createEmptyState(); base.creators = [{ creatorId: 'alice' }, { creatorId: 'bob' }];
  const records = ['group', 'unspecified'].map(scope => target({ id: scope, scope, productId: 'p1', groupName: '' }));
  const merged = mergeTargetCommissions(base, records, { strictRequired: true, at });
  assert.equal(merged.summary.rejected, 0); assert.equal(merged.summary.added, 2);
  assert.equal(validateCommissionState(merged.state), merged.state);
  const alice = deriveCommissions(merged.state, { today: '2026-10-30', creatorId: 'alice' });
  assert.equal(alice.targets.length, 2); assert.ok(alice.targets.every(record => record.creatorId === 'alice' && record.creatorMatch === 'matched' && record.displayCreator === '@alice'));
  assert.equal(deriveCommissions(merged.state, { today: '2026-10-30', creatorId: 'bob' }).targets.length, 0);
  assert.deepEqual(merged.state.creators, base.creators);
});

test('old incomplete Targets remain readable and archivable without applying new entry requirements', () => {
  const records = [
    target({ id: 'legacy-group', scope: 'group', creatorId: '', groupName: '老达人', expiresOn: '10.1' }),
    target({ id: 'legacy-none', scope: 'unspecified', creatorId: '', expiresOn: '' }),
  ];
  const state = mergeTargetCommissions(createEmptyState(), records, { at, sourceName: '历史记录' }).state;
  assert.equal(validateCommissionState(state), state); assert.equal(output(state).targetStats.needsConfirmation, 2);
  assert.equal(deriveCommissions(state, { today: '2026-10-30', creatorId: 'alice' }).targets.length, 0);
  for (const previous of state.targetCommissions) {
    const archived = setTargetCommissionArchived(state, previous.id, true, { strictRequired: true, at }).state;
    const restored = setTargetCommissionArchived(archived, previous.id, false, { strictRequired: true, at }).state;
    assert.equal(validateCommissionState(restored), restored);
    assert.deepEqual(restored.targetCommissions.find(record => record.id === previous.id), previous);
  }
});

test('a stable known representative SKU is shared by PID while per-creator variants and rates stay intact', () => {
  const base = createEmptyState(); base.productMappings = [{ sku: 'AU1000-10', productId: 'p1' }, { sku: 'AU1000-1', productId: 'p1' }];
  const records = [row({ sku: 'AU1000-2' }), row({ orderId: 'o2', skuId: 's2', sku: 'AU1000-10', creatorId: 'bob', standardRate: 13, actualStandard: 3.3 })];
  const state = importRows(records, base), before = JSON.stringify(state), products = output(state).creatorProducts;
  assert.ok(products.every(product => product.representativeSku === 'AU1000-1'));
  assert.deepEqual(products.find(product => product.creatorId === 'alice').skus, ['AU1000-2']);
  assert.deepEqual(products.find(product => product.creatorId === 'bob').skus, ['AU1000-10']);
  const reversed = importRows([...records].reverse(), { ...base, productMappings: [...base.productMappings].reverse() });
  assert.deepEqual(output(reversed).creatorProducts, products);
  const configured = output({ ...state, settings: { ...state.settings, representativeSkus: { p1: 'AU1000-10' } } }).creatorProducts;
  assert.ok(configured.every(product => product.representativeSku === 'AU1000-10'));
  const withoutRepresentative = values => values.map(({ representativeSku, ...rest }) => rest);
  assert.deepEqual(withoutRepresentative(configured), withoutRepresentative(products));
  assert.ok(output({ ...state, settings: { ...state.settings, representativeSkus: { p1: 'unknown-sku' } } }).creatorProducts.every(product => product.representativeSku === 'AU1000-1'));
  assert.equal(JSON.stringify(state), before);
});

test('server validation accepts old workspaces and canonical data while rejecting malformed optional collections', () => {
  const base = createEmptyState(); assert.equal(validateCommissionState(base), base);
  const state = mergeTargetCommissions(importRows([row()]), [target()], { at }).state;
  assert.equal(validateCommissionState(state), state);
  assert.throws(() => validateCommissionState({ ...base, affiliateCommissionLedger: { version: 1, rows: ['bad'] } }), /无效/);
  assert.throws(() => validateCommissionState({ ...state, targetCommissions: [state.targetCommissions[0], state.targetCommissions[0]] }), /无效/);
});

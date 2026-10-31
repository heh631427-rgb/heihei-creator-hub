import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData, guessMappings, mergeImport, normalizeRows, reconcileOrderBuyerIdentities } from '../lib/creator-engine.mjs';
import { createImportPreset, restoreImportPreset } from '../lib/import-presets.mjs';

const headers = ['Order ID', 'SKU ID', 'Creator Handle', 'Buyer Username', 'Created Time', 'Quantity', 'Recipient Creator ID'];
const values = ['O1', 'S1', '@Affiliate', 'https://www.tiktok.com/@BUYER', '2026-10-01', 2, '@Manual'];
const normalize = (mapping = guessMappings(headers, 'orders'), row = values) => normalizeRows('orders', [row], mapping, { headers }).records[0];
const order = (patch = {}) => ({ orderId: 'O1', skuId: 'S1', productId: 'P1', createdAt: '2026-10-01', quantity: 2, buyerUsername: 'buyer', orderType: '', ...patch });

test('the Buyer source survives a shared mapping and normalizes to the video account', () => {
  const mapping = guessMappings(headers, 'orders');
  assert.equal(mapping.creatorId, '3');
  assert.equal(mapping.buyerUsername, '3');
  assert.equal(mapping.attributedCreatorId, '2');
  const row = normalize(mapping);
  assert.equal(row.creatorId, 'buyer');
  assert.equal(row.buyerUsernameRaw, values[3]);
  assert.equal(row.attributedCreatorId, 'affiliate');
  let state = mergeImport(createEmptyState(), 'orders', [row]).state;
  state = mergeImport(state, 'orders', [row]).state;
  state.videos = [{ videoId: 'V1', creatorId: '@Buyer', productId: 'P1', postDate: '2026-10-02', periodStart: '2026-10-01', periodEnd: '2026-10-31', itemsSold: 5 }];
  const result = deriveData(state);
  assert.equal(state.orders.length, 1);
  assert.equal(result.samples.length, 1);
  assert.equal(result.creators.length, 1);
  assert.equal(result.creators[0].cooperationCount, 2);
  assert.equal(result.creators[0].itemsSold, 5);
  const reversed = ['Order ID', 'SKU ID', 'Buyer Username', 'Creator Handle'];
  assert.equal(guessMappings(reversed, 'orders').creatorId, '2');
});

test('empty Buyer never falls back to the attribution column automatically', () => {
  const row = normalize(undefined, values.map((value, index) => index === 3 ? '' : value));
  const result = deriveData(mergeImport(createEmptyState(), 'orders', [row]).state);
  assert.equal(row.creatorId, '');
  assert.equal(row.attributedCreatorId, 'affiliate');
  assert.equal(result.samples[0].creatorId, '');
  assert.equal(result.creators.length, 0);
});

test('explicit non-Buyer choices, including a deliberately selected Creator Handle, survive later automatic imports', () => {
  for (const [column, identity] of [['6', 'manual'], ['2', 'affiliate']]) {
    const mapping = { ...guessMappings(headers, 'orders'), creatorId: column };
    const chosen = normalize(mapping);
    assert.equal(chosen.creatorId, identity);
    assert.equal(chosen.creatorMappingRole, 'recipient');
    let state = mergeImport(createEmptyState(), 'orders', [chosen]).state;
    state = mergeImport(state, 'orders', [normalize()]).state;
    const result = deriveData(state);
    assert.equal(result.samples[0].creatorId, identity);
    assert.equal(result.samples[0].buyerUsername, 'buyer');
    assert.equal(result.samples[0].creatorIdentityConflict, true);
    assert.equal(result.issues.find(issue => issue.type === 'creatorIdentityConflict').orderId, 'O1');
    assert.equal(reconcileOrderBuyerIdentities(state).summary.updated, 0);
    const replaced = mergeImport(state, 'orders', [normalize()], { overwriteManual: true }).state;
    assert.equal(deriveData(replaced).samples[0].creatorId, 'buyer');
  }
});

test('legacy Buyer blocking and attribution roles resolve from Buyer without changing protected identities', () => {
  for (const patch of [
    { creatorId: '', creatorMappingSource: 'unavailable' },
    { creatorId: '', creatorMappingSource: 'buyer-column' },
    { creatorId: 'affiliate', creatorHandle: 'affiliate', creatorMappingRole: 'attribution', creatorMappingSource: 'explicit-column', creatorMappingColumn: 'Creator Handle' },
  ]) {
    const state = createEmptyState();
    state.orders = [order(patch)];
    assert.equal(deriveData(state).samples[0].creatorId, 'buyer');
  }
  for (const protection of [{ _manual: { creatorId: true } }, { manualFields: ['creatorId'] }]) {
    for (const creatorId of ['manual', '']) {
      const state = createEmptyState();
      state.orders = [order({ creatorId, creatorHandle: 'old', creatorMappingRole: 'attribution', ...protection })];
      assert.equal(deriveData(state).samples[0].creatorId, creatorId);
      assert.equal(reconcileOrderBuyerIdentities(state).summary.updated, 0);
    }
  }
});

test('migration is pure and idempotent, archives old identity, and never invents missing attribution', () => {
  const state = createEmptyState();
  state.orders = [
    order({ creatorId: 'affiliate', creatorHandle: 'affiliate', creatorMappingRole: 'attribution', creatorMappingSource: 'explicit-column', creatorMappingColumn: 'Creator Handle', trackingId: 'KEEP' }),
    order({ orderId: 'O2', creatorId: 'old-recipient', creatorHandle: '', creatorMappingRole: 'attribution', creatorMappingSource: 'unavailable' }),
    order({ orderId: 'O3', buyerUsername: '', creatorId: 'affiliate', creatorHandle: 'affiliate', creatorMappingRole: 'attribution' }),
  ];
  state.samples = [{ id: 'manual', orderId: 'O1', skuId: 'S1', creatorId: 'manual', quantity: 2, videoLinks: ['https://www.tiktok.com/@manual/video/7000000000000000001'] }];
  const before = structuredClone(state);
  const migrated = reconcileOrderBuyerIdentities(state);
  assert.deepEqual(state, before);
  assert.equal(migrated.summary.updated, 2);
  assert.equal(migrated.summary.emptyBuyer, 1);
  assert.equal(migrated.state.orders[0].attributedCreatorId, 'affiliate');
  assert.equal(migrated.state.orders[0].creatorMappingPrevious.creatorId, 'affiliate');
  assert.equal(migrated.state.orders[0].trackingId, 'KEEP');
  assert.equal(migrated.state.orders[1].attributedCreatorId, undefined);
  for (const key of Object.keys(state).filter(key => key !== 'orders')) assert.strictEqual(migrated.state[key], state[key]);
  const again = reconcileOrderBuyerIdentities(migrated.state);
  assert.equal(again.summary.updated, 0);
  assert.strictEqual(again.state, migrated.state);
  const result = deriveData(migrated.state);
  const kept = result.samples.find(sample => sample.id === 'manual');
  assert.equal(kept.creatorId, 'manual');
  assert.equal(kept.orderCreatorId, 'buyer');
  assert.equal(kept.creatorIdentityConflict, true);
  assert.deepEqual(kept.videoLinks, before.samples[0].videoLinks);
});

test('legacy order presets upgrade obsolete empty or attribution choices after column reordering', () => {
  const current = ['Quantity', 'Buyer Username', 'SKU ID', 'Order ID', 'Creator Handle', 'Created Time', 'Recipient Creator ID'];
  for (const creatorId of ['', '2', '3']) {
    const old = { headers, mapping: { ...guessMappings(headers, 'orders'), creatorId, buyerUsername: '' } };
    delete old.mapping.attributedCreatorId;
    const restored = restoreImportPreset(current, guessMappings(current, 'orders'), old);
    assert.equal(restored.mapping.creatorId, '1');
    assert.equal(restored.mapping.buyerUsername, '1');
    assert.equal(restored.mapping.attributedCreatorId, '4');
    assert.ok(!restored.unmapped.includes('creatorId'));
  }
  const manual = { headers, mapping: { ...guessMappings(headers, 'orders'), creatorId: '6' } };
  assert.equal(restoreImportPreset(current, guessMappings(current, 'orders'), manual).mapping.creatorId, '6');
  const legacyAttribution = { headers, mapping: { orderId: '0', skuId: '1', creatorId: '2', buyerUsername: '3' } };
  for (const replacement of [
    ['Order ID', 'SKU ID', 'Creator Handle'],
    ['Order ID', 'SKU ID', 'Creator Handle', 'Buyer Username', 'Buyer Username'],
  ]) {
    const restored = restoreImportPreset(replacement, guessMappings(replacement, 'orders'), legacyAttribution);
    assert.equal(restored.mapping.creatorId, '');
    assert.equal(restored.mapping.attributedCreatorId, '2');
    assert.ok([...restored.missing, ...restored.ambiguous].includes('creatorId'));
    const record = normalizeRows('orders', [['O1', 'S1', 'affiliate', 'buyer', 'other']], restored.mapping, { headers: replacement }).records[0];
    assert.equal(record.creatorId, '');
    assert.equal(record.attributedCreatorId, 'affiliate');
  }
});

test('new order presets retain explicit blank and custom selections while preserving legal shared Buyer sources', () => {
  const automatic = guessMappings(headers, 'orders');
  for (const creatorId of ['', '2', '6']) {
    const preset = createImportPreset(headers, { ...automatic, creatorId });
    assert.equal(preset.orderCreatorIdentityVersion, 1);
    const restored = restoreImportPreset(headers, automatic, preset);
    assert.equal(restored.mapping.creatorId, creatorId);
    assert.equal(restored.mapping.buyerUsername, '3');
    const expected = creatorId === '' ? '' : creatorId === '2' ? 'affiliate' : 'manual';
    assert.equal(normalize(restored.mapping).creatorId, expected);
  }
  const partial = { version: 1, orderCreatorIdentityVersion: 1, headers, mapping: { creatorId: '3', orderId: '0' } };
  const shared = restoreImportPreset(headers, automatic, partial);
  assert.equal(shared.mapping.creatorId, '3');
  assert.equal(shared.mapping.buyerUsername, '3');
  assert.ok(!shared.ambiguous.includes('buyerUsername'));
  const duplicate = ['Order ID', 'SKU ID', 'Buyer Username', 'Buyer Username', 'Creator Handle'];
  const ambiguous = restoreImportPreset(duplicate, guessMappings(duplicate, 'orders'), createImportPreset(headers, automatic));
  assert.equal(ambiguous.mapping.creatorId, '');
  assert.equal(ambiguous.mapping.buyerUsername, '');
});

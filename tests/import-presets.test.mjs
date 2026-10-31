import test from 'node:test';
import assert from 'node:assert/strict';
import {createImportPreset, restoreImportPreset} from '../lib/import-presets.mjs';
import {guessMappings} from '../lib/creator-engine.mjs';

test('reordered product columns restore header identity instead of old positions', () => {
  const oldHeaders = ['SKU ID', 'Seller SKU', 'Product ID', 'Product Name'];
  const preset = createImportPreset(oldHeaders, guessMappings(oldHeaders, 'products'), 2);
  const headers = ['Product Name', 'Product ID', '新增列', 'Seller SKU', 'SKU ID'];
  const result = restoreImportPreset(headers, guessMappings(headers, 'products'), preset);
  assert.deepEqual(result.mapping, {productId:'1', skuId:'4', sku:'3', productName:'0'});
  assert.equal(result.applied.length, 4);
  assert.equal(result.hasPreset, true);
  assert.equal(preset.headerRow, 2);
  assert.deepEqual(result.missing, []);
});

test('a deleted saved column stays unmapped, even when another automatic candidate exists', () => {
  const preset = {headers:['WhatsApp 联系人', '订单'], mapping:{phone:'0', orderId:'1'}, headerRow:3};
  const result = restoreImportPreset(['订单', 'Phone', 'SKU ID'], {phone:'1', orderId:'0', skuId:'2'}, preset);
  assert.equal(result.mapping.phone, '');
  assert.equal(result.mapping.orderId, '0');
  assert.equal(result.mapping.skuId, '2');
  assert.deepEqual(result.missing, ['phone']);
  assert.deepEqual(result.applied, ['orderId']);
});

test('explicitly unmapped fields remain blank while unknown old fields do not affect new fields', () => {
  const preset = {headers:['Creator ID', 'Notes'], mapping:{creatorId:'0', notes:'', removedField:'1'}};
  const result = restoreImportPreset(['Notes', 'Creator ID', 'Views'], {creatorId:'1', notes:'0', views:'2'}, preset);
  assert.deepEqual(result.mapping, {creatorId:'1', notes:'', views:'2'});
  assert.deepEqual(result.unmapped, ['notes']);
  assert.equal(Object.hasOwn(result.mapping, 'removedField'), false);
});

test('duplicate current headers require a choice for saved and automatic mappings', () => {
  const headers = ['SKU ID', 'Product ID', ' Product ID '];
  const auto = {skuId:'0', productId:'1'};
  const preset = {headers:['SKU ID', 'Product ID'], mapping:{skuId:'0', productId:'1'}};
  for (const input of [undefined, preset]) {
    const result = restoreImportPreset(headers, auto, input);
    assert.equal(result.mapping.skuId, '0');
    assert.equal(result.mapping.productId, '');
    assert.deepEqual(result.ambiguous, ['productId']);
  }
});

test('a duplicated saved header is ambiguous even if only one remains in the new file', () => {
  const preset = {headers:['Notes', 'Notes'], mapping:{notes:'1'}};
  const result = restoreImportPreset(['Notes'], {notes:'0'}, preset);
  assert.equal(result.mapping.notes, '');
  assert.deepEqual(result.ambiguous, ['notes']);
});

test('case, whitespace, fullwidth text and BOM differences do not change header identity', () => {
  const preset = {headers:['\uFEFF Ｐｒｏｄｕｃｔ　ＩＤ ', '视频 特点'], mapping:{productId:'0', style:'1'}};
  const result = restoreImportPreset(['视频特点', 'product\nID'], {productId:'1', style:'0'}, preset);
  assert.deepEqual(result.mapping, {productId:'1', style:'0'});
  assert.equal(result.applied.length, 2);
});

test('generated unnamed column labels are not treated as stable column identities', () => {
  const preset = {headers:['未命名列 1', 'SKU ID'], mapping:{productId:'0', skuId:'1'}};
  const result = restoreImportPreset(['未命名列 1', 'SKU ID'], {productId:'0', skuId:'1'}, preset);
  assert.equal(result.mapping.productId, '');
  assert.deepEqual(result.missing, ['productId']);
  assert.equal(result.mapping.skuId, '1');
});

test('saved manual choices win over colliding guesses without preventing explicit shared choices', () => {
  const preset = {headers:['Notes'], mapping:{style:'0'}};
  const result = restoreImportPreset(['Notes'], {style:'', notes:'0'}, preset);
  assert.deepEqual(result.mapping, {style:'0', notes:''});
  assert.deepEqual(result.ambiguous, ['notes']);
  const shared = restoreImportPreset(['Notes'], {style:'', notes:'0'}, {headers:['Notes'], mapping:{style:'0', notes:'0'}});
  assert.deepEqual(shared.mapping, {style:'0', notes:'0'});
  assert.deepEqual(shared.ambiguous, []);
});

test('invalid legacy indexes never restore to an unrelated current column', () => {
  const preset = {headers:['Product ID'], mapping:{productId:'99'}};
  const result = restoreImportPreset(['Product ID'], {productId:'0'}, preset);
  assert.equal(result.mapping.productId, '');
  assert.deepEqual(result.missing, ['productId']);
  const invalidPreset = restoreImportPreset(['Product ID'], {productId:'0'}, {mapping:{productId:'99'}});
  assert.equal(invalidPreset.hasPreset, false);
  assert.equal(invalidPreset.mapping.productId, '0');
});

test('creating and restoring presets does not mutate headers, automatic guesses, or existing state', () => {
  const headers = Object.freeze(['Product ID', 'SKU ID']);
  const mapping = Object.freeze({productId:'0', skuId:'1', notes:''});
  const preset = createImportPreset(headers, mapping, 2);
  const before = JSON.stringify(preset);
  const auto = Object.freeze({productId:'1', skuId:'0', notes:''});
  const result = restoreImportPreset(Object.freeze(['SKU ID', 'Product ID']), auto, preset);
  assert.deepEqual(result.mapping, {productId:'1', skuId:'0', notes:''});
  assert.equal(JSON.stringify(preset), before);
  assert.deepEqual(createImportPreset(['A'], {field:'-1'}, 0), {version:1, headers:['A'], mapping:{field:''}, headerRow:1});
});

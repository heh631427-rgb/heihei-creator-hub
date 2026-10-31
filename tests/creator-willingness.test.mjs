import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, deriveData, guessMappings, mergeImport, normalizeCreator, normalizeRows } from '../lib/creator-engine.mjs';
import { getWillingnessConfig, validateWillingnessConfig, updateCreatorWillingness } from '../lib/creator-willingness.mjs';

const at = '2026-10-29T10:20:30.000Z';
function fixture() {
  const state = createEmptyState();
  state.creators = [
    { creatorId: '@ALICE', willingness: '待跟进', notes: '保留手工备注', manualFields: ['notes'], _manual: { notes: true }, selfPurchasedSampleQuantity: 3, selfPurchaseNotes: '购买三条', historicalPriority: 'A', updatedAt: '2026-09-01T00:00:00.000Z' },
    { creatorId: 'alice', willingness: '中', style: '口播', manualFields: ['style'], _manual: { style: true } },
    { creatorId: 'bob', willingness: '', notes: '不要改动', manualFields: ['notes'], _manual: { notes: true } },
    { creatorId: 'carol', willingness: '高', manualFields: ['willingness'], _manual: { willingness: true }, updatedAt: '2026-09-01T00:00:00.000Z' }
  ];
  state.samples = [{ creatorId: 'sample_only', orderId: 'S1', date: '2026-09-01', productId: 'P1', sku: 'A', quantity: 2, notes: '收样备注' }];
  state.productMappings = [{ productId: 'P1', sku: 'A' }];
  state.videos = [
    { creatorId: 'sales_only', videoId: 'V1', productId: 'P1', itemsSold: 11, periodStart: '2026-09-01', periodEnd: '2026-09-30' },
    { creatorId: 'not_managed', videoId: 'V2', productId: 'P1', itemsSold: 10, periodStart: '2026-09-01', periodEnd: '2026-09-30' }
  ];
  state.preferences = [{ creatorId: 'preference_only', latestViews: 900 }];
  state.settings.rules = [{ id: 'custom', level: 5, label: '自定等级', minSold: 5, maxSold: null, minCollaborations: 1, enabled: true }];
  return state;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
  return value;
}
const profile = (state, id) => deriveData(state).creators.find(row => row.creatorId === id);

test('new and old workspaces read the four defaults without writing a stored choice', () => {
  const state = fixture();
  delete state.settings.willingnessOptions;
  delete state.settings.defaultWillingness;
  const before = structuredClone(state);
  const expected = { options: ['未沟通', '高', '低', '随性'], defaultValue: '未沟通' };
  assert.deepEqual(getWillingnessConfig(createEmptyState()), expected);
  assert.deepEqual(getWillingnessConfig(state), expected);
  assert.deepEqual(getWillingnessConfig(state.settings), expected);
  assert.deepEqual(validateWillingnessConfig({}), expected);
  assert.equal(profile(state, 'bob').willingness, '未沟通');
  assert.equal(profile(state, 'bob').willingnessSource, 'default');
  assert.equal(profile(state, 'sample_only').willingnessSource, 'default');
  assert.deepEqual(state, before);
});

test('configured defaults affect blank profiles while existing legacy values remain exact', () => {
  const state = fixture();
  state.creators.push({ creatorId: 'legacy', willingness: ' 需再联系 ' });
  state.creators.push({ creatorId: 'blank', willingness: '   ' });
  state.settings.willingnessOptions = ['待沟通', '愿意', '暂缓'];
  state.settings.defaultWillingness = '待沟通';
  assert.equal(profile(state, 'legacy').willingness, ' 需再联系 ');
  assert.equal(profile(state, 'legacy').willingnessSource, 'stored');
  assert.equal(profile(state, 'carol').willingness, '高');
  assert.equal(profile(state, 'bob').willingness, '待沟通');
  assert.equal(profile(state, 'blank').willingness, '待沟通');
  state.settings.defaultWillingness = '暂缓';
  assert.equal(profile(state, 'bob').willingness, '暂缓');
  assert.equal(profile(state, 'legacy').willingness, ' 需再联系 ');
});

test('configuration validation rejects malformed or repeated options and missing default targets', () => {
  for (const settings of [null, [], '高', { willingnessOptions: null }, { willingnessOptions: [] }, { willingnessOptions: '高' }, { willingnessOptions: ['高', ' '] }, { willingnessOptions: ['高', 1] }, { willingnessOptions: ['高', ' 高 '] }, { willingnessOptions: ['高'], defaultWillingness: '低' }, { defaultWillingness: null }]) {
    assert.throws(() => validateWillingnessConfig(settings), error => error.code === 'INVALID_WILLINGNESS_CONFIG');
  }
  assert.deepEqual(validateWillingnessConfig({ willingnessOptions: [' 高 ', '低'], defaultWillingness: ' 高 ' }), { options: ['高', '低'], defaultValue: '高' });
  assert.deepEqual(getWillingnessConfig({ willingnessOptions: [], defaultWillingness: '无效' }), { options: ['未沟通', '高', '低', '随性'], defaultValue: '未沟通' });
});

test('a batch normalizes IDs, deduplicates selection, and updates all raw duplicate profiles', () => {
  const state = fixture();
  const original = structuredClone(state);
  const result = updateCreatorWillingness(state, [' @Alice ', 'alice', 'https://www.tiktok.com/@ALICE', '@BOB'], '随性', { at });
  assert.deepEqual(result.summary, { selected: 2, updated: 2, unchanged: 0, createdProfiles: 0 });
  const aliceRows = result.state.creators.filter(row => normalizeCreator(row.creatorId) === 'alice');
  assert.equal(aliceRows.length, 2);
  for (const row of aliceRows) {
    assert.equal(row.willingness, '随性');
    assert.equal(row._manual.willingness, true);
    assert.ok(row.manualFields.includes('willingness'));
    assert.equal(row.updatedAt, at);
  }
  assert.equal(profile(result.state, 'alice').willingness, '随性');
  assert.equal(profile(result.state, 'bob').willingness, '随性');
  assert.deepEqual(state, original);
});

test('only willingness and its manual/update metadata change; notes, metrics and unrelated records are preserved', () => {
  const state = fixture();
  const original = structuredClone(state);
  const beforeMetrics = deriveData(state).creators.map(({ creatorId, level, lifetimeItemsSold, cooperationCount, views }) => ({ creatorId, level, lifetimeItemsSold, cooperationCount, views }));
  const result = updateCreatorWillingness(freezeDeep(state), ['alice'], '低', { at });
  for (const key of Object.keys(state).filter(key => key !== 'creators')) assert.strictEqual(result.state[key], state[key]);
  for (let i = 0; i < state.creators.length; i++) {
    const before = state.creators[i];
    const after = result.state.creators[i];
    if (normalizeCreator(before.creatorId) !== 'alice') {
      assert.strictEqual(after, before);
      continue;
    }
    for (const key of Object.keys(before).filter(key => !['willingness', '_manual', 'manualFields', 'updatedAt'].includes(key))) assert.deepEqual(after[key], before[key]);
    for (const key of before.manualFields) assert.ok(after.manualFields.includes(key));
    for (const [key, value] of Object.entries(before._manual)) assert.equal(after._manual[key], value);
  }
  assert.deepEqual(deriveData(result.state).creators.map(({ creatorId, level, lifetimeItemsSold, cooperationCount, views }) => ({ creatorId, level, lifetimeItemsSold, cooperationCount, views })), beforeMetrics);
  assert.deepEqual(state, original);
});

test('sample-only and sales-qualified managed creators get minimal profiles without admitting leads', () => {
  const state = fixture();
  const beforeIds = deriveData(state).creators.map(row => row.creatorId).sort();
  const result = updateCreatorWillingness(state, ['sample_only', 'sales_only'], '高', { at });
  assert.deepEqual(result.summary, { selected: 2, updated: 2, unchanged: 0, createdProfiles: 2 });
  assert.deepEqual(result.state.creators.slice(-2), ['sample_only', 'sales_only'].map(creatorId => ({ creatorId, ...(creatorId === 'sales_only' ? { admissionOrigin: 'salesThreshold' } : {}), willingness: '高', _manual: { willingness: true }, manualFields: ['willingness'], updatedAt: at })));
  assert.deepEqual(deriveData(result.state).creators.map(row => row.creatorId).sort(), beforeIds);
  assert.equal(profile(result.state, 'sample_only').cooperationCount, 2);
  assert.equal(profile(result.state, 'sales_only').cooperationCount, 1);
  assert.equal(state.creators.length, 4);
});

test('first manual willingness retains sales admission origin until actual receipt history takes precedence', () => {
  const state = fixture();
  const before = profile(state, 'sales_only');
  assert.equal(before.rosterSource, 'salesThreshold');
  const changed = updateCreatorWillingness(state, ['sales_only'], '高', { at }).state;
  const creator = profile(changed, 'sales_only');
  assert.equal(creator.rosterSource, 'salesThreshold');
  assert.equal(creator.admissionReason, '出单达标纳入，暂无收样记录');
  assert.equal(creator.lifetimeItemsSold, before.lifetimeItemsSold);
  assert.equal(creator.cooperationCount, before.cooperationCount);
  assert.equal(creator.level, before.level);
  assert.equal(profile(changed, 'bob').rosterSource, 'historicalProfile');
  assert.equal(changed.creators.find(row => row.creatorId === 'bob').admissionOrigin, undefined);
  const withReceipt = { ...changed, samples: [...changed.samples, { creatorId: 'sales_only', orderId: 'S2', date: '2026-10-01', productId: 'P1', sku: 'A', quantity: 2 }] };
  const received = profile(withReceipt, 'sales_only');
  assert.equal(received.rosterSource, 'sample');
  assert.equal(received.admissionReason, '收样表中的达人');
  assert.equal(received.cooperationCount, 2);
  assert.equal(received.willingness, '高');
  assert.equal(received.lifetimeItemsSold, before.lifetimeItemsSold);
});

test('any unknown target rejects the whole batch before creating or changing a profile', () => {
  const state = fixture();
  const original = structuredClone(state);
  for (const unknown of ['not_managed', 'preference_only', 'new_external_lead']) {
    assert.throws(() => updateCreatorWillingness(state, ['alice', 'sample_only', unknown], '高', { at }), error => error.code === 'UNKNOWN_CREATOR_SELECTION' && error.message.includes(unknown));
    assert.deepEqual(state, original);
  }
});

test('invalid selection/value types, unconfigured labels, and timestamps are rejected without mutations', () => {
  const state = fixture();
  const original = structuredClone(state);
  for (const ids of [null, 'alice', [], ['alice', ''], ['alice', null], [123]]) {
    assert.throws(() => updateCreatorWillingness(state, ids, '高', { at }), error => error.code === 'INVALID_CREATOR_SELECTION');
  }
  for (const value of ['', '中', null, ['高'], 1]) {
    assert.throws(() => updateCreatorWillingness(state, ['alice'], value, { at }), error => error.code === 'INVALID_WILLINGNESS_OPTION');
  }
  assert.throws(() => updateCreatorWillingness(state, ['alice'], '高', { at: 'invalid' }), error => error.code === 'INVALID_WILLINGNESS_TIMESTAMP');
  assert.throws(() => updateCreatorWillingness(null, ['alice'], '高'), error => error.code === 'INVALID_WILLINGNESS_STATE');
  assert.deepEqual(state, original);
});

test('explicitly selecting the displayed default stores a manual decision that later default changes cannot alter', () => {
  const state = fixture();
  assert.equal(profile(state, 'bob').willingnessSource, 'default');
  const result = updateCreatorWillingness(state, ['bob', 'sample_only'], '未沟通', { at });
  assert.deepEqual(result.summary, { selected: 2, updated: 2, unchanged: 0, createdProfiles: 1 });
  assert.equal(profile(result.state, 'bob').willingnessSource, 'stored');
  const changedDefault = { ...result.state, settings: { ...result.state.settings, defaultWillingness: '低' } };
  assert.equal(profile(changedDefault, 'bob').willingness, '未沟通');
  assert.equal(profile(changedDefault, 'sample_only').willingness, '未沟通');
  assert.equal(profile(changedDefault, 'sales_only').willingness, '低');
});

test('repeating an already manual choice is an unchanged operation and preserves its timestamp', () => {
  const state = fixture();
  const result = updateCreatorWillingness(state, ['carol', '@CAROL'], '高', { at });
  assert.deepEqual(result.summary, { selected: 1, updated: 0, unchanged: 1, createdProfiles: 0 });
  assert.strictEqual(result.state, state);
  assert.equal(profile(result.state, 'carol').updatedAt, '2026-09-01T00:00:00.000Z');
});

test('subsequent imports preserve explicit willingness and union manual protections across duplicate rows', () => {
  const state = fixture();
  state.creators[1]._manual.willingness = true;
  const changed = updateCreatorWillingness(state, ['alice'], '高', { at }).state;
  const imported = mergeImport(changed, 'creators', [{ creatorId: 'ALICE', willingness: '低', notes: '旧文件备注', style: '旧风格', manualFields: ['tendency'], _manual: { willingness: false, notes: false, tendency: true }, tendency: '家居' }]).state;
  const row = imported.creators.find(row => normalizeCreator(row.creatorId) === 'alice');
  assert.equal(row.willingness, '高');
  assert.equal(row.notes, '保留手工备注');
  assert.equal(row.style, '口播');
  assert.equal(row._manual.willingness, true);
  assert.equal(row._manual.notes, true);
  for (const field of ['willingness', 'notes', 'style', 'tendency']) assert.ok(row.manualFields.includes(field));
  const importedAgain = mergeImport(imported, 'creators', [{ creatorId: 'alice', willingness: '随性', notes: '再次导入备注', style: '另一个风格' }]).state;
  assert.equal(profile(importedAgain, 'alice').willingness, '高');
  assert.equal(profile(importedAgain, 'alice').notes, '保留手工备注');
  assert.equal(profile(importedAgain, 'alice').style, '口播');
});

test('changing options does not relabel any stored value and disallows retired options as new bulk choices', () => {
  const state = fixture();
  const originalProfiles = structuredClone(state.creators);
  const custom = { ...state, settings: { ...state.settings, willingnessOptions: ['待沟通', '积极'], defaultWillingness: '待沟通' } };
  assert.deepEqual(custom.creators, originalProfiles);
  assert.equal(profile(custom, 'carol').willingness, '高');
  assert.equal(profile(custom, 'bob').willingness, '待沟通');
  assert.throws(() => updateCreatorWillingness(custom, ['carol'], '高'), error => error.code === 'INVALID_WILLINGNESS_OPTION');
  assert.equal(profile(updateCreatorWillingness(custom, ['bob'], '积极', { at }).state, 'bob').willingness, '积极');
  assert.deepEqual(state.creators, originalProfiles);
});

test('new export header and all prior willingness labels map back to the same creator field', () => {
  for (const label of ['合作配合意愿', '配合意愿度', '配合愿意度', '合作意愿', '合作意愿度', 'Willingness']) {
    const mapping = guessMappings(['达人ID', label], 'creators');
    assert.equal(mapping.willingness, '1');
    const imported = normalizeRows('creators', [['@ALICE', '随性']], mapping);
    assert.equal(imported.records[0].creatorId, 'alice');
    assert.equal(imported.records[0].willingness, '随性');
  }
});

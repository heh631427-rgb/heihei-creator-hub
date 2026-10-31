import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWorkbenchSnapshot } from '../lib/state-visibility.mjs';

const fixture = () => ({ revision: 11, canUndo: true, state: {
  samples: [{ id: 'sample-1' }], creators: [{ creatorId: 'creator-1' }],
  affiliateCommissionLedger: { version: 1, rows: [] },
  targetCommissions: [{ creatorId: 'creator-1', commissionRate: 15, notes: 'private agreement' }],
  settings: { targetCommissionReminderDays: 30, videoOnlyCreatorMinSold: 10 },
  imports: [{ type: 'videos', id: 'public-source' }, { type: 'targetCommissions', notes: 'private source' }, { type: 'manual', privateToAdmin: true }],
} });

test('administrators retain complete Target records and import history', () => {
  const original = fixture();
  assert.equal(visibleWorkbenchSnapshot(original, { role: 'admin' }), original);
});

test('ordinary accounts receive commissions but no negotiated Target data or source history', () => {
  const original = fixture(), before = structuredClone(original);
  const result = visibleWorkbenchSnapshot(original, { role: 'user' });
  assert.equal(Object.hasOwn(result.state, 'targetCommissions'), false);
  assert.equal(Object.hasOwn(result.state.settings, 'targetCommissionReminderDays'), false);
  assert.equal(result.state.settings.videoOnlyCreatorMinSold, 10);
  assert.deepEqual(result.state.imports, [{ type: 'videos', id: 'public-source' }]);
  assert.deepEqual(result.state.affiliateCommissionLedger, original.state.affiliateCommissionLedger);
  assert.deepEqual(result.state.samples, original.state.samples);
  assert.deepEqual(result.state.creators, original.state.creators);
  assert.equal(result.revision, 11);
  assert.deepEqual(original, before);
});

test('missing or unrecognized roles never expose private arrangements', () => {
  for (const user of [undefined, null, { role: 'viewer' }, { role: 'Admin' }]) {
    assert.equal(JSON.stringify(visibleWorkbenchSnapshot(fixture(), user)).includes('private agreement'), false);
  }
});

test('legacy workspaces without Target collections remain readable', () => {
  const original = { revision: 1, state: { samples: [], settings: { rules: [] }, imports: [] } };
  assert.deepEqual(visibleWorkbenchSnapshot(original, { role: 'user' }), original);
});

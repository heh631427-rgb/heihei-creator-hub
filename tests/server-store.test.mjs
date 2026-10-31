import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createEmptyState } from '../lib/creator-engine.mjs';

// Load the actual TS module with only the Workers env binding substituted.
// Every prepared statement and transaction executes against the real schema.
async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  const hooks = {}, calls = [];
  function bound(sql, args = []) {
    const statement = sqlite.prepare(sql);
    return {
      sql, args,
      bind(...values) { return bound(sql, values); },
      async first() { calls.push({ kind: 'first', sql, args }); return statement.get(...args) || null; },
      async all() {
        const event = { kind: 'all', sql, args };
        await hooks.beforeRead?.(event);
        const results = statement.all(...args);
        calls.push({ ...event, results });
        return { results, success: true, meta: {} };
      },
      async run() { calls.push({ kind: 'run', sql, args }); return { success: true, meta: { changes: Number(statement.run(...args).changes) }, results: [] }; },
      execute() {
        if (statement.columns().length) return { success: true, results: statement.all(...args), meta: {} };
        return { success: true, results: [], meta: { changes: Number(statement.run(...args).changes) } };
      },
    };
  }
  const db = {
    prepare: bound,
    async batch(statements) {
      const first = statements[0]?.sql || '';
      const phase = first.startsWith('INSERT INTO workbench_chunks') ? 'stage' : first.startsWith('UPDATE workbench_meta') ? 'finalize' : 'cleanup';
      const event = { kind: 'batch', phase, statements };
      calls.push(event);
      await hooks.beforeBatch?.(event);
      sqlite.exec('BEGIN'); let results;
      try {
        results = statements.map((statement, index) => { hooks.beforeStatement?.(event, statement, index); return statement.execute(); });
        sqlite.exec('COMMIT');
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      event.results = results;
      await hooks.afterBatch?.(event);
      return results;
    },
  };
  const binding = `__store_test_${randomUUID()}`;
  globalThis[binding] = { DB: db };
  const source = readFileSync(new URL('../lib/server-store.ts', import.meta.url), 'utf8')
    .replace('import { getDatabase } from "./database.mjs";', `const getDatabase = () => globalThis[${JSON.stringify(binding)}].DB;`)
    .replace('"./creator-engine.mjs"', JSON.stringify(new URL('../lib/creator-engine.mjs', import.meta.url).href))
    .replace('"./creator-commissions.mjs"', JSON.stringify(new URL('../lib/creator-commissions.mjs', import.meta.url).href));
  const store = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
  // Retain this isolated test binding until close.
  return { store, sqlite, hooks, calls, close: () => { sqlite.close(); delete globalThis[binding]; } };
}
const state = note => ({ ...createEmptyState(), notes: note });
const currentMeta = sqlite => sqlite.prepare('SELECT * FROM workbench_meta WHERE id = ?').get('main');

test('invalid commission collections are rejected before any snapshot is published', async () => {
  const { store, sqlite, close } = await setup();
  try {
    const original = state('existing records');
    await store.saveState(original, 0, 'seed');
    await assert.rejects(store.saveState({ ...original, affiliateCommissionLedger: { version: 1, rows: 'invalid' } }, 1, 'bad commission import'), error => error.status === 400);
    await assert.rejects(store.saveState({ ...original, targetCommissions: [{ id: 'bad-target' }] }, 1, 'bad Target import'), error => error.status === 400);
    assert.equal(currentMeta(sqlite).revision, 1);
    assert.deepEqual((await store.readState()).state, original);
  } finally { close(); }
});

test('a 19.5 MB state saves and reads through bounded D1 payloads', async () => {
  const { store, sqlite, calls, close } = await setup();
  try {
    const input = state('x'.repeat(19_500_000));
    const saved = await store.saveState(input, 0, 'large workspace');
    assert.equal(saved.revision, 1);
    assert.equal(saved.canUndo, false);
    const result = await store.readState();
    assert.equal(result.revision, 1);
    assert.equal(result.state.notes, input.notes);
    const stages = calls.filter(call => call.kind === 'batch' && call.phase === 'stage');
    assert(stages.length > 1);
    assert(stages.every(call => call.statements.length <= 8));
    assert(stages.every(call => call.statements.reduce((sum, statement) => sum + statement.args[2].length, 0) <= 8 * 180000));
    const pages = calls.filter(call => call.kind === 'all');
    assert(pages.length > 1);
    assert(pages.every(call => /LIMIT \?/.test(call.sql) && call.args[2] === 8 && call.results.length <= 8));
    assert(pages.every(call => call.results.reduce((sum, row) => sum + row.content.length, 0) <= 8 * 180000));
    assert(calls.filter(call => call.phase === 'finalize').every(call => call.statements.length === 2));
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM workbench_history').get().count, 1);
    await assert.rejects(store.saveState(state('x'.repeat(24 * 1024 * 1024)), 1, 'over limit'), error => error.status === 413);
    assert.equal(currentMeta(sqlite).revision, 1);
  } finally { close(); }
});

test('Unicode chunk boundaries roundtrip and undo publishes the entire previous snapshot at a new revision', async () => {
  const { store, sqlite, close } = await setup();
  try {
    const input = state('');
    const prefixLength = JSON.stringify(input).length - 2;
    input.notes = 'x'.repeat(179999 - prefixLength) + '😀汉字'.repeat(80000);
    await store.saveState(input, 0, 'Unicode');
    const originalId = currentMeta(sqlite).current_snapshot;
    const chunks = sqlite.prepare('SELECT content FROM workbench_chunks WHERE snapshot_id = ? ORDER BY chunk_index').all(originalId);
    assert(chunks.length > 1);
    assert(chunks.every(row => !/[\uD800-\uDBFF]$/.test(row.content)));
    const second = await store.saveState(state('second'), 1, 'replace');
    assert.equal(second.canUndo, true);
    assert.equal(currentMeta(sqlite).previous_snapshot, originalId);
    const undone = await store.undoState(2);
    assert.equal(undone.revision, 3);
    assert.equal(undone.canUndo, false);
    assert.equal(undone.state.notes, input.notes);
    assert.equal((await store.readState()).state.notes, input.notes);
    assert.equal(currentMeta(sqlite).previous_snapshot, '');
  } finally { close(); }
});

test('a middle staging failure leaves the published state and history intact and removes only its own unpublished chunks', async () => {
  const { store, sqlite, hooks, close } = await setup();
  try {
    await store.saveState(state('published'), 0, 'seed');
    const before = { ...currentMeta(sqlite) };
    sqlite.prepare('INSERT INTO workbench_chunks VALUES (?,?,?)').run('unrelated-staging', 0, '{}');
    hooks.beforeBatch = event => { if (event.phase === 'stage' && event.statements[0].args[1] === 8) throw new Error('injected stage failure'); };
    await assert.rejects(store.saveState(state('x'.repeat(2_000_000)), 1, 'fail'), /injected stage failure/);
    assert.deepEqual({ ...currentMeta(sqlite) }, before);
    assert.equal((await store.readState()).state.notes, 'published');
    assert.deepEqual(sqlite.prepare('SELECT DISTINCT snapshot_id FROM workbench_chunks ORDER BY snapshot_id').all().map(row => row.snapshot_id).sort(), [before.current_snapshot, 'unrelated-staging'].sort());
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM workbench_history').get().count, 1);
  } finally { close(); }
});

test('an incomplete staged snapshot fails the atomic count and contiguous-index publication guard', async () => {
  for (const corruption of ['missing', 'wrong-index']) {
    const { store, sqlite, hooks, close } = await setup();
    try {
      await store.saveState(state('published'), 0, 'seed');
      const before = { ...currentMeta(sqlite) };
      hooks.beforeBatch = event => {
        if (event.phase !== 'finalize') return;
        const id = event.statements[0].args[2];
        if (corruption === 'missing') sqlite.prepare('DELETE FROM workbench_chunks WHERE snapshot_id = ? AND chunk_index = 1').run(id);
        else sqlite.prepare('UPDATE workbench_chunks SET chunk_index = 99 WHERE snapshot_id = ? AND chunk_index = 1').run(id);
      };
      await assert.rejects(store.saveState(state('x'.repeat(400000)), 1, 'incomplete'), error => error.status === 503 && /分片不完整/.test(error.message));
      assert.deepEqual({ ...currentMeta(sqlite) }, before);
      assert.equal(sqlite.prepare('SELECT count(*) AS count FROM workbench_history').get().count, 1);
      assert.equal((await store.readState()).state.notes, 'published');
    } finally { close(); }
  }
});

test('history insertion failure rolls back metadata publication, and cleanup failure cannot roll back a successful save', async () => {
  const { store, sqlite, hooks, close } = await setup();
  try {
    await store.saveState(state('published'), 0, 'seed');
    const before = { ...currentMeta(sqlite) };
    hooks.beforeStatement = (event, _statement, index) => { if (event.phase === 'finalize' && index === 1) throw new Error('history write failed'); };
    await assert.rejects(store.saveState(state('unpublished'), 1, 'fail'), /history write failed/);
    assert.deepEqual({ ...currentMeta(sqlite) }, before);
    assert.equal((await store.readState()).state.notes, 'published');
    delete hooks.beforeStatement;
    hooks.beforeBatch = event => { if (event.phase === 'cleanup') throw new Error('cleanup failed'); };
    assert.equal((await store.saveState(state('saved'), 1, 'successful')).revision, 2);
    assert.equal((await store.readState()).state.notes, 'saved');
  } finally { close(); }
});

test('a lost finalize response recognizes the committed history marker and never deletes published chunks', async () => {
  const { store, sqlite, hooks, close } = await setup();
  try {
    await store.saveState(state('previous'), 0, 'seed');
    hooks.afterBatch = event => { if (event.phase === 'finalize') throw new Error('response lost after commit'); };
    const saved = await store.saveState(state('committed'), 1, 'commit');
    assert.equal(saved.revision, 2);
    assert.equal(saved.canUndo, true);
    assert.equal((await store.readState()).state.notes, 'committed');
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM workbench_history').get().count, 2);
    await assert.rejects(store.saveState(state('retry'), 1, 'retry'), error => error.status === 409);
  } finally { close(); }
});

test('two writers at one revision cannot overwrite each other or prune another active staging snapshot', async () => {
  for (const raceAt of ['stage', 'finalize']) {
    const { store, sqlite, hooks, close } = await setup();
    try {
      await store.saveState(state('previous'), 0, 'seed');
      let raced = false, loserId;
      const race = async event => {
        if (raced || event.phase !== raceAt) return;
        raced = true;
        loserId = raceAt === 'stage' ? event.statements[0].args[0] : event.statements[0].args[2];
        await store.saveState(state('winner'), 1, 'winner');
        assert(sqlite.prepare('SELECT count(*) AS count FROM workbench_chunks WHERE snapshot_id = ?').get(loserId).count > 0, 'winner cleanup must leave the other writer’s staging chunks alone');
      };
      if (raceAt === 'stage') hooks.afterBatch = race;
      else hooks.beforeBatch = race;
      await assert.rejects(store.saveState(state('x'.repeat(2_000_000)), 1, 'loser'), error => error.status === 409);
      assert.equal((await store.readState()).state.notes, 'winner');
      assert.equal(currentMeta(sqlite).revision, 2);
      assert.equal(sqlite.prepare('SELECT count(*) AS count FROM workbench_history').get().count, 2);
      assert.equal(sqlite.prepare('SELECT count(*) AS count FROM workbench_chunks WHERE snapshot_id = ?').get(loserId).count, 0);
    } finally { close(); }
  }
});

test('pagination fails closed on missing indexes and on rows lost after its initial count', async () => {
  for (const corruption of ['middle', 'tail-during-read']) {
    const { store, sqlite, hooks, close } = await setup();
    try {
      await store.saveState(state('x'.repeat(2_000_000)), 0, 'seed');
      const id = currentMeta(sqlite).current_snapshot;
      if (corruption === 'middle') sqlite.prepare('DELETE FROM workbench_chunks WHERE snapshot_id = ? AND chunk_index = 1').run(id);
      else hooks.beforeRead = event => { if (event.args[1] === 8) sqlite.prepare('DELETE FROM workbench_chunks WHERE snapshot_id = ? AND chunk_index >= 8').run(id); };
      await assert.rejects(store.readState(), error => error.status === 503);
      assert.equal(currentMeta(sqlite).revision, 1);
    } finally { close(); }
  }
});

test('retention prunes only old published history while preserving current, previous and unpublished staging', async () => {
  const { store, sqlite, close } = await setup();
  try {
    sqlite.prepare('INSERT INTO workbench_chunks VALUES (?,?,?)').run('other-writer', 0, '{}');
    for (let revision = 0; revision < 12; revision++) await store.saveState(state(`revision ${revision + 1}`), revision, 'save');
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM workbench_history').get().count, 10);
    assert.equal(sqlite.prepare('SELECT count(DISTINCT snapshot_id) AS count FROM workbench_chunks').get().count, 11);
    const current = currentMeta(sqlite);
    for (const id of [current.current_snapshot, current.previous_snapshot, 'other-writer']) assert(sqlite.prepare('SELECT count(*) AS count FROM workbench_chunks WHERE snapshot_id = ?').get(id).count > 0);
    assert.equal((await store.undoState(12)).state.notes, 'revision 11');
  } finally { close(); }
});

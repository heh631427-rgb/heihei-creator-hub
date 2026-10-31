import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createAuthService, derivePasswordHash, parseAccounts, AuthError, LOGIN_WINDOW_SECONDS, SESSION_SECONDS, readBoundedJson } from '../lib/auth-core.mjs';

const ORIGIN = 'https://workbench.example';
const administratorPassword = 'synthetic-test-administrator-password';
const memberPassword = '654321';
let accountsJSON, secret;
before(async () => {
  secret = randomBytes(48).toString('base64url');
  const accounts = [];
  for (const [id, username, role, password] of [['admin-test', 'admin@example.test', 'admin', administratorPassword], ['viewer-test', 'member-test', 'viewer', memberPassword]]) {
    const salt = randomBytes(16).toString('base64url');
    accounts.push({ id, username, role, salt, hash: await derivePasswordHash(password, salt) });
  }
  accountsJSON = JSON.stringify(accounts);
});

// Execute the actual generated migration SQL and D1 statements against SQLite.
function setup({ isDev = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const migrationDir = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  function bound(sql, args = []) {
    const statement = sqlite.prepare(sql);
    return {
      sql, args,
      bind(...values) { return bound(sql, values); },
      async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
      execute() { return statement.columns().length ? { results: statement.all(...args) } : { results: [], meta: { changes: Number(statement.run(...args).changes) } }; },
    };
  }
  const db = { prepare: bound, async batch(statements) { sqlite.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  let time = 1800000000000;
  const auth = createAuthService({ db, accountsJSON, sessionSecret: secret, isDev, now: () => time });
  return { auth, db, sqlite, advance: seconds => { time += seconds * 1000; }, now: () => time };
}
function request(path = '/api/state', { cookie, origin = ORIGIN, method = 'GET', body, ip = '192.0.2.1', urlOrigin = ORIGIN, headers = {} } = {}) {
  const h = { 'CF-Connecting-IP': ip, ...headers };
  if (cookie) h.Cookie = cookie;
  if (method !== 'GET') { if (origin != null) h.Origin = origin; h['Content-Type'] = 'application/json'; }
  return new Request(urlOrigin + path, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const loginRequest = (username, password, options = {}) => request('/api/auth/login', { method: 'POST', body: { username, password }, ...options });
const cookiePart = value => value.split(';')[0];
async function failure(action, status) { let error; try { await action(); } catch (caught) { error = caught; } assert(error instanceof AuthError); assert.equal(error.status, status); return error; }

test('admin login issues an opaque secure cookie; only token hash is stored', async () => {
  const { auth, sqlite } = setup();
  const result = await auth.login(loginRequest(' ADMIN@EXAMPLE.TEST ', administratorPassword));
  assert.deepEqual(result.user, { username: 'admin@example.test', role: 'admin' });
  assert.match(result.cookie, /^__Host-heihei_session=[A-Za-z0-9_-]{43};/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${SESSION_SECONDS}`]) assert(result.cookie.includes(flag));
  assert(!result.cookie.includes('Domain='));
  const row = sqlite.prepare('SELECT * FROM auth_sessions').get();
  assert.equal(row.token_hash.length, 64); assert(!result.cookie.includes(row.token_hash));
  assert.equal((await auth.requireUser(request('/api/state', { cookie: cookiePart(result.cookie) }), 'admin')).role, 'admin');
  sqlite.close();
});

test('viewer can authenticate with a short supplied password but cannot obtain admin authorization', async () => {
  const { auth, sqlite } = setup();
  const result = await auth.login(loginRequest('member-test', memberPassword));
  const req = request('/api/state', { cookie: cookiePart(result.cookie) });
  assert.equal((await auth.requireUser(req)).role, 'viewer');
  await failure(() => auth.requireUser(req, 'admin'), 403);
  sqlite.close();
});

test('platform identity or forged role headers never substitute for an app session', async () => {
  const { auth, sqlite } = setup();
  const req = request('/api/state', { headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'admin@example.test', 'x-role': 'admin', Authorization: 'Bearer unrelated' } });
  assert.equal(await auth.currentUser(req), null);
  await failure(() => auth.requireUser(req), 401);
  sqlite.close();
});

test('unknown account and wrong password have identical errors and issue no session', async () => {
  const { auth, sqlite } = setup();
  const one = await failure(() => auth.login(loginRequest('admin@example.test', 'wrong-password')), 401);
  const two = await failure(() => auth.login(loginRequest('unknown-account', 'wrong-password')), 401);
  assert.equal(one.message, two.message);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get().count, 0);
  const keys = sqlite.prepare('SELECT bucket_key FROM auth_login_limits').all();
  assert(keys.every(row => !row.bucket_key.includes('admin@example.test') && !row.bucket_key.includes('192.0.2.1')));
  sqlite.close();
});

test('login rejects absent or cross-origin Origin and wrong content type before recording attempts', async () => {
  const { auth, sqlite } = setup();
  await failure(() => auth.login(loginRequest('member-test', memberPassword, { origin: null })), 403);
  await failure(() => auth.login(loginRequest('member-test', memberPassword, { origin: 'https://other.example' })), 403);
  const req = new Request(ORIGIN + '/api/auth/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: '{}' });
  await failure(() => auth.login(req), 415);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_login_limits').get().count, 0);
  sqlite.close();
});

test('tampered, duplicate, and expired session cookies fail closed', async () => {
  const { auth, sqlite, advance } = setup();
  const result = await auth.login(loginRequest('member-test', memberPassword));
  const cookie = cookiePart(result.cookie), modified = cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A');
  assert.equal(await auth.currentUser(request('/api/state', { cookie: modified })), null);
  assert.equal(await auth.currentUser(request('/api/state', { cookie: cookie + '; ' + cookie })), null);
  advance(SESSION_SECONDS);
  assert.equal(await auth.currentUser(request('/api/state', { cookie })), null);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get().count, 0);
  sqlite.close();
});

test('logout revokes the server session and expires the browser cookie', async () => {
  const { auth, sqlite } = setup();
  const result = await auth.login(loginRequest('member-test', memberPassword));
  const cookie = cookiePart(result.cookie);
  const response = await auth.logout(request('/api/auth/logout', { method: 'POST', cookie, body: {} }));
  assert(response.cookie.includes('Max-Age=0'));
  assert.equal(await auth.currentUser(request('/api/state', { cookie })), null);
  sqlite.close();
});

test('managed database ignores later bootstrap config changes; session-secret rotation revokes sessions', async () => {
  const { auth, db, sqlite, now } = setup();
  const result = await auth.login(loginRequest('member-test', memberPassword));
  const cookie = cookiePart(result.cookie), changed = JSON.parse(accountsJSON);
  changed[1].role = 'admin';
  const changedAuth = createAuthService({ db, accountsJSON: JSON.stringify(changed), sessionSecret: secret, now });
  assert.deepEqual(await changedAuth.currentUser(request('/api/state', { cookie })), { username: 'member-test', role: 'viewer' });
  const next = await auth.login(loginRequest('member-test', memberPassword));
  const rotated = createAuthService({ db, accountsJSON, sessionSecret: randomBytes(48).toString('base64url'), now });
  assert.equal(await rotated.currentUser(request('/api/state', { cookie: cookiePart(next.cookie) })), null);
  sqlite.close();
});

test('account rate limit applies across different IPs and expires with its window', async () => {
  const { auth, sqlite, advance } = setup();
  for (let i = 0; i < 10; i++) await failure(() => auth.login(loginRequest('member-test', 'wrong', { ip: `192.0.2.${i + 1}` })), 401);
  const blocked = await failure(() => auth.login(loginRequest('member-test', memberPassword, { ip: '198.51.100.100' })), 429);
  assert(Number(blocked.headers['Retry-After']) > 0);
  advance(LOGIN_WINDOW_SECONDS);
  assert.equal((await auth.login(loginRequest('member-test', memberPassword))).user.role, 'viewer');
  sqlite.close();
});

test('IP rate limit applies across different account names', async () => {
  const { auth, sqlite } = setup();
  for (let i = 0; i < 30; i++) await failure(() => auth.login(loginRequest(`unknown-${i}`, 'wrong')), 401);
  await failure(() => auth.login(loginRequest('admin@example.test', administratorPassword)), 429);
  const rowCount = sqlite.prepare('SELECT count(*) AS count FROM auth_login_limits').get().count;
  assert.equal(rowCount, 1);
  for (let i = 30; i < 50; i++) await failure(() => auth.login(loginRequest(`unknown-${i}`, 'wrong')), 429);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_login_limits').get().count, rowCount);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM auth_login_limits WHERE bucket_key LIKE 'account:%'").get().count, 0);
  sqlite.close();
});

test('local non-secure cookie is available only in explicit development on known preview hosts', async () => {
  const prod = setup();
  await failure(() => prod.auth.login(loginRequest('member-test', memberPassword, { origin: 'http://terminal.local:4173', urlOrigin: 'http://terminal.local:4173' })), 503);
  prod.sqlite.close();
  const dev = setup({ isDev: true });
  const result = await dev.auth.login(loginRequest('member-test', memberPassword, { origin: 'http://terminal.local:4173', urlOrigin: 'http://terminal.local:4173' }));
  assert(result.cookie.startsWith('heihei_dev_session=')); assert(!result.cookie.includes('; Secure'));
  await failure(() => dev.auth.login(loginRequest('member-test', memberPassword, { origin: 'http://attacker.example', urlOrigin: 'http://attacker.example' })), 503);
  dev.sqlite.close();
});

test('malformed configuration fails closed without allowing default accounts', () => {
  for (const value of ['{}', '[]', 'not-json', JSON.stringify([{ id: 'only-viewer', username: 'member', role: 'viewer', salt: randomBytes(16).toString('base64url'), hash: randomBytes(32).toString('base64url') }])]) assert.throws(() => parseAccounts(value), error => error instanceof AuthError && error.status === 503);
  const duplicate = JSON.parse(accountsJSON); duplicate[1].username = 'ADMIN@EXAMPLE.TEST';
  assert.throws(() => parseAccounts(JSON.stringify(duplicate)), error => error.status === 503);
});

test('bounded JSON parsing rejects oversized and malformed request bodies', async () => {
  await failure(() => readBoundedJson(new Request(ORIGIN + '/api/auth/login', { method: 'POST', body: 'x'.repeat(4097) })), 413);
  await failure(() => readBoundedJson(new Request(ORIGIN + '/api/auth/login', { method: 'POST', body: '{bad-json' })), 400);
  await failure(() => readBoundedJson(new Request(ORIGIN + '/api/auth/login', { method: 'POST', body: '[]' })), 400);
});

test('successful relogin rotates and invalidates the previous token', async () => {
  const { auth, sqlite } = setup();
  const first = await auth.login(loginRequest('member-test', memberPassword));
  const second = await auth.login(loginRequest('member-test', memberPassword, { cookie: cookiePart(first.cookie) }));
  assert.notEqual(cookiePart(first.cookie), cookiePart(second.cookie));
  assert.equal(await auth.currentUser(request('/api/state', { cookie: cookiePart(first.cookie) })), null);
  assert.equal((await auth.currentUser(request('/api/state', { cookie: cookiePart(second.cookie) }))).role, 'viewer');
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get().count, 1);
  sqlite.close();
});


const adminPath = '/api/admin/accounts';
const accountRequest = (cookie, method, body, id, extras = {}) => request(id ? `${adminPath}/${id}` : adminPath, { cookie, method, body, ...extras });
async function adminSession(auth) { return cookiePart((await auth.login(loginRequest('admin@example.test', administratorPassword))).cookie); }
async function viewerSession(auth) { return cookiePart((await auth.login(loginRequest('member-test', memberPassword))).cookie); }
function interceptNextBatch(db, pattern, action) {
  const original = db.batch.bind(db);
  db.batch = async statements => {
    if (pattern.test(statements[0]?.sql || '')) {
      db.batch = original;
      await action();
    }
    return original(statements);
  };
}
function interceptNextPrepare(db, pattern, action) {
  const original = db.prepare.bind(db);
  db.prepare = sql => {
    if (pattern.test(sql)) { db.prepare = original; action(); }
    return original(sql);
  };
}

test('concurrent first requests seed existing hashed accounts exactly once in an atomic batch', async () => {
  const { auth, db, sqlite, now } = setup();
  const other = createAuthService({ db, accountsJSON, sessionSecret: secret, now });
  const responses = await Promise.all([auth.login(loginRequest('admin@example.test', administratorPassword)), other.login(loginRequest('member-test', memberPassword))]);
  assert.equal(responses.length, 2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_account_config').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_accounts').get().count, 2);
  for (const account of JSON.parse(accountsJSON)) {
    const row = sqlite.prepare('SELECT * FROM auth_accounts WHERE id = ?').get(account.id);
    assert.equal(row.salt, account.salt); assert.equal(row.hash, account.hash); assert.equal(row.revision, 0);
  }
  sqlite.close();
});

test('bootstrap rollback leaves no partial accounts or marker when a seed write fails', async () => {
  const { auth, db, sqlite } = setup();
  const original = db.batch.bind(db);
  db.batch = statements => {
    if (statements[0]?.sql?.startsWith('INSERT INTO auth_accounts')) {
      statements.splice(1, 0, db.prepare('INSERT INTO auth_accounts (id) VALUES (?)').bind('invalid-seed'));
    }
    return original(statements);
  };
  await failure(() => auth.login(loginRequest('admin@example.test', administratorPassword)), 503);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_accounts').get().count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_account_config').get().count, 0);
  sqlite.close();
});

test('legacy account fingerprint cookies continue working across managed-account bootstrap', async () => {
  const { auth, sqlite, now } = setup();
  const account = JSON.parse(accountsJSON)[0], token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const oldFingerprint = createHmac('sha256', Buffer.from(secret, 'base64url')).update(JSON.stringify(account)).digest('base64url');
  sqlite.prepare('INSERT INTO auth_sessions (token_hash, account_id, account_fingerprint, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(tokenHash, account.id, oldFingerprint, Math.floor(now() / 1000), Math.floor(now() / 1000) + SESSION_SECONDS);
  assert.deepEqual(await auth.currentUser(request('/api/state', { cookie: `__Host-heihei_session=${token}` })), { username: 'admin@example.test', role: 'admin' });
  sqlite.close();
});

test('deleting a seeded account never recreates it; initialized service no longer needs bootstrap config', async () => {
  const { auth, db, sqlite, now } = setup(), cookie = await adminSession(auth);
  const removed = await auth.deleteAccount(accountRequest(cookie, 'DELETE', {}, 'viewer-test'), 'viewer-test');
  assert.deepEqual(removed, { deletedId: 'viewer-test' });
  const sameEnv = createAuthService({ db, accountsJSON, sessionSecret: secret, now });
  await failure(() => sameEnv.login(loginRequest('member-test', memberPassword)), 401);
  const noEnv = createAuthService({ db, sessionSecret: secret, now });
  assert.equal((await noEnv.login(loginRequest('admin@example.test', administratorPassword))).user.role, 'admin');
  const badEnv = createAuthService({ db, accountsJSON: 'not-json', sessionSecret: secret, now });
  assert.equal((await badEnv.listAccounts(accountRequest(cookie, 'GET'))).accounts.length, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_accounts').get().count, 1);
  sqlite.close();
});

test('admin account list returns public metadata only and identifies the current account', async () => {
  const { auth, sqlite } = setup(), cookie = await adminSession(auth);
  const response = await auth.listAccounts(accountRequest(cookie, 'GET'));
  assert.equal(response.currentAccountId, 'admin-test'); assert.equal(response.activeAdminCount, 1);
  assert.equal(response.accounts.length, 2);
  for (const account of response.accounts) {
    assert.deepEqual(Object.keys(account).sort(), ['active', 'createdAt', 'id', 'isCurrent', 'role', 'updatedAt', 'username']);
    assert.equal(typeof account.active, 'boolean'); assert(Number.isFinite(Date.parse(account.createdAt)));
    assert.equal(account.isCurrent, account.id === response.currentAccountId);
  }
  const serialized = JSON.stringify(response);
  for (const row of JSON.parse(accountsJSON)) { assert(!serialized.includes(row.hash)); assert(!serialized.includes(row.salt)); }
  sqlite.close();
});

test('anonymous and viewer sessions cannot list, add, change or delete accounts', async () => {
  const { auth, sqlite } = setup(), viewer = await viewerSession(auth);
  await failure(() => auth.listAccounts(accountRequest(undefined, 'GET')), 401);
  await failure(() => auth.listAccounts(accountRequest(viewer, 'GET')), 403);
  await failure(() => auth.createAccount(accountRequest(viewer, 'POST', { username: 'intruder', password: 'eight-char-password', role: 'admin' })), 403);
  await failure(() => auth.updateAccount(accountRequest(viewer, 'PATCH', { role: 'admin' }, 'viewer-test'), 'viewer-test'), 403);
  await failure(() => auth.deleteAccount(accountRequest(viewer, 'DELETE', {}, 'admin-test'), 'admin-test'), 403);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_accounts').get().count, 2);
  assert.equal(sqlite.prepare('SELECT role FROM auth_accounts WHERE id = ?').get('viewer-test').role, 'viewer');
  sqlite.close();
});

test('all account writes reject cross-origin or missing Origin and unsupported body fields', async () => {
  const { auth, sqlite } = setup(), cookie = await adminSession(auth);
  for (const origin of [null, 'https://untrusted.example']) {
    await failure(() => auth.createAccount(accountRequest(cookie, 'POST', { username: 'blocked', password: 'test-password' }, undefined, { origin })), 403);
    await failure(() => auth.updateAccount(accountRequest(cookie, 'PATCH', { active: false }, 'viewer-test', { origin }), 'viewer-test'), 403);
    await failure(() => auth.deleteAccount(accountRequest(cookie, 'DELETE', {}, 'viewer-test', { origin }), 'viewer-test'), 403);
  }
  await failure(() => auth.createAccount(accountRequest(cookie, 'POST', { username: 'blocked', password: 'test-password', hash: 'forged' })), 400);
  await failure(() => auth.updateAccount(accountRequest(cookie, 'PATCH', { username: 'renamed' }, 'viewer-test'), 'viewer-test'), 400);
  await failure(() => auth.deleteAccount(accountRequest(cookie, 'DELETE', { unexpected: true }, 'viewer-test'), 'viewer-test'), 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_accounts').get().count, 2);
  sqlite.close();
});

test('new accounts normalize usernames, default to viewer, hash passwords, and sign in independently', async () => {
  const { auth, sqlite } = setup(), cookie = await adminSession(auth);
  const result = await auth.createAccount(accountRequest(cookie, 'POST', { username: '  ＮＥＷ.User  ', password: 'new-account-password' }));
  assert.equal(result.account.username, 'new.user'); assert.equal(result.account.role, 'viewer'); assert.equal(result.account.active, true);
  assert.equal(result.account.isCurrent, false); assert(!JSON.stringify(result).includes('new-account-password'));
  const row = sqlite.prepare('SELECT * FROM auth_accounts WHERE id = ?').get(result.account.id);
  assert.notEqual(row.hash, 'new-account-password'); assert.equal(row.hash, await derivePasswordHash('new-account-password', row.salt));
  const login = await auth.login(loginRequest('NEW.USER', 'new-account-password'));
  assert.deepEqual(login.user, { username: 'new.user', role: 'viewer' });
  await failure(() => auth.requireUser(request('/api/state', { cookie: cookiePart(login.cookie) }), 'admin'), 403);
  sqlite.close();
});

test('duplicate names, invalid usernames, roles and new short passwords cannot create accounts', async () => {
  const { auth, sqlite } = setup(), cookie = await adminSession(auth);
  await failure(() => auth.createAccount(accountRequest(cookie, 'POST', { username: ' ＭＥＭＢＥＲ-test ', password: 'new-password' })), 409);
  for (const username of ['', 'space inside', 'line\nbreak', 'zero\u200bwidth', 'x'.repeat(255)]) {
    await failure(() => auth.createAccount(accountRequest(cookie, 'POST', { username, password: 'valid-password' })), 400);
  }
  for (const password of ['', '1234567', 'x'.repeat(257), null]) {
    await failure(() => auth.createAccount(accountRequest(cookie, 'POST', { username: 'valid-new-name', password })), 400);
  }
  await failure(() => auth.createAccount(accountRequest(cookie, 'POST', { username: 'valid-new-name', password: 'valid-password', role: 'owner' })), 400);
  assert.equal((await auth.login(loginRequest('member-test', memberPassword))).user.role, 'viewer');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_accounts').get().count, 2);
  sqlite.close();
});

test('disabling revokes all sessions and re-enabling never revives old cookies', async () => {
  const { auth, db, sqlite, now } = setup(), admin = await adminSession(auth);
  const first = await viewerSession(auth), second = await viewerSession(auth);
  const other = createAuthService({ db, accountsJSON, sessionSecret: secret, now });
  const disabled = await other.updateAccount(accountRequest(admin, 'PATCH', { active: false }, 'viewer-test'), 'viewer-test');
  assert.equal(disabled.account.active, false); assert.equal(disabled.sessionRevoked, false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE account_id = ?').get('viewer-test').count, 0);
  assert.equal(await auth.currentUser(request('/api/state', { cookie: first })), null);
  await failure(() => auth.login(loginRequest('member-test', memberPassword)), 401);
  await other.updateAccount(accountRequest(admin, 'PATCH', { active: true }, 'viewer-test'), 'viewer-test');
  assert.equal(await auth.currentUser(request('/api/state', { cookie: second })), null);
  assert.equal((await auth.login(loginRequest('member-test', memberPassword))).user.role, 'viewer');
  sqlite.close();
});

test('role changes revoke existing sessions and enforce the new role on next login', async () => {
  const { auth, sqlite } = setup(), admin = await adminSession(auth), viewer = await viewerSession(auth);
  await auth.updateAccount(accountRequest(admin, 'PATCH', { role: 'admin' }, 'viewer-test'), 'viewer-test');
  assert.equal(await auth.currentUser(request('/api/state', { cookie: viewer })), null);
  const promoted = cookiePart((await auth.login(loginRequest('member-test', memberPassword))).cookie);
  assert.equal((await auth.listAccounts(accountRequest(promoted, 'GET'))).activeAdminCount, 2);
  await auth.updateAccount(accountRequest(admin, 'PATCH', { role: 'viewer' }, 'viewer-test'), 'viewer-test');
  await failure(() => auth.listAccounts(accountRequest(promoted, 'GET')), 401);
  const ordinary = await viewerSession(auth);
  await failure(() => auth.listAccounts(accountRequest(ordinary, 'GET')), 403);
  sqlite.close();
});

test('password reset salts a new hash, revokes every target session and leaves actor logged in', async () => {
  const { auth, sqlite } = setup(), admin = await adminSession(auth), viewer = await viewerSession(auth);
  const old = sqlite.prepare('SELECT salt, hash FROM auth_accounts WHERE id = ?').get('viewer-test');
  const result = await auth.updateAccount(accountRequest(admin, 'PATCH', { password: 'replacement-password' }, 'viewer-test'), 'viewer-test');
  assert.equal(result.sessionRevoked, false);
  const changed = sqlite.prepare('SELECT salt, hash FROM auth_accounts WHERE id = ?').get('viewer-test');
  assert.notEqual(changed.salt, old.salt); assert.notEqual(changed.hash, old.hash);
  assert(!JSON.stringify(result).includes(changed.hash)); assert(!JSON.stringify(result).includes(changed.salt));
  assert.equal(await auth.currentUser(request('/api/state', { cookie: viewer })), null);
  await failure(() => auth.login(loginRequest('member-test', memberPassword)), 401);
  assert.equal((await auth.login(loginRequest('member-test', 'replacement-password'))).user.role, 'viewer');
  assert.equal((await auth.currentUser(request('/api/state', { cookie: admin }))).role, 'admin');
  sqlite.close();
});

test('current administrator cannot self-delete, self-disable or self-demote; self password reset signs out', async () => {
  const { auth, sqlite } = setup(), admin = await adminSession(auth);
  await failure(() => auth.deleteAccount(accountRequest(admin, 'DELETE', {}, 'admin-test'), 'admin-test'), 400);
  await failure(() => auth.updateAccount(accountRequest(admin, 'PATCH', { active: false }, 'admin-test'), 'admin-test'), 400);
  await failure(() => auth.updateAccount(accountRequest(admin, 'PATCH', { role: 'viewer' }, 'admin-test'), 'admin-test'), 400);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_accounts WHERE active = 1 AND role = 'admin'").get().count, 1);
  const result = await auth.updateAccount(accountRequest(admin, 'PATCH', { password: 'new-administrator-password' }, 'admin-test'), 'admin-test');
  assert.equal(result.sessionRevoked, true);
  assert.equal(await auth.currentUser(request('/api/state', { cookie: admin })), null);
  assert.equal((await auth.login(loginRequest('admin@example.test', 'new-administrator-password'))).user.role, 'admin');
  sqlite.close();
});

test('delete invalidates every session; recreated same username gets a different identity', async () => {
  const { auth, sqlite } = setup(), admin = await adminSession(auth), viewer = await viewerSession(auth);
  await auth.deleteAccount(accountRequest(admin, 'DELETE', {}, 'viewer-test'), 'viewer-test');
  assert.equal(await auth.currentUser(request('/api/state', { cookie: viewer })), null);
  await failure(() => auth.login(loginRequest('member-test', memberPassword)), 401);
  const next = await auth.createAccount(accountRequest(admin, 'POST', { username: 'member-test', password: 'new-member-password' }));
  assert.notEqual(next.account.id, 'viewer-test');
  assert.equal(await auth.currentUser(request('/api/state', { cookie: viewer })), null);
  assert.equal((await auth.login(loginRequest('member-test', 'new-member-password'))).user.role, 'viewer');
  sqlite.close();
});

test('two administrators concurrently removing one another cannot remove the last active administrator', async () => {
  for (const action of ['delete', 'disable', 'demote']) {
    const { auth, db, sqlite, now } = setup(), first = await adminSession(auth);
    await auth.updateAccount(accountRequest(first, 'PATCH', { role: 'admin' }, 'viewer-test'), 'viewer-test');
    const second = await viewerSession(auth), other = createAuthService({ db, accountsJSON, sessionSecret: secret, now });
    const perform = (service, cookie, target) => action === 'delete' ? service.deleteAccount(accountRequest(cookie, 'DELETE', {}, target), target) : service.updateAccount(accountRequest(cookie, 'PATCH', action === 'disable' ? { active: false } : { role: 'viewer' }, target), target);
    const results = await Promise.allSettled([perform(auth, first, 'viewer-test'), perform(other, second, 'admin-test')]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, action);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_accounts WHERE active = 1 AND role = 'admin'").get().count, 1, action);
    sqlite.close();
  }
});

test('a stale target revision cannot overwrite another change or revoke the newly valid target session', async () => {
  const { auth, db, sqlite } = setup(), admin = await adminSession(auth);
  let freshViewer;
  interceptNextBatch(db, /^UPDATE auth_accounts/, async () => {
    sqlite.prepare('UPDATE auth_accounts SET revision = revision + 1 WHERE id = ?').run('viewer-test');
    freshViewer = await viewerSession(auth);
  });
  await failure(() => auth.updateAccount(accountRequest(admin, 'PATCH', { active: false }, 'viewer-test'), 'viewer-test'), 409);
  assert.equal((await auth.currentUser(request('/api/state', { cookie: freshViewer }))).role, 'viewer');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE account_id = ?').get('viewer-test').count, 1);
  assert.equal(sqlite.prepare('SELECT active FROM auth_accounts WHERE id = ?').get('viewer-test').active, 1);
  sqlite.close();
});

test('admin account creation is rejected if actor session is logged out while password hashing is pending', async () => {
  const { auth, db, sqlite } = setup(), admin = await adminSession(auth);
  interceptNextBatch(db, /^INSERT INTO auth_accounts/, () => auth.logout(request('/api/auth/logout', { cookie: admin, method: 'POST', body: {} })));
  await failure(() => auth.createAccount(accountRequest(admin, 'POST', { username: 'must-not-exist', password: 'new-account-password', role: 'admin' })), 401);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_accounts WHERE username = ?').get('must-not-exist').count, 0);
  sqlite.close();
});

test('actor revision or expiry changes reject password resets after hashing and preserve target sessions', async () => {
  for (const mode of ['revision', 'disabled', 'expired']) {
    const { auth, db, sqlite, advance } = setup(), admin = await adminSession(auth), viewer = await viewerSession(auth);
    const old = sqlite.prepare('SELECT hash FROM auth_accounts WHERE id = ?').get('viewer-test').hash;
    const intercept = mode === 'expired' ? interceptNextPrepare : interceptNextBatch;
    intercept(db, /^UPDATE auth_accounts/, () => {
      if (mode === 'revision') sqlite.prepare('UPDATE auth_accounts SET revision = revision + 1 WHERE id = ?').run('admin-test');
      if (mode === 'disabled') sqlite.prepare('UPDATE auth_accounts SET active = 0 WHERE id = ?').run('admin-test');
      if (mode === 'expired') advance(SESSION_SECONDS);
    });
    await failure(() => auth.updateAccount(accountRequest(admin, 'PATCH', { password: 'must-not-change-password' }, 'viewer-test'), 'viewer-test'), 401);
    assert.equal(sqlite.prepare('SELECT hash FROM auth_accounts WHERE id = ?').get('viewer-test').hash, old, mode);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE account_id = ?').get('viewer-test').count, 1, mode);
    if (mode !== 'expired') assert.equal((await auth.currentUser(request('/api/state', { cookie: viewer }))).role, 'viewer');
    sqlite.close();
  }
});

test('database-time expiry at commit rejects an actor even when application time is behind', async () => {
  const { auth, db, sqlite } = setup(), admin = await adminSession(auth);
  const epoch = sqlite.prepare('SELECT unixepoch() AS seconds').get().seconds;
  const slowClock = createAuthService({ db, accountsJSON, sessionSecret: secret, now: () => (epoch - 120) * 1000 });
  interceptNextBatch(db, /^UPDATE auth_accounts/, () => {
    sqlite.prepare('UPDATE auth_sessions SET expires_at = unixepoch() - 1 WHERE account_id = ?').run('admin-test');
  });
  await failure(() => slowClock.updateAccount(accountRequest(admin, 'PATCH', { active: false }, 'viewer-test'), 'viewer-test'), 401);
  assert.equal(sqlite.prepare('SELECT active FROM auth_accounts WHERE id = ?').get('viewer-test').active, 1);
  sqlite.close();
});

test('login cannot issue a cookie when account is disabled, deleted or reset during password hashing', async () => {
  for (const mode of ['disabled', 'deleted', 'revision']) {
    const { auth, db, sqlite } = setup();
    await adminSession(auth);
    interceptNextBatch(db, /^INSERT INTO auth_sessions/, () => {
      if (mode === 'disabled') sqlite.prepare('UPDATE auth_accounts SET active = 0 WHERE id = ?').run('viewer-test');
      if (mode === 'deleted') sqlite.prepare('DELETE FROM auth_accounts WHERE id = ?').run('viewer-test');
      if (mode === 'revision') sqlite.prepare('UPDATE auth_accounts SET revision = revision + 1 WHERE id = ?').run('viewer-test');
    });
    await failure(() => auth.login(loginRequest('member-test', memberPassword)), 401);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE account_id = ?').get('viewer-test').count, 0, mode);
    sqlite.close();
  }
});

test('invalid patch fields, missing accounts and database failures return bounded safe errors', async () => {
  const { auth, db, sqlite } = setup(), admin = await adminSession(auth);
  for (const body of [{}, { active: 'false' }, { role: 'owner' }, { password: 'short' }]) await failure(() => auth.updateAccount(accountRequest(admin, 'PATCH', body, 'viewer-test'), 'viewer-test'), 400);
  await failure(() => auth.updateAccount(accountRequest(admin, 'PATCH', { active: false }, 'missing'), 'missing'), 404);
  await failure(() => auth.deleteAccount(accountRequest(admin, 'DELETE', {}, 'missing'), 'missing'), 404);
  interceptNextBatch(db, /^UPDATE auth_accounts/, () => { throw new Error('database failed with secret-bound-value'); });
  const error = await failure(() => auth.updateAccount(accountRequest(admin, 'PATCH', { active: false }, 'viewer-test'), 'viewer-test'), 503);
  assert(!error.message.includes('secret-bound-value')); assert(!error.message.includes('UPDATE'));
  sqlite.close();
});

test('account operations leave workbench snapshot and history untouched', async () => {
  const { auth, sqlite } = setup(), admin = await adminSession(auth);
  sqlite.prepare('INSERT INTO workbench_meta (id, revision, current_snapshot, previous_snapshot, updated_at) VALUES (?, ?, ?, ?, ?)').run('main', 7, 'snapshot-current', 'snapshot-old', '2026-10-29T00:00:00Z');
  sqlite.prepare('INSERT INTO workbench_chunks (snapshot_id, chunk_index, content) VALUES (?, ?, ?)').run('snapshot-current', 0, '{"creators":[{"notes":"保留备注"}]}');
  const beforeMeta = sqlite.prepare('SELECT * FROM workbench_meta').all(), beforeChunks = sqlite.prepare('SELECT * FROM workbench_chunks').all();
  const created = await auth.createAccount(accountRequest(admin, 'POST', { username: 'temporary-reader', password: 'temporary-reader-password' }));
  await auth.updateAccount(accountRequest(admin, 'PATCH', { active: false }, created.account.id), created.account.id);
  await auth.deleteAccount(accountRequest(admin, 'DELETE', {}, created.account.id), created.account.id);
  assert.deepEqual(sqlite.prepare('SELECT * FROM workbench_meta').all(), beforeMeta);
  assert.deepEqual(sqlite.prepare('SELECT * FROM workbench_chunks').all(), beforeChunks);
  sqlite.close();
});

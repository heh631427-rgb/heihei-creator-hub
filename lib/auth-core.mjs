import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const PASSWORD_PARAMETERS = Object.freeze({ N: 16384, r: 8, p: 5, keylen: 32, maxmem: 64 * 1024 * 1024 });
export const SESSION_SECONDS = 12 * 60 * 60;
export const LOGIN_WINDOW_SECONDS = 15 * 60;
const ACCOUNT_LIMIT = 10, IP_LIMIT = 30;
const COOKIE_NAME = '__Host-heihei_session', DEV_COOKIE_NAME = 'heihei_dev_session';
const CONFIG_ERROR = '账号服务暂未就绪，请联系管理员。';

export class AuthError extends Error {
  constructor(message, status = 401, headers = {}) { super(message); this.status = status; this.headers = headers; }
}

export function normalizeUsername(value) { return typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : ''; }
function decodeBase64Url(value, minimum, maximum = minimum) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new AuthError(CONFIG_ERROR, 503);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length < minimum || decoded.length > maximum || decoded.toString('base64url') !== value) throw new AuthError(CONFIG_ERROR, 503);
  return decoded;
}

export function parseAccounts(value) {
  let input;
  try { input = JSON.parse(value); } catch { throw new AuthError(CONFIG_ERROR, 503); }
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new AuthError(CONFIG_ERROR, 503);
  const ids = new Set(), usernames = new Set();
  const accounts = input.map(record => {
    if (!record || typeof record !== 'object') throw new AuthError(CONFIG_ERROR, 503);
    const username = normalizeUsername(record.username);
    if (typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(record.id) || !username || username.length > 254 || !['admin', 'viewer'].includes(record.role) || ids.has(record.id) || usernames.has(username)) throw new AuthError(CONFIG_ERROR, 503);
    decodeBase64Url(record.salt, 16, 64); decodeBase64Url(record.hash, 32);
    ids.add(record.id); usernames.add(username);
    return { id: record.id, username, role: record.role, salt: record.salt, hash: record.hash };
  });
  if (!accounts.some(account => account.role === 'admin')) throw new AuthError(CONFIG_ERROR, 503);
  return accounts;
}

export async function derivePasswordHash(password, salt) {
  const saltBytes = decodeBase64Url(salt, 16, 64);
  return new Promise((resolve, reject) => {
    const { N, r, p, maxmem } = PASSWORD_PARAMETERS;
    scrypt(password, saltBytes, PASSWORD_PARAMETERS.keylen, { N, r, p, maxmem }, (error, key) => error ? reject(error) : resolve(key.toString('base64url')));
  });
}

async function passwordMatches(password, account) {
  const actual = Buffer.from(await derivePasswordHash(password, account.salt), 'base64url');
  return timingSafeEqual(actual, decodeBase64Url(account.hash, 32));
}

export function requireSameOriginJson(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new AuthError('请求来源不正确，请从工作台页面重试。', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new AuthError('请使用 JSON 格式提交数据。', 415);
}

export async function readBoundedJson(request, maxBytes = 4096) {
  const announced = request.headers.get('content-length');
  if (announced && (!/^\d+$/.test(announced) || Number(announced) > maxBytes)) throw new AuthError('提交内容过大。', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError('提交内容不完整。', 400);
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new AuthError('提交内容过大。', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const body = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
    return body;
  } catch { throw new AuthError('提交内容格式不正确。', 400); }
}

const ACCOUNT_BOOTSTRAP_KEY = 'managed-accounts-v1';
const ACCOUNT_COLUMNS = 'id, username, role, active, salt, hash, revision, created_at, updated_at';
const PUBLIC_ACCOUNT_COLUMNS = 'id, username, role, active, created_at, updated_at';

function accountRecord(row) {
  if (!row?.id) return null;
  if (!['admin', 'viewer'].includes(row.role) || ![0, 1].includes(row.active) || !Number.isSafeInteger(row.revision) || row.revision < 0) throw new AuthError(CONFIG_ERROR, 503);
  return row;
}
function publicAccount(account, currentId) {
  return { id: account.id, username: account.username, role: account.role, active: account.active === 1, createdAt: account.created_at, updatedAt: account.updated_at, isCurrent: account.id === currentId };
}
function checkFields(body, allowed) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AuthError('提交内容包含不支持的账号字段。', 400);
}
function managedUsername(value) {
  const username = normalizeUsername(value);
  if (!username || username.length > 254 || /[\s\p{C}]/u.test(username)) throw new AuthError('账号须为 1–254 个字符，不能包含空格或控制字符。', 400);
  return username;
}
function managedPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256 || Buffer.byteLength(value, 'utf8') > 1024) throw new AuthError('新密码须为 8–256 个字符。', 400);
  return value;
}
function managedRole(value) {
  if (!['admin', 'viewer'].includes(value)) throw new AuthError('请选择管理员或普通账号权限。', 400);
  return value;
}
function managedId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new AuthError('账号不存在。', 404);
  return value;
}

export function createAuthService({ db, accountsJSON, sessionSecret, isDev = false, now = Date.now }) {
  if (!db) throw new AuthError(CONFIG_ERROR, 503);
  const secret = decodeBase64Url(sessionSecret, 32, 128);
  const hmac = value => createHmac('sha256', secret).update(value).digest('base64url');
  const hashToken = token => createHash('sha256').update(token).digest('hex');
  // Revision zero preserves the exact legacy five-field fingerprint. Managed
  // changes increment revision, so disable/re-enable cannot revive old sessions.
  const fingerprint = account => {
    const value = { id: account.id, username: account.username, role: account.role, salt: account.salt, hash: account.hash };
    if (account.revision > 0) value.revision = account.revision;
    return hmac(JSON.stringify(value));
  };
  const publicUser = account => ({ username: account.username, role: account.role });
  const dummyAccount = { salt: createHmac('sha256', secret).update('dummy-password-salt').digest().subarray(0, 16).toString('base64url'), hash: hmac('dummy-password-hash') };
  let initialization;

  async function ensureAccounts() {
    if (!initialization) initialization = (async () => {
      const existing = await db.prepare('SELECT id FROM auth_account_config WHERE id = ?').bind(ACCOUNT_BOOTSTRAP_KEY).first();
      if (existing) return;
      const seeds = parseAccounts(accountsJSON), timestamp = new Date(now()).toISOString();
      // All seed rows and the durable marker commit together. Concurrent first
      // requests see the marker inside their transaction and skip every seed.
      const statements = seeds.map(account => db.prepare(`INSERT INTO auth_accounts (${ACCOUNT_COLUMNS}) SELECT ?, ?, ?, 1, ?, ?, 0, ?, ? WHERE NOT EXISTS (SELECT 1 FROM auth_account_config WHERE id = ?)`)
        .bind(account.id, account.username, account.role, account.salt, account.hash, timestamp, timestamp, ACCOUNT_BOOTSTRAP_KEY));
      statements.push(db.prepare('INSERT INTO auth_account_config (id, initialized_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').bind(ACCOUNT_BOOTSTRAP_KEY, timestamp));
      await db.batch(statements);
    })();
    await initialization;
  }
  async function accountById(id) {
    await ensureAccounts();
    return accountRecord(await db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM auth_accounts WHERE id = ?`).bind(id).first());
  }
  async function accountByUsername(username) {
    await ensureAccounts();
    return accountRecord(await db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM auth_accounts WHERE username = ?`).bind(username).first());
  }

  function cookieOptions(request) {
    const url = new URL(request.url);
    if (url.protocol === 'https:') return { name: COOKIE_NAME, secure: true };
    if (isDev && url.protocol === 'http:' && ['localhost', '127.0.0.1', 'terminal.local', '[::1]'].includes(url.hostname)) return { name: DEV_COOKIE_NAME, secure: false };
    throw new AuthError('请通过 HTTPS 打开工作台。', 503);
  }
  function rawToken(request) {
    const name = cookieOptions(request).name;
    const matches = (request.headers.get('cookie') || '').split(';').map(item => item.trim()).filter(item => item.startsWith(name + '=')).map(item => item.slice(name.length + 1));
    if (matches.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(matches[0])) return null;
    return matches[0];
  }
  function sessionCookie(request, token, expiresAt) {
    const { name, secure } = cookieOptions(request);
    return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}; Expires=${new Date(expiresAt * 1000).toUTCString()}${secure ? '; Secure' : ''}`;
  }
  function clearCookie(request) {
    const { name, secure } = cookieOptions(request);
    return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? '; Secure' : ''}`;
  }

  async function currentContext(request) {
    const token = rawToken(request);
    if (!token) return null;
    await ensureAccounts();
    const tokenHash = hashToken(token);
    const row = await db.prepare('SELECT a.*, unixepoch() AS database_now, s.account_fingerprint AS session_fingerprint, s.expires_at AS session_expires_at FROM auth_sessions s LEFT JOIN auth_accounts a ON a.id = s.account_id WHERE s.token_hash = ?').bind(tokenHash).first();
    if (!row) return null;
    const account = accountRecord(row);
    if (!account || account.active !== 1 || row.session_expires_at <= Math.max(Math.floor(now() / 1000), row.database_now) || row.session_fingerprint !== fingerprint(account)) {
      await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).run();
      return null;
    }
    return { account, tokenHash, sessionFingerprint: row.session_fingerprint };
  }
  async function requireContext(request, requiredRole = null) {
    const context = await currentContext(request);
    if (!context) throw new AuthError('请先登录工作台。', 401);
    if (requiredRole === 'admin' && context.account.role !== 'admin') throw new AuthError('此操作需要管理员权限。', 403);
    return context;
  }
  async function currentUser(request) {
    const context = await currentContext(request);
    return context ? publicUser(context.account) : null;
  }
  /** @param {Request} request @param {'admin' | null} [requiredRole] */
  async function requireUser(request, requiredRole = null) { return publicUser((await requireContext(request, requiredRole)).account); }

  async function reserveLoginAttempt(request, username, knownAccount) {
    const seconds = Math.floor(now() / 1000), window = Math.floor(seconds / LOGIN_WINDOW_SECONDS);
    const expires = (window + 1) * LOGIN_WINDOW_SECONDS;
    const ip = ((process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() : request.headers.get('cf-connecting-ip')) || 'unavailable').slice(0, 128);
    const increment = key => db.prepare('INSERT INTO auth_login_limits (bucket_key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket_key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts').bind(key, expires);
    const checkCount = (result, maximum) => {
      const count = Number(result.results?.[0]?.attempts);
      if (!Number.isSafeInteger(count) || count < 1) throw new AuthError('登录服务暂不可用，请稍后再试。', 503);
      if (count > maximum) throw new AuthError('登录尝试过于频繁，请稍后再试。', 429, { 'Retry-After': String(Math.max(1, expires - seconds)) });
    };
    const ipResults = await db.batch([increment(`ip:${window}:${hmac(ip)}`), db.prepare('DELETE FROM auth_login_limits WHERE expires_at <= ?').bind(seconds)]);
    checkCount(ipResults[0], IP_LIMIT);
    if (knownAccount) {
      const accountResults = await db.batch([increment(`account:${window}:${hmac(username)}`)]);
      checkCount(accountResults[0], ACCOUNT_LIMIT);
    }
  }

  async function login(request) {
    requireSameOriginJson(request); cookieOptions(request);
    const body = await readBoundedJson(request);
    const username = normalizeUsername(body.username), password = body.password;
    if (!username || username.length > 254 || typeof password !== 'string' || !password || password.length > 256 || Buffer.byteLength(password, 'utf8') > 1024) throw new AuthError('请输入有效的账号和密码。', 400);
    const account = await accountByUsername(username);
    await reserveLoginAttempt(request, username, !!account);
    const valid = await passwordMatches(password, account || dummyAccount);
    if (!account || account.active !== 1 || !valid) throw new AuthError('账号或密码不正确。', 401);
    const token = randomBytes(32).toString('base64url'), tokenHash = hashToken(token), seconds = Math.floor(now() / 1000), expiresAt = seconds + SESSION_SECONDS;
    const oldToken = rawToken(request);
    // Password hashing is asynchronous: check the current account again in the
    // insert itself, so a concurrent deletion/disable/reset cannot sign in.
    const statements = [db.prepare('INSERT INTO auth_sessions (token_hash, account_id, account_fingerprint, created_at, expires_at) SELECT ?, id, ?, ?, ? FROM auth_accounts WHERE id = ? AND revision = ? AND active = 1 AND username = ? AND role = ? AND salt = ? AND hash = ? RETURNING token_hash')
      .bind(tokenHash, fingerprint(account), seconds, expiresAt, account.id, account.revision, account.username, account.role, account.salt, account.hash)];
    if (oldToken) statements.push(db.prepare('DELETE FROM auth_sessions WHERE token_hash = ? AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash = ?)').bind(hashToken(oldToken), tokenHash));
    statements.push(db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(seconds));
    const results = await db.batch(statements);
    if (results[0].results?.length !== 1) throw new AuthError('账号或密码不正确。', 401);
    return { user: publicUser(account), cookie: sessionCookie(request, token, expiresAt) };
  }

  async function logout(request) {
    requireSameOriginJson(request); await readBoundedJson(request);
    const token = rawToken(request);
    if (token) await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(hashToken(token)).run();
    return { cookie: clearCookie(request) };
  }

  // Rechecked inside each mutation, after any asynchronous hashing. Knowing an
  // account ID/role is insufficient: this exact live admin session must survive.
  const actorGuard = `EXISTS (SELECT 1 FROM auth_accounts actor JOIN auth_sessions actor_session ON actor_session.account_id = actor.id WHERE actor.id = ? AND actor.active = 1 AND actor.role = 'admin' AND actor.revision = ? AND actor_session.token_hash = ? AND actor_session.account_fingerprint = ? AND actor_session.expires_at > MAX(?, unixepoch()))`;
  const actorValues = context => [context.account.id, context.account.revision, context.tokenHash, context.sessionFingerprint, Math.floor(now() / 1000)];

  async function listAccounts(request) {
    const actor = await requireContext(request, 'admin');
    const result = await db.prepare(`SELECT ${PUBLIC_ACCOUNT_COLUMNS} FROM auth_accounts WHERE ${actorGuard} ORDER BY role ASC, created_at ASC, username ASC`).bind(...actorValues(actor)).all();
    const rows = result.results || [];
    if (!rows.length) { await requireContext(request, 'admin'); throw new AuthError('账号信息已更新，请刷新后重试。', 409); }
    return { accounts: rows.map(row => publicAccount(row, actor.account.id)), currentAccountId: actor.account.id, activeAdminCount: rows.filter(row => row.role === 'admin' && row.active === 1).length };
  }

  async function createAccount(request) {
    requireSameOriginJson(request);
    const actor = await requireContext(request, 'admin'), body = await readBoundedJson(request);
    checkFields(body, ['username', 'password', 'role']);
    const username = managedUsername(body.username), password = managedPassword(body.password), role = managedRole(body.role ?? 'viewer');
    const id = `usr_${randomBytes(16).toString('hex')}`, salt = randomBytes(16).toString('base64url'), hash = await derivePasswordHash(password, salt), timestamp = new Date(now()).toISOString();
    let results;
    try {
      results = await db.batch([db.prepare(`INSERT INTO auth_accounts (${ACCOUNT_COLUMNS}) SELECT ?, ?, ?, 1, ?, ?, 1, ?, ? WHERE ${actorGuard} RETURNING ${PUBLIC_ACCOUNT_COLUMNS}`).bind(id, username, role, salt, hash, timestamp, timestamp, ...actorValues(actor))]);
    } catch (error) {
      if (/UNIQUE constraint failed: auth_accounts\.username/i.test(String(error?.message))) throw new AuthError('这个账号已存在，请换一个账号名。', 409);
      throw error;
    }
    const account = results[0].results?.[0];
    if (!account) { await requireContext(request, 'admin'); throw new AuthError('管理员账号已更新，请重新登录后重试。', 409); }
    return { account: publicAccount(account, actor.account.id) };
  }

  async function updateAccount(request, id) {
    requireSameOriginJson(request); managedId(id);
    const actor = await requireContext(request, 'admin'), body = await readBoundedJson(request);
    checkFields(body, ['role', 'active', 'password']);
    if (!Object.keys(body).length) throw new AuthError('请填写需要修改的账号信息。', 400);
    const hasRole = Object.hasOwn(body, 'role'), hasActive = Object.hasOwn(body, 'active'), hasPassword = Object.hasOwn(body, 'password');
    if (hasRole) managedRole(body.role);
    if (hasActive && typeof body.active !== 'boolean') throw new AuthError('账号启用状态不正确。', 400);
    if (hasPassword) managedPassword(body.password);
    if (id === actor.account.id && ((hasActive && !body.active) || (hasRole && body.role !== 'admin'))) throw new AuthError('不能停用或降级当前登录的管理员，请使用另一管理员账号操作。', 400);
    const target = await accountById(id);
    if (!target) throw new AuthError('账号不存在。', 404);
    const role = hasRole ? body.role : target.role, active = hasActive ? Number(body.active) : target.active;
    const salt = hasPassword ? randomBytes(16).toString('base64url') : target.salt;
    const hash = hasPassword ? await derivePasswordHash(body.password, salt) : target.hash;
    const timestamp = new Date(now()).toISOString(), keepsAdmin = role === 'admin' && active === 1;
    const results = await db.batch([
      db.prepare(`UPDATE auth_accounts SET role = ?, active = ?, salt = ?, hash = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND ${actorGuard} AND (? = 1 OR role <> 'admin' OR active <> 1 OR (SELECT COUNT(*) FROM auth_accounts WHERE role = 'admin' AND active = 1) > 1) RETURNING ${PUBLIC_ACCOUNT_COLUMNS}`)
        .bind(role, active, salt, hash, timestamp, id, target.revision, ...actorValues(actor), Number(keepsAdmin)),
      // Adjacent to the guarded update, in the same transaction; a failed CAS
      // must not revoke any unrelated/currently-valid target sessions.
      db.prepare('DELETE FROM auth_sessions WHERE account_id = ? AND changes() = 1').bind(id),
    ]);
    const account = results[0].results?.[0];
    if (!account) {
      await requireContext(request, 'admin');
      const latest = await accountById(id);
      if (!latest) throw new AuthError('账号不存在。', 404);
      if (latest.revision !== target.revision) throw new AuthError('账号已被其他管理员更新，请刷新后重试。', 409);
      throw new AuthError('至少需要保留一个已启用的管理员账号。', 409);
    }
    return { account: publicAccount(account, actor.account.id), sessionRevoked: id === actor.account.id };
  }

  async function deleteAccount(request, id) {
    requireSameOriginJson(request); managedId(id);
    const actor = await requireContext(request, 'admin');
    if (request.body) checkFields(await readBoundedJson(request), []);
    if (id === actor.account.id) throw new AuthError('不能删除当前登录的管理员，请使用另一管理员账号操作。', 400);
    const target = await accountById(id);
    if (!target) throw new AuthError('账号不存在。', 404);
    const results = await db.batch([
      db.prepare(`DELETE FROM auth_accounts WHERE id = ? AND revision = ? AND ${actorGuard} AND (role <> 'admin' OR active <> 1 OR (SELECT COUNT(*) FROM auth_accounts WHERE role = 'admin' AND active = 1) > 1) RETURNING id`).bind(id, target.revision, ...actorValues(actor)),
      db.prepare('DELETE FROM auth_sessions WHERE account_id = ? AND changes() = 1').bind(id),
    ]);
    if (results[0].results?.length !== 1) {
      await requireContext(request, 'admin');
      const latest = await accountById(id);
      if (!latest) throw new AuthError('账号不存在。', 404);
      if (latest.revision !== target.revision) throw new AuthError('账号已被其他管理员更新，请刷新后重试。', 409);
      throw new AuthError('至少需要保留一个已启用的管理员账号。', 409);
    }
    return { deletedId: id };
  }

  // D1 errors can include SQL/bindings. Never propagate them to generic route
  // logging or a response; known validation/permission errors are already safe.
  const safe = method => async (...args) => { try { return await method(...args); } catch (error) { if (error instanceof AuthError) throw error; throw new AuthError('账号服务暂不可用，请稍后再试。', 503); } };
  return { currentUser: safe(currentUser), requireUser: safe(requireUser), login: safe(login), logout: safe(logout), listAccounts: safe(listAccounts), createAccount: safe(createAccount), updateAccount: safe(updateAccount), deleteAccount: safe(deleteAccount) };
}

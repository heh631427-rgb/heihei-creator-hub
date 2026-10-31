import { createClient } from '@libsql/client';

// Keep the existing SQL and atomic-batch semantics while replacing D1.
export function adaptClient(client) {
  const result = r => ({ results: r.rows.map(row => Object.fromEntries(Object.entries(row))), success: true, meta: { changes: r.rowsAffected } });
  function prepare(sql, args = []) {
    return {
      sql, args,
      bind(...values) { return prepare(sql, values); },
      async first() { return (await client.execute({ sql, args })).rows[0] || null; },
      async all() { return result(await client.execute({ sql, args })); },
      async run() { return result(await client.execute({ sql, args })); },
    };
  }
  return { prepare, async batch(statements) { return (await client.batch(statements.map(s => ({ sql: s.sql, args: s.args })), 'write')).map(result); } };
}
let client, database;
export function getClient() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url || (process.env.VERCEL && !/^libsql:\/\//.test(url))) throw new Error('Configure a remote libSQL database in TURSO_DATABASE_URL.');
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return client;
}
export function getDatabase() { return database ??= adaptClient(getClient()); }

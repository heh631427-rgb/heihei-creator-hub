import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getClient } from '../lib/database.mjs';
const client=getClient();
try {
  await client.execute('CREATE TABLE IF NOT EXISTS migration_log (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const root=new URL('../drizzle/',import.meta.url);
  for(const name of (await readdir(root)).filter(n=>n.endsWith('.sql')).sort()) {
    const sql=await readFile(new URL(name,root),'utf8'), hash=createHash('sha256').update(sql).digest('hex');
    const found=(await client.execute({sql:'SELECT sha256 FROM migration_log WHERE name=?',args:[name]})).rows[0];
    if(found){if(found.sha256!==hash)throw new Error('Applied migration checksum mismatch: '+name);continue;}
    const statements=sql.split(';').map(s=>s.replace(/--> statement-breakpoint/g,'').trim()).filter(Boolean);
    await client.batch([...statements,{sql:'INSERT INTO migration_log VALUES (?,?,?)',args:[name,hash,new Date().toISOString()]}],'write');
    console.log('Applied '+name);
  }
  console.log('Database schema is ready.');
}catch(error){console.error('Database setup failed. Check database configuration and migration state.');process.exitCode=1;}finally{client.close();}

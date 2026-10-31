import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const backup=resolve(process.argv[2]||'../private-data');
for(const name of ['workbench-backup.json','auth-accounts.json'])if(!existsSync(join(backup,name)))throw new Error('Missing backup file: '+name);
for(const key of ['TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','WORKBENCH_SESSION_SECRET'])if(!process.env[key]||/REPLACE_|YOUR_|GENERATE_/.test(process.env[key]))throw new Error('Configure '+key+' in .env.local first.');
if(!process.env.TURSO_DATABASE_URL.startsWith('libsql://'))throw new Error('Use your remote libSQL database URL for migration.');
const {getClient}=await import('../lib/database.mjs');const client=getClient();
let skipAccounts=false,skipState=false;
try{
 const tables=(await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('auth_accounts','workbench_meta')")).rows.map(r=>r.name);
 if(tables.includes('auth_accounts')){
  const current=(await client.execute('SELECT id,username,role,active,salt,hash,revision,created_at,updated_at FROM auth_accounts ORDER BY id')).rows;
  if(current.length){const incoming=JSON.parse(readFileSync(join(backup,'auth-accounts.json'),'utf8'));if(current.length!==incoming.length||current.some(r=>{const v=incoming.find(x=>x.id===r.id);return !v||Object.keys(r).some(k=>r[k]!==v[k])}))throw new Error('Destination accounts differ from this backup. No existing data was changed.');skipAccounts=true;}
 }
 if(tables.includes('workbench_meta')&&(await client.execute('SELECT COUNT(*) AS n FROM workbench_meta')).rows[0].n>0){
  const {readState}=await import('../lib/server-store.ts');const current=await readState(),source=JSON.parse(readFileSync(join(backup,'workbench-backup.json'),'utf8'));
  if(current.revision>0){if(Object.entries(source).some(([k,v])=>JSON.stringify(v)!==JSON.stringify(current.state[k])))throw new Error('Destination business data differs from this backup. No existing data was changed.');skipState=true;}
 }
}finally{client.close();}
const steps=[['scripts/setup-db.mjs']];
if(!skipAccounts)steps.push(['scripts/restore-accounts.mjs',join(backup,'auth-accounts.json')]);
if(!skipState)steps.push(['scripts/import-backup.mjs',join(backup,'workbench-backup.json')]);
for(const args of steps){const result=spawnSync(process.execPath,['--env-file-if-exists=.env.local',...args],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
console.log('Migration completed or verified already imported. Configure the same three server-only variables in Vercel, then deploy.');

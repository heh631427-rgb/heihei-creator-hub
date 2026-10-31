import { readFile } from 'node:fs/promises';
import { getClient } from '../lib/database.mjs';
import { parseAccounts } from '../lib/auth-core.mjs';
const file=process.argv[2];if(!file)throw new Error('Usage: npm run accounts:restore -- PATH_TO_PRIVATE_AUTH_ACCOUNTS_JSON');
const rows=JSON.parse(await readFile(file,'utf8'));
parseAccounts(JSON.stringify(rows));
if(!rows.some(r=>r.username==='heh631427@gmail.com'&&r.role==='admin'&&r.active===1))throw new Error('Expected migration administrator is missing.');
for(const row of rows)if(![0,1].includes(row.active)||!Number.isSafeInteger(row.revision)||row.revision<0)throw new Error('Invalid account metadata.');
const client=getClient();
try{
 const count=(await client.execute('SELECT COUNT(*) AS n FROM auth_accounts')).rows[0].n;
 if(count!==0)throw new Error('Destination already contains accounts; no accounts were overwritten.');
 const cols=['id','username','role','active','salt','hash','revision','created_at','updated_at'];
 await client.batch([...rows.map(row=>({sql:`INSERT INTO auth_accounts (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,args:cols.map(k=>row[k])})),{sql:'INSERT INTO auth_account_config (id,initialized_at) VALUES (?,?)',args:['managed-accounts-v1',new Date().toISOString()]}],'write');
 console.log(`Restored ${rows.length} accounts. Existing passwords and roles retained. Old login sessions were not copied.`);
}catch(error){console.error('Account restoration failed:',error.message.includes('Destination')?error.message:'Check configuration; no partial batch is committed.');process.exitCode=1;}finally{client.close();}

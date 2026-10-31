import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { getClient } from '../lib/database.mjs';
import { derivePasswordHash, normalizeUsername } from '../lib/auth-core.mjs';
// Optional fresh-install alternative. Migration should use accounts:restore.
if(!process.stdin.isTTY)throw new Error('Run interactively in your terminal; passwords must not be command-line arguments.');
const rl=createInterface({input:process.stdin,output:process.stdout});
const ask=q=>new Promise(r=>rl.question(q,r));
const username=normalizeUsername(await ask('Administrator email [heh631427@gmail.com]: '))||'heh631427@gmail.com';rl.close();
async function passwordPrompt(){
 process.stdout.write('New password (hidden, minimum 8 characters): ');process.stdin.setRawMode(true);process.stdin.resume();
 let value='';return await new Promise((resolve,reject)=>{
  const finish=(error)=>{process.stdin.off('data',listener);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);};
  const listener=chunk=>{for(const ch of chunk.toString()){if(ch==='\u0003'){finish(new Error('Cancelled'));return;}if(ch==='\r'||ch==='\n'){finish();return;}if(ch==='\u007f')value=value.slice(0,-1);else value+=ch;}};process.stdin.on('data',listener);
 });
}
const password=await passwordPrompt();if(password.length<8||password.length>256)throw new Error('Password must be 8–256 characters.');
const salt=randomBytes(16).toString('base64url'),hash=await derivePasswordHash(password,salt),client=getClient();
try{
 if((await client.execute('SELECT COUNT(*) AS n FROM auth_accounts')).rows[0].n!==0)throw new Error('Existing accounts detected; use the account administration screen.');
 const timestamp=new Date().toISOString();
 await client.batch([{sql:'INSERT INTO auth_accounts VALUES (?,?,?,?,?,?,?,?,?)',args:['migration-admin',username,'admin',1,salt,hash,0,timestamp,timestamp]},{sql:'INSERT INTO auth_account_config VALUES (?,?)',args:['managed-accounts-v1',timestamp]}],'write');
 console.log('Administrator created. Password was not saved as plain text.');
}finally{client.close();}

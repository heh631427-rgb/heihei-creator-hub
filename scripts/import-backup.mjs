import { readFile } from 'node:fs/promises';
import { readState, saveState } from '../lib/server-store.ts';
import { getClient } from '../lib/database.mjs';
const file=process.argv[2];if(!file)throw new Error('Usage: npm run backup:import -- PATH_TO_BACKUP_JSON');
try{
 const current=await readState();
 if(current.revision!==0)throw new Error('Destination is not empty; refusing to overwrite existing work.');
 const source=JSON.parse(await readFile(file,'utf8'));
 const state=source.state && Number.isInteger(source.revision)?source.state:source;
 const result=await saveState(state,0,'迁移：导入原工作台完整备份',false);
 const roundTrip=await readState();
 // Compare every source field. The validator may add default fields only.
 for(const [key,value] of Object.entries(state))if(JSON.stringify(roundTrip.state[key])!==JSON.stringify(value))throw new Error('Round-trip mismatch: '+key);
 console.log(JSON.stringify({imported:true,revision:result.revision,counts:result.counts,verified:'all source fields'}));
}catch(error){console.error('Backup import failed:',error.message);process.exitCode=1;}finally{getClient().close();}

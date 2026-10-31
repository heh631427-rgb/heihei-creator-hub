import { writeFile } from 'node:fs/promises';
import { readState } from '../lib/server-store.ts';
import { getClient } from '../lib/database.mjs';
const file=process.argv[2];if(!file)throw new Error('Usage: npm run backup:export -- OUTPUT_JSON');
try{const snapshot=await readState();await writeFile(file,JSON.stringify(snapshot),{mode:0o600,flag:'wx'});console.log('Backup created; revision '+snapshot.revision);}finally{getClient().close();}

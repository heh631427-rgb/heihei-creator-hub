import { getDatabase } from './database.mjs';
import { createTransferService } from './transfer-core.mjs';
import { readState, saveState } from './server-store';
import { visibleWorkbenchSnapshot } from './state-visibility.mjs';
export function transfers() {
  return createTransferService({ db: getDatabase(), readVisible: async (user: any) => visibleWorkbenchSnapshot(await readState(),user), save: saveState });
}

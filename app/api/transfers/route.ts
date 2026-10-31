import { authService, authJson, routeError } from '../../../lib/server-auth';
import { requireSameOriginJson, readBoundedJson } from '../../../lib/auth-core.mjs';
import { transfers } from '../../../lib/server-transfers';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const user = await authService().requireUser(request);
    requireSameOriginJson(request);
    return authJson(await transfers().begin(user, await readBoundedJson(request)));
  } catch(error) { return routeError(error); }
}

import { authService, authJson, routeError } from '../../../../../lib/server-auth';
import { requireSameOriginJson } from '../../../../../lib/auth-core.mjs';
import { transfers } from '../../../../../lib/server-transfers';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request, context: {params:Promise<{id:string}>}) {
  try {
    const user=await authService().requireUser(request,'admin');
    requireSameOriginJson(request);
    return authJson(await transfers().commit(user,(await context.params).id));
  } catch(error) { return routeError(error); }
}

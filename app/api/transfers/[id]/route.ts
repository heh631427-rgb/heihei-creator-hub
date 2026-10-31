import { authService, authJson, routeError } from '../../../../lib/server-auth';
import { requireSameOriginJson, readBoundedJson } from '../../../../lib/auth-core.mjs';
import { transfers } from '../../../../lib/server-transfers';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = { params: Promise<{id: string}> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await authService().requireUser(request);
    return authJson(await transfers().download(user,(await context.params).id,Number(new URL(request.url).searchParams.get('start'))));
  } catch(error) { return routeError(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const user = await authService().requireUser(request,'admin');
    requireSameOriginJson(request);
    const body = await readBoundedJson(request, 3*1024*1024);
    return authJson(await transfers().upload(user,(await context.params).id,body.start,body.chunks));
  } catch(error) { return routeError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const user = await authService().requireUser(request);
    requireSameOriginJson(request);
    return authJson(await transfers().remove(user,(await context.params).id));
  } catch(error) { return routeError(error); }
}

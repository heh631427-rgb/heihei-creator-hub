import { authJson, authService, routeError } from "../../../../../lib/server-auth";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: RouteContext) {
  try { const { id } = await context.params; return authJson(await authService().updateAccount(request, id)); }
  catch (error) { return routeError(error); }
}
export async function DELETE(request: Request, context: RouteContext) {
  try { const { id } = await context.params; return authJson(await authService().deleteAccount(request, id)); }
  catch (error) { return routeError(error); }
}

export const runtime = "nodejs";
export const maxDuration = 300;

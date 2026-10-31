import { authJson, authService, routeError } from "../../../../lib/server-auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return authJson({ user: await authService().currentUser(request) }); }
  catch (error) { return routeError(error); }
}

export const runtime = "nodejs";
export const maxDuration = 300;

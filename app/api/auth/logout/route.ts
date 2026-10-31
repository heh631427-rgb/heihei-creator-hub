import { authJson, authService, routeError } from "../../../../lib/server-auth";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { const result = await authService().logout(request); return authJson({ user: null }, 200, { "Set-Cookie": result.cookie }); }
  catch (error) { return routeError(error); }
}

export const runtime = "nodejs";
export const maxDuration = 300;

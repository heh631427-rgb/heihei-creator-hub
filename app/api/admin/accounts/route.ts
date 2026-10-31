import { authJson, authService, routeError } from "../../../../lib/server-auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return authJson(await authService().listAccounts(request)); }
  catch (error) { return routeError(error); }
}
export async function POST(request: Request) {
  try { return authJson(await authService().createAccount(request), 201); }
  catch (error) { return routeError(error); }
}

export const runtime = "nodejs";
export const maxDuration = 300;

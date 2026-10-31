import { undoState, jsonResponse, StoreError } from "../../../lib/server-store";
import { authService, routeError } from "../../../lib/server-auth";
import { requireSameOriginJson, readBoundedJson } from "../../../lib/auth-core.mjs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { await authService().requireUser(request, "admin"); requireSameOriginJson(request); const body = await readBoundedJson(request) as { revision?: number } | null;
    if (!body || typeof body.revision !== "number") throw new StoreError("缺少数据版本，请刷新后重试。",400);
    const { state: _state, ...result } = await undoState(body.revision); return jsonResponse(result); }
  catch(error) { return routeError(error); }
}

export const runtime = "nodejs";
export const maxDuration = 300;

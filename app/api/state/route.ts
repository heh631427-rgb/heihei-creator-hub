import { readState, saveState, jsonResponse, StoreError } from "../../../lib/server-store";
import { authService, routeError } from "../../../lib/server-auth";
import { requireSameOriginJson, readBoundedJson } from "../../../lib/auth-core.mjs";
import { visibleWorkbenchSnapshot } from "../../../lib/state-visibility.mjs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await authService().requireUser(request);
    const result = visibleWorkbenchSnapshot(await readState(), user);
    if (Buffer.byteLength(JSON.stringify(result)) > 3 * 1024 * 1024) throw new StoreError("请使用工作台的分片读取接口。", 413);
    return jsonResponse(result);
  } catch(error) { return routeError(error); }
}
export async function PUT(request: Request) {
  try {
    await authService().requireUser(request, "admin");
    requireSameOriginJson(request);
    const body = await readBoundedJson(request, 3*1024*1024) as { state?: unknown; revision?: number; reason?: string } | null;
    if (!body || typeof body.revision !== "number") throw new StoreError("缺少数据版本，请刷新后重试。",400);
    return jsonResponse(await saveState(body.state,body.revision,body.reason || "更新工作台"));
  } catch(error) { return routeError(error); }
}

export const runtime = "nodejs";
export const maxDuration = 300;

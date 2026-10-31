import { getDatabase } from "./database.mjs";
import { AuthError, createAuthService } from "./auth-core.mjs";
import { TransferError } from "./transfer-core.mjs";
import { errorResponse } from "./server-store";
export function authService() {
  return createAuthService({ db: getDatabase(), accountsJSON: process.env.WORKBENCH_AUTH_ACCOUNTS, sessionSecret: process.env.WORKBENCH_SESSION_SECRET, isDev: process.env.NODE_ENV !== "production" });
}
export function authJson(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders } });
}
export function routeError(error: unknown) {
  if (error instanceof AuthError) return authJson({ error: error.message }, error.status, error.headers);
  if (error instanceof TransferError) return authJson({ error: error.message }, error.status);
  return errorResponse(error);
}

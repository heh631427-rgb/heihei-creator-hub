import { getDatabase } from "./database.mjs";
import { createEmptyState } from "./creator-engine.mjs";
import { validateCommissionState } from "./creator-commissions.mjs";
const collections = ["samples", "orders", "productMappings", "videos", "videoBaselines", "pendingVideoImports", "videoReportArchives", "videoViewMaxima", "creators", "preferences", "promotions", "imports"];
const MAX_BYTES = 24 * 1024 * 1024;
// D1 RPC serializes strings again (including UTF-16 / JSON expansion). Never
// send or receive a complete workspace in one database call.
const CHUNK_CHARS = 180000;
const CHUNKS_PER_CALL = 8;
type Meta = { revision: number; current_snapshot: string; previous_snapshot: string; updated_at: string };
export class StoreError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function db() { return getDatabase(); }
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new StoreError("不允许跨站修改数据。", 403);
}
export function validateState(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new StoreError("数据格式不正确，请导入工作台导出的备份。");
  const value = input as Record<string, any>;
  const result: Record<string, any> = { ...createEmptyState(), ...value, schemaVersion: 1 };
  for (const name of collections) {
    if (!Array.isArray(result[name])) throw new StoreError(`${name} 必须是记录数组。`);
    if (result[name].length > 150000) throw new StoreError("单类记录超过 150,000 条，请拆分数据范围。");
    if (result[name].some((r: unknown) => !r || typeof r !== "object" || Array.isArray(r))) throw new StoreError(`${name} 含有无效记录。`);
  }
  for (const name of ["videoBaselines", "pendingVideoImports", "videoReportArchives"]) {
    for (const report of result[name]) {
      if (!Array.isArray(report.records) || report.records.length > 150000 || report.records.some((r: unknown) => !r || typeof r !== "object" || Array.isArray(r))) {
        throw new StoreError(`${name} 中的视频明细格式不正确。`);
      }
    }
  }
  if (!result.settings || typeof result.settings !== "object" || Array.isArray(result.settings)) throw new StoreError("规则设置格式不正确。");
  try { validateCommissionState(result); }
  catch (error) { throw new StoreError(error instanceof Error ? error.message : "佣金记录格式不正确。"); }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_BYTES) throw new StoreError("数据量超过当前单工作台 24 MB 上限，请缩小导入范围。", 413);
  return result;
}
async function meta(): Promise<Meta | null> {
  return db().prepare("SELECT revision,current_snapshot,previous_snapshot,updated_at FROM workbench_meta WHERE id = ?").bind("main").first<Meta>();
}
async function readSnapshot(id: string) {
  const database = db();
  const shape = await database.prepare("SELECT COUNT(*) AS count, MIN(chunk_index) AS first_index, MAX(chunk_index) AS last_index FROM workbench_chunks WHERE snapshot_id = ?").bind(id).first<{count: number; first_index: number | null; last_index: number | null}>();
  if (!shape || !Number.isSafeInteger(shape.count) || shape.count < 1 || shape.count > Math.ceil(MAX_BYTES / (CHUNK_CHARS - 1)) || shape.first_index !== 0 || shape.last_index !== shape.count - 1) throw new StoreError("保存的数据分片不完整，请刷新后重试。", 503);
  const contents: string[] = []; let bytes = 0;
  while (contents.length < shape.count) {
    const rows = await database.prepare("SELECT chunk_index,content FROM workbench_chunks WHERE snapshot_id = ? AND chunk_index >= ? ORDER BY chunk_index LIMIT ?").bind(id, contents.length, CHUNKS_PER_CALL).all<{chunk_index: number; content: string}>();
    if (!rows.results?.length) throw new StoreError("未能读取完整的保存数据，请重试。", 503);
    for (const row of rows.results) {
      if (row.chunk_index !== contents.length || row.chunk_index >= shape.count || typeof row.content !== "string" || row.content.length > CHUNK_CHARS) throw new StoreError("保存的数据分片不完整，请刷新后重试。", 503);
      bytes += new TextEncoder().encode(row.content).byteLength;
      if (bytes > MAX_BYTES) throw new StoreError("保存的数据超过工作台大小上限，请联系管理员。", 503);
      contents.push(row.content);
    }
  }
  try { return JSON.parse(contents.join("")); }
  catch { throw new StoreError("保存的数据未能完整解析，请刷新后重试。", 503); }
}
export async function readState() {
  const current = await meta();
  if (!current?.current_snapshot) return { state: createEmptyState(), revision: 0, updatedAt: null, canUndo: false };
  return { state: await readSnapshot(current.current_snapshot), revision: current.revision, updatedAt: current.updated_at, canUndo: !!current.previous_snapshot };
}
export async function saveState(input: unknown, revision: number, reason: string, keepPrevious = true) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new StoreError("缺少有效的数据版本，请刷新后重试。", 409);
  const state = validateState(input);
  const before = await meta();
  if ((before?.revision ?? 0) !== revision) throw new StoreError("数据已在其他页面更新。请先导出当前备份，再刷新并重新导入；不会覆盖其他页面的数据。", 409);
  const database = db(); const snapshotId = crypto.randomUUID(); const updatedAt = new Date().toISOString();
  const serialized = JSON.stringify(state); const chunks: string[] = [];
  for (let start = 0; start < serialized.length;) {
    let end = Math.min(start + CHUNK_CHARS, serialized.length); const last = serialized.charCodeAt(end - 1);
    if (end < serialized.length && last >= 0xD800 && last <= 0xDBFF) end--;
    chunks.push(serialized.slice(start, end)); start = end;
  }
  const counts = Object.fromEntries(collections.map(name => [name, state[name].length]));
  let publicationAttempted = false;
  try {
    await database.prepare("INSERT OR IGNORE INTO workbench_meta (id,revision,current_snapshot,previous_snapshot,updated_at) VALUES (?,0,'','',?)").bind("main", updatedAt).run();
    // Staged rows are immutable and invisible to readers until the final CAS.
    // Each batch is small; another writer may win between these calls.
    for (let start = 0; start < chunks.length; start += CHUNKS_PER_CALL) {
      const statements = chunks.slice(start, start + CHUNKS_PER_CALL).map((chunk, index) => database.prepare("INSERT INTO workbench_chunks (snapshot_id,chunk_index,content) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM workbench_meta WHERE id = ? AND revision = ?)").bind(snapshotId, start + index, chunk, "main", revision));
      const results = await database.batch(statements);
      if (results.length !== statements.length || results.some(result => result.meta?.changes !== 1)) throw new StoreError("保存时检测到其他页面更新，请刷新后重试。", 409);
    }
    publicationAttempted = true;
    const results = await database.batch([
      database.prepare("UPDATE workbench_meta SET revision = ?, previous_snapshot = CASE WHEN ? = 1 THEN current_snapshot ELSE '' END, current_snapshot = ?, updated_at = ? WHERE id = ? AND revision = ? AND (SELECT COUNT(*) = ? AND MIN(chunk_index) = 0 AND MAX(chunk_index) = ? FROM workbench_chunks WHERE snapshot_id = ?)").bind(revision + 1, keepPrevious ? 1 : 0, snapshotId, updatedAt, "main", revision, chunks.length, chunks.length - 1, snapshotId),
      // changes=0 is not a SQL error. The history insert must depend on the
      // successful CAS, so a stale or incomplete writer publishes neither row.
      database.prepare("INSERT INTO workbench_history (snapshot_id,revision,reason,created_at,counts) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workbench_meta WHERE id = ? AND revision = ? AND current_snapshot = ?)").bind(snapshotId, revision + 1, String(reason || "更新工作台").slice(0,250), updatedAt, JSON.stringify(counts), "main", revision + 1, snapshotId),
    ]);
    if (results[0]?.meta?.changes !== 1) {
      const latest = await meta();
      if (latest?.revision !== revision) throw new StoreError("保存时检测到其他页面更新，请刷新后重试。", 409);
      throw new StoreError("保存的数据分片不完整，本次未发布，请保留当前页面并重试。", 503);
    }
  } catch (error) {
    // A transport failure can occur after the atomic transaction committed.
    // History is its commit marker; do not erase or report failure for that save.
    let committed = false;
    if (publicationAttempted) {
      try { committed = !!await database.prepare("SELECT snapshot_id FROM workbench_history WHERE snapshot_id = ? AND revision = ?").bind(snapshotId, revision + 1).first(); }
      catch { /* Cleanup below also protects every published snapshot. */ }
    }
    if (!committed) {
      try { await database.prepare("DELETE FROM workbench_chunks WHERE snapshot_id = ? AND NOT EXISTS (SELECT 1 FROM workbench_history WHERE snapshot_id = ?) AND snapshot_id NOT IN (SELECT current_snapshot FROM workbench_meta UNION SELECT previous_snapshot FROM workbench_meta)").bind(snapshotId, snapshotId).run(); }
      catch { /* Unpublished leftovers are safer than deleting another writer. */ }
      throw error;
    }
  }
  try {
    await database.batch([
      // Only prune known, published history. Other writers' staging rows have
      // no history entry yet and must survive this unrelated save's cleanup.
      database.prepare("DELETE FROM workbench_chunks WHERE snapshot_id IN (SELECT snapshot_id FROM workbench_history) AND snapshot_id NOT IN (SELECT snapshot_id FROM workbench_history ORDER BY revision DESC LIMIT 10) AND snapshot_id NOT IN (SELECT current_snapshot FROM workbench_meta UNION SELECT previous_snapshot FROM workbench_meta)"),
      database.prepare("DELETE FROM workbench_history WHERE snapshot_id NOT IN (SELECT snapshot_id FROM workbench_history ORDER BY revision DESC LIMIT 10) AND snapshot_id NOT IN (SELECT current_snapshot FROM workbench_meta UNION SELECT previous_snapshot FROM workbench_meta)"),
    ]);
  } catch { /* Never turn an already committed save into a retry. */ }
  return { revision: revision+1, updatedAt, canUndo: keepPrevious && !!before?.current_snapshot, counts };
}
export async function undoState(revision: number) {
  const current = await meta();
  if (!current || current.revision !== revision) throw new StoreError("数据版本已变化，请刷新后重试。",409);
  if (!current.previous_snapshot) throw new StoreError("没有可撤销的保存记录。");
  const state = await readSnapshot(current.previous_snapshot); const saved = await saveState(state, revision, "撤销上次保存", false);
  return { ...saved, state };
}
export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });
}
export function errorResponse(error: unknown) {
  if (error instanceof StoreError) return jsonResponse({ error: error.message },error.status);
  console.error("Workbench persistence operation failed");
  return jsonResponse({ error: "保存服务暂时不可用，请保留当前页面并重试。" },503);
}

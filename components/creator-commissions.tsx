"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Archive, BellRing, CalendarDays, Check, CheckCircle2, ChevronDown, Download, Edit3, FileSpreadsheet, Loader2, Plus, Search, Trash2, Upload, X } from "lucide-react";
import * as CommissionEngine from "../lib/creator-commissions.mjs";
import Pagination from "./workbench-pagination";
import "./creator-commissions.css";

const C: any = CommissionEngine;
type Item = Record<string, any>;
type ImportKind = "affiliateOrders" | "targetCommissions";
type Props = { state: Item; data: Item; isAdmin: boolean; saving: boolean; onSave: (state: Item, reason: string) => Promise<boolean>; ensureXlsx: () => Promise<any> };
type ImportDraft = { kind: ImportKind; fileName: string; sourceHash: string; workbook: any; sheet: string; rows: any[][]; headerRow: number; mapping: Record<string, any> };
const emptyImport = (kind: ImportKind = "affiliateOrders"): ImportDraft => ({ kind, fileName: "", sourceHash: "", workbook: null, sheet: "", rows: [], headerRow: 1, mapping: {} });
const text = (value: any) => value == null ? "" : String(value);
const creatorId = (value: any) => text(value).trim().replace(/^@/, "").toLowerCase();
const count = (value: any) => new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
const rate = (value: any) => value == null || value === "" ? "未提供" : `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(Number(value))}%`;
const amount = (value: any, currency: string) => value == null || value === "" ? "未提供" : `${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))} ${currency || "币种待确认"}`;
const date = (value: any) => text(value).slice(0, 10) || "未提供";
const STATUS: Record<string, { label: string; tone: string }> = {
  expired: { label: "已过期", tone: "red" }, due_today: { label: "今天到期", tone: "red" }, expiring: { label: "即将到期", tone: "amber" },
  active: { label: "有效", tone: "green" }, needs_confirmation: { label: "日期待确认", tone: "amber" }, archived: { label: "已归档", tone: "neutral" },
};
function todayInUserTimeZone() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function useCommissionData(state: Item | null) {
  const [today, setToday] = useState(todayInUserTimeZone);
  useEffect(() => { const timer = window.setInterval(() => setToday(todayInUserTimeZone()), 60000); return () => window.clearInterval(timer); }, []);
  return useMemo(() => C.deriveCommissions(state || {}, { today }), [state, today]);
}
function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) { return <span className={`cm-tag cm-${tone}`}>{children}</span>; }
function Field({ title, children, help, required = false, error }: { title: string; children: React.ReactNode; help?: string; required?: boolean; error?: string }) { return <label className={`cm-field${required ? " cm-field-required" : ""}${error ? " cm-field-invalid" : ""}`}><span>{title}{required && <em>必填</em>}</span>{children}{help && <small>{help}</small>}{error && <small className="cm-field-error" role="alert">{error}</small>}</label>; }
function Empty({ children }: { children: React.ReactNode }) { return <div className="cm-empty"><FileSpreadsheet size={25} /><p>{children}</p></div>; }
function TargetDeleteDialog({ record, pending, error, onClose, onConfirm }: { record: Item; pending: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; if (element && !element.open) element.showModal(); return () => { if (element?.open) element.close(); }; }, []);
  return <dialog ref={dialog} className="cm-delete-dialog" aria-labelledby="cm-delete-title" aria-describedby="cm-delete-description" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <header><span className="cm-delete-icon"><Trash2 size={23} aria-hidden="true" /></span><button type="button" className="icon-button" aria-label="关闭删除确认" disabled={pending} onClick={onClose}><X size={19} /></button></header>
    <h3 id="cm-delete-title">删除这条 Target 佣金安排？</h3>
    <p id="cm-delete-description">请核对以下安排。确认保存后，这条记录会从 Target 列表及到期提醒中移除。</p>
    <dl className="cm-delete-details">
      <div><dt>达人 / 适用范围</dt><dd>{record.creatorId ? `@${record.creatorId}` : record.groupName || "未指定达人"}{record.creatorId && record.groupName && <small>群组：{record.groupName}</small>}</dd></div>
      <div><dt>商品 SKU</dt><dd>{record.sku || "未填写"}</dd></div>
      <div><dt>产品 PID</dt><dd>{record.productId || "待匹配"}</dd></div>
      <div><dt>Target 佣金率</dt><dd>{rate(record.commissionRate)}</dd></div>
      <div><dt>到期日期</dt><dd>{record.expiresOn || record.expiryOriginal || "未填写"}{!record.expiryConfirmed && (record.expiresOn || record.expiryOriginal) && <small>日期尚待确认</small>}</dd></div>
      <div><dt>记录状态</dt><dd>{record.status === "archived" ? "已归档" : "未归档"}</dd></div>
    </dl>
    <p className="cm-delete-undo-note">若误删且尚未进行下一次更新，可在导入中心“撤回上次更新”，恢复上一次保存前的整个业务状态。仅支持撤回一步。</p>
    {error && <p className="cm-delete-error" role="alert"><AlertCircle size={16} /><span>{error}</span></p>}
    <footer><button type="button" className="button" disabled={pending} onClick={onClose} autoFocus>取消</button><button type="button" className="button cm-delete-confirm" disabled={pending} onClick={onConfirm}>{pending ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}{pending ? "正在删除" : "确认删除"}</button></footer>
  </dialog>;
}
function csvValue(value: any) { let s = Array.isArray(value) ? value.join("、") : text(value); if (/^[=+@-]/.test(s.trimStart()) || /^\d{15,}$/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; }
function downloadRows(name: string, rows: Item[], columns: [string, string][]) {
  const blob = new Blob(["\ufeff", [columns.map(([, label]) => csvValue(label)).join(","), ...rows.map(row => columns.map(([key]) => csvValue(row[key])).join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function rowsFromWorkbook(workbook: any, sheetName: string, XLSX: any): any[][] {
  const sheet = workbook.Sheets[sheetName];
  let maxRow = 0, maxCol = 0;
  for (const address of Object.keys(sheet)) if (/^[A-Z]+\d+$/.test(address) && sheet[address]?.v != null) { const cell = XLSX.utils.decode_cell(address); maxRow = Math.max(maxRow, cell.r); maxCol = Math.max(maxCol, cell.c); }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: true, range: { s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } } });
  for (const address of Object.keys(sheet)) if (/^[A-Z]+\d+$/.test(address) && typeof sheet[address]?.v === "number" && /[%％]/.test(text(sheet[address]?.w))) { const cell = XLSX.utils.decode_cell(address); if (rows[cell.r]) rows[cell.r][cell.c] = sheet[address].w; }
  return rows;
}
function latestRateLabel(latest: any, latestRates: any[], conflict: boolean) { return conflict && latestRates?.length ? `${latestRates.map(rate).join(" / ")}（同时间不同值）` : rate(latest); }
function RateCell({ latest, observedAt, history, latestRates = [], conflict = false }: { latest: any; observedAt: any; history: any[]; latestRates?: any[]; conflict?: boolean }) {
  return <div className="cm-rate-cell"><strong>{latestRateLabel(latest, latestRates, conflict)}</strong><small>{observedAt ? `最近订单 ${date(observedAt)}` : "暂无有效订单观察"}</small>{(history || []).length > 1 && <span>历史：{history.map(rate).join(" / ")}</span>}</div>;
}
function CommissionHistory({ product }: { product: Item }) {
  const currencies = product.amountsByCurrency?.length ? product.amountsByCurrency : [{ ...product, currency: product.currency }];
  return <details className="cm-history"><summary>SKU、费率与金额明细 <ChevronDown size={13} /></summary><div className="cm-history-body">
    {!!product.skus?.length && <section className="cm-variants"><h4>商品 SKU 变体 · {product.skus.length} 个</h4><div>{product.skus.map((sku: string) => <span key={sku}>{sku}{sku === product.representativeSku && <small>代表</small>}</span>)}</div></section>}
    <div className="cm-history-rate-grid">{[["标准佣金", product.standardRateHistory || []], ["Shop Ads 佣金", product.shopAdsRateHistory || []]].map(([label, history]: any) => <section key={label}><h4>{label}观察记录</h4>{history.length ? <ul>{history.map((record: Item, index: number) => <li key={`${record.rate}-${index}`}><strong>{rate(record.rate)}</strong><span>{date(record.firstOrderDate)} 至 {date(record.lastOrderDate)}</span><small>{count(record.orderCount)} 个订单</small></li>)}</ul> : <p>暂无费率记录</p>}</section>)}</div>
    {currencies.map((row: Item, index: number) => <div className="cm-amount-block" key={row.currency || index}><h4>佣金金额 · {row.currency || "币种待确认"}</h4><div className="cm-table-wrap"><table className="cm-small-table"><thead><tr><th>类型</th><th>预计金额</th><th>实际金额</th></tr></thead><tbody><tr><td>标准佣金</td><td>{amount(row.estimatedStandard, row.currency)}</td><td>{amount(row.actualStandard, row.currency)}</td></tr><tr><td>Shop Ads 佣金</td><td>{amount(row.estimatedShopAds, row.currency)}</td><td>{amount(row.actualShopAds, row.currency)}</td></tr><tr><td>平台共资达人奖金</td><td>{amount(row.estimatedBonus, row.currency)}</td><td>{amount(row.actualBonus, row.currency)}</td></tr></tbody></table></div></div>)}
    <p className="cm-caption">金额沿用联盟订单表中的预计、实际字段，分别汇总；缺失值保留“未提供”。奖金单独展示，不与佣金率混用。</p>
  </div></details>;
}
function ImportRecordPreview({ kind, records }: { kind: ImportKind; records: Item[] }) {
  return <div className="cm-record-preview"><p>前 {Math.min(5, records.length)} 条识别结果 · 请核对账号、商品与费率</p><div className="cm-table-wrap"><table className="cm-table"><thead>{kind === "affiliateOrders" ? <tr><th>达人 / 订单 ID</th><th>PID</th><th>Standard</th><th>Shop Ads</th><th>订单状态 / 时间</th></tr> : <tr><th>达人 / 范围</th><th>SKU / PID</th><th>Target 佣金率</th><th>到期日期</th></tr>}</thead><tbody>{records.slice(0, 5).map((row, index) => kind === "affiliateOrders" ? <tr key={index}><td><strong>{row.creatorId ? `@${row.creatorId}` : "未提供"}</strong><small>{row.orderId}</small></td><td>{row.productId}</td><td>{rate(row.standardRate)}</td><td>{rate(row.shopAdsRate)}</td><td>{row.status}<small>{row.createdAt || "日期未提供"}</small></td></tr> : <tr key={index}><td>{row.creatorId ? `@${row.creatorId}` : row.groupName || "达人待确认"}</td><td>{row.sku || "SKU 未提供"}<small>{row.productId || "PID 待匹配"}</small></td><td>{rate(row.commissionRate)}</td><td>{row.expiresOn || row.expiryOriginal || "未填写"}{!row.expiryConfirmed && <small>{row.expiresOn || row.expiryOriginal ? "尚待确认完整日期" : "到期日期未填写，暂不提醒"}</small>}</td></tr>)}</tbody></table></div></div>;
}

export function TargetExpiryNotice({ data, onOpen }: { data: Item; onOpen: () => void }) {
  const stats = data?.targetStats || {}, attention = Number(stats.expired || 0) + Number(stats.dueToday || 0) + Number(stats.expiring || 0), review = Number(stats.needsConfirmation || 0);
  if (!stats.total) return null;
  return <section className={`cm-expiry-notice ${attention ? "has-attention" : ""}`}><span className="cm-expiry-icon"><BellRing size={22} /></span><div><strong>Target 佣金到期提醒</strong><p>{count(stats.expired)} 条已过期 · {count(stats.dueToday)} 条今天到期 · {count(stats.expiring)} 条即将到期{review ? ` · ${count(review)} 条日期待确认` : ""}</p><small>按各记录的到期日与提醒天数检查，仅管理员可见。</small></div><button className="button" type="button" onClick={onOpen}>查看安排</button></section>;
}

export function CreatorCommissionDetails({ data, creator, isAdmin }: { data: Item; creator: string; isAdmin: boolean }) {
  const products: Item[] = data?.byCreator?.[creatorId(creator)]?.products || [];
  const targets: Item[] = isAdmin ? (data?.targets || []).filter((row: Item) => row.creatorId && creatorId(row.creatorId) === creatorId(creator) && row.status !== "archived") : [];
  return <section className="cm-profile-section"><div className="cm-section-heading"><div><h3>各商品佣金</h3><p>最近有效联盟订单的佣金率观察；已排除 ineligible。</p></div><Tag>{products.length} 个 PID</Tag></div>
    {products.length ? <div className="cm-profile-products">{products.map(product => <article className="cm-profile-product" key={product.id}><header><div><strong>{product.representativeSku || product.skus?.[0] || product.productName || "商品"}</strong><small>PID {product.productId}</small></div><span>{count(product.orderCount)} 个有效订单</span></header><div className="cm-profile-rates"><div><span>Standard commission rate</span><RateCell latest={product.latestStandardRate} observedAt={product.latestStandardObservedAt} history={product.standardRates} latestRates={product.latestStandardRates} conflict={product.standardRateConflict} /></div><div><span>Shop Ads commission rate</span><RateCell latest={product.latestShopAdsRate} observedAt={product.latestShopAdsObservedAt} history={product.shopAdsRates} latestRates={product.latestShopAdsRates} conflict={product.shopAdsRateConflict} /></div></div><CommissionHistory product={product} /></article>)}</div> : <p className="cm-caption">该达人暂无可用联盟佣金记录。佣金文件用于观察费率，不会再次增加累计出单或改变分层。</p>}
    {!!targets.length && <div className="cm-profile-targets"><h4>专属 Target 佣金安排</h4>{targets.map(row => <div key={row.id}><span>{row.sku || row.productId || "商品待核对"}<strong>{rate(row.commissionRate)}</strong></span><span>{row.expiresOn || row.expiryOriginal || "到期日未填写"}<Tag tone={STATUS[row.expiryStatus]?.tone}>{STATUS[row.expiryStatus]?.label || "待核对"}</Tag></span></div>)}</div>}
    <p className="cm-caption">最近订单费率不等于平台后台当前设置；Target 约定另按人工维护的安排记录。</p>
  </section>;
}

export default function CreatorCommissions({ state, data, isAdmin, saving, onSave, ensureXlsx }: Props) {
  const [tab, setTab] = useState<"targets" | "affiliate">("targets"), [search, setSearch] = useState(""), [filter, setFilter] = useState("all"), [page, setPage] = useState(1);
  const [notice, setNotice] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);
  const [editing, setEditing] = useState<Item | null>(null), [targetDraft, setTargetDraft] = useState<Item>({}), [targetErrors, setTargetErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Item | null>(null), [deletingNow, setDeletingNow] = useState(false), [deleteError, setDeleteError] = useState("");
  const [reminder, setReminder] = useState(text(data.targetStats?.defaultReminderDays ?? 30));
  const [draft, setDraft] = useState<ImportDraft>(emptyImport()), [reading, setReading] = useState(false), [importError, setImportError] = useState(""), [preview, setPreview] = useState<Item | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), importPanel = useRef<HTMLElement>(null), request = useRef(0), desiredKind = useRef<ImportKind>("affiliateOrders"), busy = useRef(false);
  useEffect(() => { setPage(1); }, [tab, search, filter]);
  useEffect(() => { setReminder(text(data.targetStats?.defaultReminderDays ?? 30)); }, [data.targetStats?.defaultReminderDays]);
  useEffect(() => { setPreview(null); }, [state]);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => { if (draft.fileName) importPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [draft.fileName]);
  useEffect(() => { if (!editing) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving && !busy.current) setEditing(null); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [editing, saving]);
  const signature = JSON.stringify({ fileName: draft.fileName, sourceHash: draft.sourceHash, kind: draft.kind, sheet: draft.sheet, headerRow: draft.headerRow, mapping: draft.mapping });
  const schemas: Item[] = C.commissionFieldSchemas[draft.kind] || [];
  const headers = (draft.rows[draft.headerRow - 1] || []).map((value: any, i: number) => text(value).trim() || `未命名列 ${i + 1}`);
  const missing = schemas.filter(field => field.required && (draft.mapping[field.key] === "" || draft.mapping[field.key] == null));
  const filteredProducts = (data.creatorProducts || []).filter((row: Item) => !search || [row.creatorId, row.productId, row.productName, row.representativeSku, ...(row.skus || [])].some(value => text(value).toLowerCase().includes(search.trim().toLowerCase())));
  const filteredTargets = (data.targets || []).filter((row: Item) => {
    const statusMatch = filter === "all" ? row.status !== "archived" : filter === "attention" ? ["expired", "due_today", "expiring", "needs_confirmation"].includes(row.expiryStatus) || row.reviewIssues?.length > 0 : filter === "review" ? row.reviewIssues?.length > 0 || row.expiryStatus === "needs_confirmation" : row.expiryStatus === filter;
    return statusMatch && (!search || [row.creatorId, row.groupName, row.displayCreator, row.sku, row.productId, row.productName, row.notes].some(value => text(value).toLowerCase().includes(search.trim().toLowerCase())));
  });
  const pageSize = 15, products = filteredProducts.slice((page - 1) * pageSize, page * pageSize), targets = filteredTargets.slice((page - 1) * pageSize, page * pageSize), targetStats = data.targetStats || {}, summary = data.summary || {};
  const save = async (next: Item, reason: string) => { if (!isAdmin || saving || busy.current) return false; busy.current = true; try { return await onSave(next, reason); } finally { busy.current = false; } };
  const clearImport = (showMessage = true) => { if (saving || busy.current) return; request.current++; setDraft(emptyImport(desiredKind.current)); setReading(false); setImportError(""); setPreview(null); if (fileInput.current) fileInput.current.value = ""; if (showMessage) setNotice({ type: "info", message: "已清除本次文件和预览，已保存的佣金与 Target 安排保留。" }); };
  const chooseFile = (kind: ImportKind) => { if (!isAdmin || saving || busy.current) return; desiredKind.current = kind; fileInput.current?.click(); };
  const configureSheet = async (workbook: any, sheet: string, fileName: string, sourceHash: string, kind: ImportKind, token: number) => {
    const XLSX = await ensureXlsx(); if (token !== request.current) return;
    const rows = rowsFromWorkbook(workbook, sheet, XLSX); let best = { score: -1, headerRow: 1, mapping: {} };
    for (let i = 0; i < Math.min(rows.length, 18); i++) { const mapping = C.guessCommissionMappings(rows[i].map(text), kind), score = Object.values(mapping).filter(v => v !== "" && v != null).length; if (score > best.score) best = { score, headerRow: i + 1, mapping }; }
    setDraft({ kind, workbook, sheet, fileName, sourceHash, rows, headerRow: best.headerRow, mapping: best.mapping }); setPreview(null);
  };
  const receiveFile = async (file?: File) => {
    if (!isAdmin || !file || saving || busy.current) return;
    clearImport(false); const token = request.current, kind = desiredKind.current; setReading(true); setDraft({ ...emptyImport(kind), fileName: file.name }); setNotice(null);
    try {
      const XLSX = await ensureXlsx(); if (token !== request.current) return;
      const buffer = await file.arrayBuffer(); if (token !== request.current) return;
      const digest = await window.crypto.subtle.digest("SHA-256", buffer); if (token !== request.current) return;
      const sourceHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
      const workbook = XLSX.read(buffer, { type: "array", raw: true, nodim: true, cellDates: false, cellText: true });
      if (!workbook.SheetNames?.length) throw new Error("文件中没有可读取的工作表。");
      const sheet = workbook.SheetNames.find((name: string) => kind === "targetCommissions" ? /导入|target/i.test(name) && !/说明|示例|example/i.test(name) : /affiliate|订单|sheet1/i.test(name)) || workbook.SheetNames[0];
      await configureSheet(workbook, sheet, file.name, sourceHash, kind, token);
    } catch (error: any) { if (token === request.current) setImportError(error.message || "文件读取失败，请更换文件后重试。"); }
    finally { if (token === request.current) { setReading(false); if (fileInput.current) fileInput.current.value = ""; } }
  };
  const changeSheet = async (sheet: string) => { if (saving || busy.current) return; const token = ++request.current; setReading(true); setPreview(null); setImportError(""); try { await configureSheet(draft.workbook, sheet, draft.fileName, draft.sourceHash, draft.kind, token); } catch (error: any) { if (token === request.current) setImportError(error.message || "工作表读取失败。"); } finally { if (token === request.current) setReading(false); } };
  const changeKind = (kind: ImportKind) => { desiredKind.current = kind; setDraft({ ...draft, kind, mapping: C.guessCommissionMappings(headers, kind) }); setPreview(null); };
  const buildPreview = () => {
    if (!isAdmin || !draft.workbook || reading || saving || busy.current) return;
    setImportError("");
    try {
      if (missing.length) throw new Error(`请匹配必填列：${missing.map(row => row.label).join("、")}`);
      const context = { sourceName: draft.fileName, fileName: draft.fileName, sourceHash: draft.sourceHash, sheetName: draft.sheet, mappingSignature: JSON.stringify({ kind: draft.kind, headerRow: draft.headerRow, mapping: draft.mapping }), headerRow: draft.headerRow, strictRequired: draft.kind === "targetCommissions", at: new Date().toISOString() };
      const rateColumns = schemas.filter(field => /Rate$/.test(field.key)).map(field => draft.mapping[field.key]).filter(index => index !== "" && index != null).map(Number);
      const rows = draft.rows.slice(draft.headerRow).map(row => { const values = [...row]; for (const index of rateColumns) if (typeof values[index] === "number") values[index] = String(values[index]); return values; });
      const normalized = C.normalizeCommissionRows(draft.kind, rows, draft.mapping, context);
      if (!normalized.records.length && !normalized.rejected) throw new Error("没有识别到记录；空白模板不会保存，请先填写数据。");
      const merged = draft.kind === "affiliateOrders" ? C.mergeAffiliateCommissions(state, normalized.records, context) : C.mergeTargetCommissions(state, normalized.records, context);
      setPreview({ ...merged, records: normalized.records, sourceState: state, signature, warnings: [...(normalized.warnings || []), ...(merged.summary?.warnings || [])], totalRejected: Number(normalized.rejected || 0) + Number(merged.summary?.rejected || 0) });
    } catch (error: any) { setImportError(error.message || "预览失败，请检查列匹配。"); }
  };
  const confirmImport = async () => {
    if (!preview || !preview.records?.length || saving || busy.current || reading) return;
    if (preview.sourceState !== state || preview.signature !== signature) { setPreview(null); setImportError("数据或导入设置已变化，请重新预览。"); return; }
    if (preview.summary?.duplicateFile) { setPreview(null); setNotice({ type: "info", message: "这份文件、工作表和列匹配已经导入，本次已跳过重复保存。" }); return; }
    try { if (await save(preview.state, draft.kind === "affiliateOrders" ? "联盟订单佣金已更新（排除 ineligible，不重复计入销量）" : "Target 佣金安排已更新")) { setPreview(null); setNotice({ type: "success", message: "已保存。可以清除当前文件或继续导入其他工作表。" }); } } catch (error: any) { setImportError(error.message || "保存失败，请重试。"); }
  };
  const openTarget = (row?: Item) => {
    const item = (row?.id ? (state.targetCommissions || []).find((record: Item) => record.id === row.id) : row) || { scope: "creator", creatorId: "", groupName: "", sku: "", productId: "", commissionRate: "", expiresOn: "", expiryOriginal: "", expiryConfirmed: false, remindDays: "", notes: "" };
    setEditing(item); setTargetDraft({ ...item, commissionRate: item.commissionRate ?? "", remindDays: item.remindDays ?? "" }); setTargetErrors({}); setNotice(null);
  };
  const updateTargetDraft = (patch: Item) => { setTargetDraft(current => ({ ...current, ...patch })); setTargetErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !(key in patch)))); setNotice(current => current?.type === "error" ? null : current); };
  const saveTarget = async () => {
    if (!editing || saving || busy.current) return;
    try {
      setTargetErrors({});
      if (editing.id && !(state.targetCommissions || []).some((record: Item) => record.id === editing.id)) throw new Error("这条安排已删除或不存在，请取消编辑后刷新；未保存旧编辑内容。");
      const at = new Date().toISOString(), record = C.normalizeTargetCommission({ ...editing, ...targetDraft }, { at, strictRequired: true });
      const result = C.mergeTargetCommissions(state, [record], { sourceName: "手动维护", at, strictRequired: true });
      if (result.summary?.rejected) throw new Error((result.summary.warnings || []).join("；") || "本条安排未能保存，请检查后重试。");
      if (!result.summary?.added && !result.summary?.updated) { setEditing(null); setNotice({ type: "info", message: "该安排已存在，内容没有变化。" }); return; }
      if (await save(result.state, editing.id ? "Target 佣金安排已修改" : "Target 佣金安排已新增")) { setEditing(null); setNotice({ type: "success", message: "Target 佣金安排已保存。" }); }
    } catch (error: any) { setTargetErrors(error.fieldErrors || {}); setNotice({ type: "error", message: error.message || "请补齐黄色五项，再保存安排。" }); }
  };
  const archiveTarget = async (row: Item) => { if (saving || busy.current) return; try { const archived = row.status !== "archived", result = C.setTargetCommissionArchived(state, row.id, archived, { at: new Date().toISOString() }); if (await save(result.state || result, archived ? "Target 佣金安排已归档" : "Target 佣金安排已恢复")) setNotice({ type: "success", message: archived ? "已归档，停止本条到期提醒；可在已归档中恢复。" : "已恢复本条安排。" }); } catch (error: any) { setNotice({ type: "error", message: error.message }); } };
  const openDeleteTarget = (row: Item) => {
    if (!isAdmin || saving || busy.current || deletingNow) return;
    const current = (state.targetCommissions || []).filter((record: Item) => record.id === row.id);
    if (current.length !== 1) { setNotice({ type: "error", message: "未找到唯一的 Target 安排，请刷新并核对后重试。" }); return; }
    setDeleting(structuredClone(current[0])); setDeleteError(""); setNotice(null);
  };
  const closeDeleteTarget = () => { if (saving || busy.current || deletingNow) return; setDeleting(null); setDeleteError(""); };
  const confirmDeleteTarget = async () => {
    if (!deleting || !isAdmin || saving || busy.current || deletingNow) return;
    setDeletingNow(true); setDeleteError("");
    try {
      const result = C.deleteTargetCommission(state, deleting.id, { expectedRecord: deleting });
      if (await save(result.state, "Target 佣金安排已删除")) { if (editing?.id === deleting.id) { setEditing(null); setTargetDraft({}); setTargetErrors({}); } setDeleting(null); setNotice({ type: "success", message: "已删除这条 Target 佣金安排。尚未进行下一次更新时，可在导入中心撤回上次更新。" }); }
      else setDeleteError("删除未保存成功。请核对页面的保存提示，保留当前数据后重试。");
    } catch (error: any) { setDeleteError(error.message || "删除未完成，请重试。"); }
    finally { setDeletingNow(false); }
  };
  const saveReminder = async () => { try { const value = Number(reminder); if (reminder === "" || !Number.isInteger(value) || value < 0 || value > 365) throw new Error("提醒天数请输入 0–365 的整数。"); const result = C.updateCommissionSettings(state, { targetCommissionReminderDays: value }, { at: new Date().toISOString() }); if (await save(result.state || result, "Target 默认提醒天数已更新")) setNotice({ type: "success", message: "默认提醒天数已更新，单条填写的提醒天数仍优先使用。" }); } catch (error: any) { setNotice({ type: "error", message: error.message }); } };
  const exportProducts = () => downloadRows("达人各商品佣金.csv", filteredProducts.map((row: Item) => ({ ...row, latestStandardRate: latestRateLabel(row.latestStandardRate, row.latestStandardRates, row.standardRateConflict), latestShopAdsRate: latestRateLabel(row.latestShopAdsRate, row.latestShopAdsRates, row.shopAdsRateConflict), standardRates: row.standardRates?.map(rate), shopAdsRates: row.shopAdsRates?.map(rate) })), [["creatorId", "达人ID"], ["productId", "产品PID"], ["representativeSku", "代表SKU"], ["skus", "SKU变体（完整）"], ["productName", "产品名称"], ["latestStandardRate", "最近订单标准佣金率"], ["latestStandardObservedAt", "标准佣金观察日期"], ["standardRates", "标准佣金历史费率"], ["latestShopAdsRate", "最近订单Shop Ads佣金率"], ["latestShopAdsObservedAt", "Shop Ads观察日期"], ["shopAdsRates", "Shop Ads历史费率"], ["orderCount", "有效订单数"], ["firstOrderDate", "首笔订单日期"], ["lastOrderDate", "最近订单日期"]]);
  const exportTargets = () => {
    if (!isAdmin) return;
    const selectedIds = new Set(filteredTargets.map((row: Item) => row.id));
    const rows = (state.targetCommissions || []).filter((row: Item) => selectedIds.has(row.id)).map((row: Item) => ({ ...row, scope: row.scope === "creator" ? "达人" : row.scope === "group" ? "群组" : "未指定", commissionRate: rate(row.commissionRate), expiryConfirmed: row.expiryConfirmed ? "是" : "否", status: row.status === "archived" ? "已归档" : "启用", creatorReviewRequired: row.creatorReviewRequired ? "是" : "否", productReviewRequired: row.productReviewRequired ? "是" : "否", candidateProductIds: (row.candidateProductIds || []).join("|") }));
    downloadRows("Target佣金安排_保留记录ID可更新.csv", rows, [["id", "记录ID"], ["scope", "对象类型"], ["creatorId", "达人ID"], ["groupName", "达人群组"], ["sku", "商品SKU"], ["productId", "产品PID"], ["commissionRate", "Target佣金率"], ["expiresOn", "到期日期"], ["expiryOriginal", "原始到期说明"], ["expiryConfirmed", "到期日期已确认"], ["remindDays", "提前提醒天数"], ["notes", "备注"], ["sourceText", "原始记录"], ["status", "记录状态"], ["creatorReviewRequired", "达人ID待核对"], ["productReviewRequired", "PID待核对"], ["candidateProductIds", "候选PID"]]);
  };
  if (!isAdmin) return null;
  return <div className="commission-workspace">
    <input ref={fileInput} className="visually-hidden" type="file" accept=".xlsx,.xls,.csv,.tsv" aria-label="选择联盟佣金或Target模板" onChange={event => void receiveFile(event.target.files?.[0])} />
    <div className="cm-intro"><div><span>CREATOR COMMISSIONS</span><h2>佣金记录与到期安排</h2><p>订单佣金按达人与 PID 查看，Target 安排按到期日跟进。</p></div><Tag tone="blue">Target 提醒仅管理员可见</Tag></div>
    <div className="cm-tabs" role="tablist" aria-label="佣金管理类型"><button type="button" role="tab" aria-selected={tab === "targets"} className={tab === "targets" ? "active" : ""} onClick={() => { setTab("targets"); setSearch(""); }}><BellRing size={17} />Target 到期管理</button><button type="button" role="tab" aria-selected={tab === "affiliate"} className={tab === "affiliate" ? "active" : ""} onClick={() => { setTab("affiliate"); setSearch(""); }}><FileSpreadsheet size={17} />联盟订单佣金</button></div>
    {notice && <div className={`cm-notice ${notice.type}`} role={notice.type === "error" ? "alert" : "status"}><AlertCircle size={17} /><span>{notice.message}</span><button type="button" className="icon-button" aria-label="关闭佣金提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    {tab === "targets" ? <>
      <div className="cm-stats">{[["已过期", targetStats.expired, "expired", "red"], ["今天到期", targetStats.dueToday, "due_today", "red"], ["即将到期", targetStats.expiring, "expiring", "amber"], ["需要核对", targetStats.reviewCount, "review", "blue"]].map(([label, value, status, tone]) => <button type="button" key={text(label)} onClick={() => setFilter(text(status))} className={`cm-stat cm-stat-${tone}`}><span>{text(label)}</span><strong>{count(value)}</strong><small>查看记录</small></button>)}</div>
      <section className="cm-card"><div className="cm-section-heading"><div><h3>Target 佣金安排</h3><p>黄色五项为必填，到期日期选填。每个 PID 选择一个代表 SKU；历史缺信息记录仍保留待核对。</p></div><div className="cm-actions"><button type="button" className="button" disabled={!filteredTargets.length} onClick={exportTargets}><Download size={15} />导出当前记录</button><a className="button" href="/templates/heihei_target_commission_template.xlsx" download><Download size={15} />下载导入模板</a><button type="button" className="button" disabled={saving || reading} onClick={() => chooseFile("targetCommissions")}><Upload size={15} />导入模板</button><button type="button" className="button primary" disabled={saving} onClick={() => openTarget()}><Plus size={15} />手动新增</button></div></div>
        <div className="cm-reminder-settings"><CalendarDays size={18} /><span>默认提前</span><input aria-label="默认到期提醒天数" type="number" min="0" max="365" value={reminder} onChange={event => setReminder(event.target.value)} /><span>天提醒</span><button type="button" className="button small" disabled={saving || reminder === text(targetStats.defaultReminderDays ?? 30)} onClick={() => void saveReminder()}>保存设置</button><small>单条可另设提醒天数；到期日期留空时暂不提醒，已填日期须确认完整年份。</small></div>
        <div className="cm-filters"><label className="cm-search"><Search size={16} /><input aria-label="搜索Target达人或商品" placeholder="搜索达人、群组、SKU、PID或备注" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="筛选Target到期状态" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部未归档</option><option value="attention">需要处理</option><option value="expired">已过期</option><option value="due_today">今天到期</option><option value="expiring">即将到期</option><option value="active">有效</option><option value="needs_confirmation">日期待确认</option><option value="review">达人 / 商品 / 日期待核对</option><option value="archived">已归档</option></select><span>{count(filteredTargets.length)} 条安排</span></div>
        <div className="cm-table-wrap"><table className="cm-table cm-target-table"><thead><tr><th>达人 / 适用范围</th><th>商品 SKU / PID</th><th>Target 佣金率</th><th>到期日期</th><th>状态与核对</th><th>操作</th></tr></thead><tbody>{targets.map((row: Item) => <tr key={row.id}><td><strong>{row.displayCreator || (row.creatorId ? `@${row.creatorId}` : row.groupName || "达人未指定")}</strong><small>{row.creatorId ? `${row.creatorMatch === "matched" ? "已匹配达人 ID" : "达人 ID 尚未匹配"} · ${row.scope === "group" ? "群组" : row.scope === "unspecified" ? "未指定类型" : "达人"}` : row.scope === "group" ? "历史达人群组 · 未指定个人" : "待补充适用达人"}</small>{row.notes && <small className="cm-wrap">{row.notes}</small>}</td><td><strong>{row.sku || row.productName || "SKU 待补充"}</strong><small>PID {row.productId || "待匹配"}</small>{["ambiguous", "unmatched"].includes(row.productMatch) && <Tag tone="amber">商品待核对</Tag>}</td><td className="cm-rate">{rate(row.commissionRate)}</td><td><strong>{row.expiresOn || (row.expiryOriginal ? "待确认" : "未填写")}</strong>{row.expiryOriginal && <small>原记录：{row.expiryOriginal}</small>}<small>{row.expiresOn && row.expiryConfirmed ? `提前 ${row.reminderDays} 天提醒` : "暂不提醒；填写并确认到期日后提醒"}</small></td><td><Tag tone={STATUS[row.expiryStatus]?.tone}>{STATUS[row.expiryStatus]?.label || "待核对"}</Tag>{row.daysRemaining != null && <small>{row.daysRemaining < 0 ? `已过期 ${Math.abs(row.daysRemaining)} 天` : row.daysRemaining === 0 ? "到期当天" : `剩余 ${row.daysRemaining} 天`}</small>}{row.reviewIssues?.length > 0 && <details className="cm-review"><summary>{row.reviewIssues.length} 项待核对</summary><ul>{row.reviewIssues.map((issue: any, index: number) => <li key={index}>{text(issue.message || issue)}</li>)}</ul>{row.sourceText && <p>原文：{row.sourceText}</p>}</details>}</td><td><div className="cm-row-actions"><button type="button" className="text-button" disabled={saving} onClick={() => openTarget(row)}><Edit3 size={14} />编辑</button><button type="button" className="text-button" disabled={saving} onClick={() => void archiveTarget(row)}><Archive size={14} />{row.status === "archived" ? "恢复" : "归档"}</button><button type="button" className="text-button cm-delete-action" disabled={saving || deletingNow} onClick={() => openDeleteTarget(row)}><Trash2 size={14} />删除</button></div></td></tr>)}</tbody></table>{!targets.length && <Empty>当前没有符合条件的 Target 安排。可以调整筛选，或新增、导入安排。</Empty>}</div><Pagination page={page} setPage={setPage} total={filteredTargets.length} size={pageSize} />
      </section>
    </> : <>
      <div className="cm-stats cm-affiliate-stats"><div className="cm-stat"><span>有效订单明细</span><strong>{count(summary.eligibleRows)}</strong><small>佣金观察来源</small></div><div className="cm-stat"><span>排除 ineligible</span><strong>{count(summary.ineligibleRows)}</strong><small>不参与佣金汇总</small></div><div className="cm-stat"><span>达人与 PID 组合</span><strong>{count(summary.creatorProductCount)}</strong><small>{count(summary.creatorCount)} 位达人</small></div><div className="cm-stat"><span>已导入订单日期</span><strong className="cm-date-value">{date(summary.firstOrderDate)}</strong><small>至 {date(summary.lastOrderDate)}</small></div></div>
      <section className="cm-card"><div className="cm-section-heading"><div><h3>达人各商品佣金</h3><p>以最近有效订单显示两类费率，并保留历史变化。该表只更新佣金资料，累计出单仍沿用视频报表。</p></div><div className="cm-actions"><button type="button" className="button" disabled={!filteredProducts.length} onClick={exportProducts}><Download size={15} />导出当前结果</button><button type="button" className="button primary" disabled={saving || reading} onClick={() => chooseFile("affiliateOrders")}><Upload size={15} />导入联盟订单</button></div></div><div className="cm-observation-note"><AlertCircle size={17} /><p>这里是<strong>订单中观察到的佣金率</strong>，不代表平台后台当前设置。Standard commission rate 与 Shop Ads commission rate 分别记录；0% 与未提供分开显示。</p></div><div className="cm-filters"><label className="cm-search"><Search size={16} /><input aria-label="搜索联盟佣金达人或商品" placeholder="搜索达人ID、PID、SKU或产品名称" value={search} onChange={event => setSearch(event.target.value)} /></label><span>{count(filteredProducts.length)} 个达人与 PID 组合</span></div><div className="cm-table-wrap"><table className="cm-table cm-affiliate-table"><thead><tr><th>达人 ID</th><th>商品代表 SKU / PID</th><th>Standard commission rate<small>最近订单标准佣金率</small></th><th>Shop Ads commission rate<small>最近订单广告佣金率</small></th><th>订单与历史</th></tr></thead><tbody>{products.map((row: Item) => <tr key={row.id}><td><strong>@{row.creatorId}</strong></td><td><strong>{row.representativeSku || row.skus?.[0] || row.productName || "商品"}</strong><small>PID {row.productId}</small><small className="cm-wrap">{row.productName}</small></td><td><RateCell latest={row.latestStandardRate} observedAt={row.latestStandardObservedAt} history={row.standardRates} latestRates={row.latestStandardRates} conflict={row.standardRateConflict} /></td><td><RateCell latest={row.latestShopAdsRate} observedAt={row.latestShopAdsObservedAt} history={row.shopAdsRates} latestRates={row.latestShopAdsRates} conflict={row.shopAdsRateConflict} /></td><td><span>{count(row.orderCount)} 个有效订单</span><small>{date(row.firstOrderDate)} 至 {date(row.lastOrderDate)}</small><CommissionHistory product={row} /></td></tr>)}</tbody></table>{!products.length && <Empty>暂无匹配的联盟佣金记录。导入联盟订单后，按达人与 PID 查看费率。</Empty>}</div><Pagination page={page} setPage={setPage} total={filteredProducts.length} size={pageSize} /></section>
    </>}
    {(draft.fileName || reading || importError) && <section ref={importPanel} className="cm-card cm-import-card" aria-label="佣金导入草稿"><div className="cm-section-heading"><div><h3>{reading ? "正在读取文件…" : draft.fileName}</h3><p>选择文件和预览不会保存；核对后确认合并。</p></div><button type="button" className="button" disabled={saving} onClick={() => clearImport()}><X size={15} />清除本次文件</button></div>{reading && <div className="cm-loading"><Loader2 size={23} className="spin" />正在识别工作表与列…</div>}{importError && <div className="cm-notice error" role="alert"><AlertCircle size={17} /><span>{importError}</span></div>}{draft.workbook && !reading && <>{draft.kind === "targetCommissions" && <p className="cm-required-note">黄色五项必填：对象类型、达人ID、商品SKU、产品PID、Target佣金率。到期日期选填，留空可导入；填写时须包含完整年月日。每个 PID 填一个代表 SKU，缺少必填项的行会显示具体原因并排除。</p>}<div className="cm-import-options"><Field title="文件用途"><select value={draft.kind} onChange={event => changeKind(event.target.value as ImportKind)} disabled={saving}><option value="affiliateOrders">联盟订单佣金</option><option value="targetCommissions">Target 佣金安排</option></select></Field><Field title="工作表"><select value={draft.sheet} onChange={event => void changeSheet(event.target.value)} disabled={saving}>{draft.workbook.SheetNames.map((name: string) => <option key={name}>{name}</option>)}</select></Field><Field title="表头所在行"><input type="number" min="1" max={draft.rows.length || 1} value={draft.headerRow} disabled={saving} onChange={event => { const headerRow = Math.max(1, Math.min(draft.rows.length || 1, Number(event.target.value) || 1)); setDraft({ ...draft, headerRow, mapping: C.guessCommissionMappings((draft.rows[headerRow - 1] || []).map(text), draft.kind) }); setPreview(null); }} /></Field></div><details className="cm-mappings" open={missing.length > 0}><summary>检查列匹配 · {schemas.filter(field => draft.mapping[field.key] !== "" && draft.mapping[field.key] != null).length} 列已识别{missing.length ? `，${missing.length} 个必填列待匹配` : ""}</summary><div className="cm-mapping-grid">{schemas.map(field => <Field key={field.key} title={field.label} required={!!field.required}><select value={draft.mapping[field.key] ?? ""} disabled={saving} onChange={event => { setDraft({ ...draft, mapping: { ...draft.mapping, [field.key]: event.target.value } }); setPreview(null); }}><option value="">不导入此列</option>{headers.map((label: string, index: number) => <option key={index} value={index}>{index + 1}. {label}</option>)}</select></Field>)}</div></details><div className="cm-import-bottom"><span>{count(Math.max(0, draft.rows.length - draft.headerRow))} 行待识别{draft.kind === "affiliateOrders" ? " · ineligible 会排除，不再次增加视频出单" : " · 保留记录 ID 可更新同一条安排"}</span><button type="button" className="button primary" disabled={saving || missing.length > 0} onClick={buildPreview}>预览合并结果</button></div></>}{preview && <div className="cm-import-preview"><h4>合并预览</h4><div className="cm-preview-counts"><span>识别 <strong>{count(preview.records.length)}</strong> 行</span><span>新增 <strong>{count(preview.summary?.added)}</strong></span><span>更新 <strong>{count(preview.summary?.updated)}</strong></span><span>未变化 <strong>{count(preview.summary?.unchanged)}</strong></span><span>排除 ineligible <strong>{count(preview.summary?.excludedIneligible)}</strong></span><span>未通过 <strong>{count(preview.totalRejected)}</strong></span></div>{preview.warnings?.length > 0 && <details className="cm-validation-issues" open><summary>{preview.warnings.length} 条提示 · 请核对行号和具体字段</summary><ul>{preview.warnings.map((warning: any, index: number) => <li key={index}>{text(warning.message || warning)}</li>)}</ul></details>}{!!preview.records.length && <ImportRecordPreview kind={draft.kind} records={preview.records} />}<div className="cm-import-bottom"><p>{draft.kind === "affiliateOrders" ? "只保存佣金资料，不改变原有销量、收样或达人分层名单。" : "已有记录按记录 ID 更新；未通过的行不会保存，请按提示修正五个必填项或已填写的日期后重新导入。"}</p><button type="button" className="button primary" disabled={saving || !preview.records?.length || preview.signature !== signature || preview.sourceState !== state} onClick={() => void confirmImport()}>{saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}{preview.totalRejected ? "仅合并已通过记录" : "确认合并"}</button></div></div>}</section>}
    {deleting && <TargetDeleteDialog record={deleting} pending={saving || deletingNow} error={deleteError} onClose={closeDeleteTarget} onConfirm={() => void confirmDeleteTarget()} />}
    {editing && <div className="cm-modal-overlay" role="presentation">
      <button className="cm-modal-scrim" type="button" aria-label="关闭Target编辑" onClick={() => !saving && setEditing(null)} />
      <section className="cm-modal" role="dialog" aria-modal="true" aria-label={editing.id ? "编辑Target佣金" : "新增Target佣金"}>
        <header><div><h3>{editing.id ? "编辑 Target 佣金" : "新增 Target 佣金"}</h3><p>黄色五项为必填，到期日期选填。每个 PID 选择一个代表 SKU。</p></div><button type="button" className="icon-button" aria-label="关闭Target编辑" disabled={saving} onClick={() => setEditing(null)}><X size={20} /></button></header>
        {notice?.type === "error" && <div className="cm-notice error" role="alert"><AlertCircle size={17} /><span>{notice.message}</span></div>}
        <fieldset className="cm-target-form" disabled={saving}>
          {editing.id && <p className="cm-required-note cm-form-wide">历史记录可继续查看和归档；编辑保存前，请补齐五个必填项，到期日期可留空。商品 PID 沿用原始填写值，待核对的内容需要确认。</p>}
          <Field title="对象类型" required error={targetErrors.scope}><select value={targetDraft.scope || ""} aria-required="true" aria-invalid={!!targetErrors.scope} onChange={event => updateTargetDraft({ scope: event.target.value })}><option value="">请选择对象类型</option><option value="creator">达人</option><option value="group">群组</option><option value="unspecified">未指定</option></select></Field>
          <Field title="达人ID" required error={targetErrors.creatorId} help="填写完整账号；对象类型为群组或未指定时也需填写。"><input required aria-invalid={!!targetErrors.creatorId} value={targetDraft.creatorId || ""} onChange={event => updateTargetDraft({ creatorId: event.target.value, creatorReviewRequired: creatorId(event.target.value) === creatorId(editing.creatorId) ? editing.creatorReviewRequired : false })} placeholder="例如 creator_example" /></Field>
          <Field title="商品SKU" required error={targetErrors.sku} help="每个 PID 只填一个代表 SKU。"><input required aria-invalid={!!targetErrors.sku} value={targetDraft.sku || ""} onChange={event => updateTargetDraft({ sku: event.target.value, productId: "", productReviewRequired: false, candidateProductIds: [] })} placeholder="例如 SKU-DEMO-01" /></Field>
          <Field title="产品PID" required error={targetErrors.productId} help={targetDraft.candidateProductIds?.length ? `请核对后填写。原候选 PID：${targetDraft.candidateProductIds.join(" / ")}` : "填写该 SKU 对应的完整产品 PID。"}><input required aria-invalid={!!targetErrors.productId} value={targetDraft.productId || ""} onChange={event => updateTargetDraft({ productId: event.target.value })} placeholder="完整产品 PID" /></Field>
          <Field title="Target佣金率（%）" required error={targetErrors.commissionRate} help="填写 15 表示 15%；0% 是有效费率。"><input required type="number" min="0" max="100" step="0.01" aria-invalid={!!targetErrors.commissionRate} value={targetDraft.commissionRate} onChange={event => updateTargetDraft({ commissionRate: event.target.value })} placeholder="例如 15" /></Field>
          <Field title="到期日期（选填）" error={targetErrors.expiresOn} help="可留空保存，填写并确认完整年月日后才参与到期提醒。"><input type="date" aria-invalid={!!targetErrors.expiresOn} value={targetDraft.expiresOn || ""} onChange={event => updateTargetDraft({ expiresOn: event.target.value, expiryConfirmed: !!event.target.value })} /></Field>
          <details className="cm-form-optional cm-form-wide"><summary>其它选填信息 <ChevronDown size={14} /></summary><div className="cm-optional-grid">
            {targetDraft.scope === "group" && <Field title="达人群组" help="可记录群组名称；不会把无账号的历史群组分配给个人。"><input value={targetDraft.groupName || ""} onChange={event => updateTargetDraft({ groupName: event.target.value })} placeholder="例如 老达人" /></Field>}
            <Field title="提前提醒天数" help={`留空使用默认 ${targetStats.defaultReminderDays ?? 30} 天。`}><input type="number" min="0" max="365" step="1" value={targetDraft.remindDays} onChange={event => updateTargetDraft({ remindDays: event.target.value })} /></Field>
            <Field title="原始到期说明"><input value={targetDraft.expiryOriginal || ""} onChange={event => updateTargetDraft({ expiryOriginal: event.target.value })} placeholder="保留历史原始日期说明" /></Field>
            <label className="cm-checkbox"><input type="checkbox" disabled={!targetDraft.expiresOn} checked={!!targetDraft.expiresOn && !!targetDraft.expiryConfirmed} onChange={event => updateTargetDraft({ expiryConfirmed: event.target.checked })} />到期日期已确认；取消勾选可暂列待确认</label>
            <div className="cm-form-wide"><Field title="备注"><textarea rows={3} value={targetDraft.notes || ""} onChange={event => updateTargetDraft({ notes: event.target.value })} placeholder="合作约定、续期安排、待核对的信息" /></Field>{editing.sourceText && <p className="cm-caption">原始记录：{editing.sourceText}</p>}</div>
          </div></details>
        </fieldset>
        <footer><button type="button" className="button" disabled={saving} onClick={() => setEditing(null)}>取消</button><button type="button" className="button primary" disabled={saving} onClick={() => void saveTarget()}>{saving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}保存安排</button></footer>
      </section>
    </div>}
  </div>;
}

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, ArrowUpRight, BarChart3,
  Check, CheckCircle2, ChevronRight, Clock3, Cloud, Download,
  BookOpen, ExternalLink, FileSpreadsheet, Files, Filter, LayoutDashboard, Link2,
  Loader2, Menu, MessageSquare, Package, Plus, RefreshCw, Search, Settings2,
  ShieldCheck, SlidersHorizontal, Sparkles, Star, Table2, Trash2, Undo2,
  Upload, Users, X, LogOut, LockKeyhole,
} from "lucide-react";
import { loadWorkbench, saveWorkbench } from "../lib/workbench-client";
import * as Engine from "../lib/creator-engine.mjs";
import { createImportPreset, restoreImportPreset } from "../lib/import-presets.mjs";
import { previewPendingVideoImport, confirmPendingVideoImport, previewHistoricalBaseline, confirmHistoricalBaseline } from "../lib/video-periods.mjs";
import { stageVideoImport, markPendingVideoAsPublication } from "../lib/video-staging.mjs";
import { confirmVideoReportViewsPeriod, deriveVideoViews } from "../lib/video-views.mjs";
import { getWillingnessConfig, validateWillingnessConfig, updateCreatorWillingness } from "../lib/creator-willingness.mjs";
import type { WorkbenchUser } from "./workbench-auth";
import WorkbenchGuide from "./workbench-guide";
import WorkbenchAdmin from "./workbench-admin";
import CreatorCommissions, { CreatorCommissionDetails, TargetExpiryNotice, useCommissionData } from "./creator-commissions";
import Pagination from "./workbench-pagination";
import "./video-views.css";
import "./import-file-actions.css";
import "./promotion-selling-creators.css";
import "./contribution-status.css";

const E: any = Engine;
type RecordItem = Record<string, any>;
type ViewName = "overview" | "samples" | "promotion" | "creators" | "commissions" | "imports" | "rules" | "admin";
type PromotionSortKey = "sampleOrders" | "sampleQuantity" | "creatorCount" | "videoCount" | "sellingVideoCount" | "itemsSold";
const promotionSortColumns: { key: PromotionSortKey; label: string }[] = [
  { key: "sampleOrders", label: "发样订单" },
  { key: "sampleQuantity", label: "发样件数" },
  { key: "creatorCount", label: "达人" },
  { key: "videoCount", label: "发布视频数" },
  { key: "sellingVideoCount", label: "出单视频数" },
  { key: "itemsSold", label: "视频出单件数" },
];
type Notice = { type: "success" | "error" | "info"; message: string } | null;
type PendingDraft = { mode: "period" | "historicalBaseline"; rangeStart: string; rangeEnd: string; cutoffDate: string; replaceOverlapping: boolean };
type ViewsPeriodDraft = { month: string; viewsPeriodStart: string; viewsPeriodEnd: string };
type ViewsKind = "period" | "unconfirmed" | "lifetime_snapshot";
const newPendingDraft = (): PendingDraft => ({ mode: "period", rangeStart: "", rangeEnd: "", cutoffDate: "", replaceOverlapping: false });
const navItems: { id: ViewName; title: string; subtitle: string; icon: any }[] = [
  { id: "overview", title: "工作台总览", subtitle: "每一次合作，都有迹可循", icon: LayoutDashboard },
  { id: "samples", title: "收样记录", subtitle: "从寄出样品，到发布视频", icon: Package },
  { id: "promotion", title: "月度推广", subtitle: "按产品 PID 复盘推广表现", icon: BarChart3 },
  { id: "creators", title: "达人分层", subtitle: "发现值得长期合作的达人", icon: Users },
  { id: "commissions", title: "佣金与到期", subtitle: "查看各商品佣金，跟进专属合作到期", icon: Clock3 },
  { id: "imports", title: "导入中心", subtitle: "把分散的表格，更新为同一份记录", icon: Files },
  { id: "rules", title: "规则设置", subtitle: "让统计方式符合你的工作习惯", icon: SlidersHorizontal },
  { id: "admin", title: "管理员中心", subtitle: "管理登录账号与工作台权限", icon: ShieldCheck },
];
const typeNames: Record<string, string> = {
  orders: "All orders / 发样订单", samples: "收样记录表", products: "产品 PID / SKU 对照表",
  videos: "Video Analysis 视频数据", creators: "达人分层管理表", preferences: "西班牙达人带货倾向", promotions: "历史月度推广表",
};
const num = (v: any) => Number(v) || 0;
const formatNum = (v: any) => new Intl.NumberFormat("zh-CN").format(num(v));
const compact = (v: any) => num(v) >= 10000 ? `${(num(v) / 10000).toFixed(1)}万` : formatNum(v);
const snapshotViews = (v: any) => v == null || v === "" ? "未提供" : compact(v);
const periodViews = (v: any, available = true) => !available || v == null || v === "" ? "待确认" : compact(v);
const gmvAmount = (value: any, available = true) => !available || value == null || value === "" || !Number.isFinite(Number(value)) ? "—" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
const gmvCoverageLabel = (value: any) => value === "complete" ? "完整" : value === "partial" ? "部分记录缺GMV" : "未提供";
const promotionSourceLabel = (mode: any): string => ({ "publication-period": "发布月报", "publication-unconfirmed": "期间待确认", "publication-cross-month": "跨月参考", "historical-promotion": "历史填报", "historical-publication": "历史视频参考", "confirmed-period": "当期报表", "mixed-historical": "含历史参考", "unavailable": "暂无数据" } as Record<string, string>)[String(mode)] || (/historical|reference/.test(String(mode)) ? "历史参考" : "");
const isPromotionReference = (mode: any) => /historical|reference|unconfirmed|cross-month/.test(String(mode));
const salesShare = (v: any) => `${(num(v) * 100).toFixed(1)}%`;
const nextPeriodDate = (value: string) => { if (!validDate(value)) return ""; const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
async function fileFingerprint(buffer: ArrayBuffer) { const hash = await window.crypto.subtle.digest("SHA-256", buffer); return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join(""); }
const text = (v: any): string => v == null ? "" : Array.isArray(v) ? v.map(text).filter(Boolean).join("、") : typeof v === "object" ? (v.label || v.name || v.title || JSON.stringify(v)) : String(v);
const cid = (v: any) => E.normalizeCreator ? E.normalizeCreator(v) : text(v).trim().replace(/^@/, "").toLowerCase();
const unique = (v: any[]) => [...new Set(v.filter(Boolean))];
const willingnessTone = (value: string) => value === "高" ? "green" : value === "低" ? "amber" : value === "随性" ? "purple" : value === "未沟通" ? "blue" : "neutral";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const dateText = (v: any) => text(v).slice(0, 10) || "—";
const monthText = (v: string) => v && /^\d{4}-\d{2}$/.test(v) ? `${v.slice(0, 4)} 年 ${Number(v.slice(5))} 月` : "全部月份";
const monthOf = (r: RecordItem) => text(r.reportMonth || r.month || r.period || r.periodStart || r.rangeStart || r.date || r.publishDate).slice(0, 7);
const blank = (v: any) => v == null || text(v).trim() === "";
const profileURL = (id: string) => `https://www.tiktok.com/@${encodeURIComponent(cid(id))}`;
function safeUrl(v: any) { try { const u = new URL(text(v)); return ["https:", "http:"].includes(u.protocol) ? u.href : ""; } catch { return ""; } }
const creatorPlaybackNumber = (value: any): number | null => value == null || text(value).trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);
const creatorPlaybackSourceLabel = (creator: RecordItem) => {
  const baseline = creatorPlaybackNumber(creator.cumulativeVideoViewsBaseline), periods = creatorPlaybackNumber(creator.cumulativeVideoViewsPeriodTotal);
  return baseline !== null ? periods !== null ? "历史底表＋后续期间" : "历史底表" : periods !== null ? creator.cumulativeVideoViewsBaselineCutoff ? "后续已确认期间" : "已确认期间" : "播放数据待确认";
};
const creatorPlaybackIssueLabel = (creator: RecordItem) => ({ needs_review: "播放数据待核对", partial: "部分播放数据缺失", unconfirmed: "播放期间待确认" } as Record<string, string>)[text(creator.cumulativeVideoViewsCoverageStatus)] || "";
const contributionShare = (product: RecordItem) => num(product.itemsSold) > 0 && Number.isFinite(Number(product.salesShare)) ? Math.max(0, Number(product.salesShare)) : 0;
const hasPositiveContributionVideo = (product: RecordItem | undefined) => !!product && num(product.itemsSold) > 0 && num(product.topVideoItemsSold) > 0;
function contributionExportRows(creators: RecordItem[]) {
  return creators.flatMap(creator => (creator.productContributions || []).map((product: RecordItem) => {
    const hasVideo = hasPositiveContributionVideo(product);
    return { ...product, creatorId: creator.creatorId, salesShareText: salesShare(contributionShare(product)), sampleStatus: product.sampleLinked ? "已匹配收样产品" : "未匹配收样产品", topVideoId: hasVideo ? product.topVideoId || "" : "", topVideoUrl: hasVideo ? product.topVideoUrl || "" : "", topVideoItemsSold: hasVideo ? product.topVideoItemsSold : "", salesStatus: num(product.itemsSold) > 0 ? "已确认出单" : "暂无已确认出单" };
  }));
}
function linksOf(row: RecordItem) {
  const values = [row.videoLinks, row.links, row.matchedLinks, row.videoUrl, row.videoLink].flatMap(v => Array.isArray(v) ? v : text(v).split(/[\n\s,，]+/));
  if (Array.isArray(row.matchedVideos)) values.push(...row.matchedVideos.map((v: any) => v.url || v.videoUrl || v.videoLink || ""));
  return unique(values.map(v => safeUrl(typeof v === "object" ? v.url || v.videoUrl : v)).filter(Boolean));
}
function sampleStatus(row: RecordItem) {
  if (row.effective === false) return "已取消";
  if (row.creatorIdentityConflict) return "待核对";
  if (linksOf(row).length) return "已发视频";
  if (num(row.candidateVideoCount) > 0) return "候选待确认";
  if (!cid(row.creatorId)) return "待核对";
  if (/ambiguous|review|核对|冲突|多|待补|待匹配 PID/.test(text(row.matchStatus))) return "待核对";
  return "待追踪";
}
function initials(name: any) { const a = text(name).replace(/^@/, "").trim(); return (a[0] || "?").toUpperCase(); }
function avatarClass(name: any) { return `avatar avatar-${[...text(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5}`; }
function safeCSV(value: any) {
  let s = text(value).replace(/\r\n/g, "\n");
  if (/^[=+@-]/.test(s.trimStart()) || /^\d{15,}$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
function triggerDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; a.style.display = "none";
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 10000);
}
function downloadBlob(name: string, body: string, type = "text/csv;charset=utf-8;") {
  triggerDownload(name, new Blob([body], { type }));
}
function exportCSV(name: string, rows: RecordItem[], columns: [string, string][]) {
  downloadBlob(name, "\ufeff" + [columns.map(c => safeCSV(c[1])).join(","), ...rows.map(r => columns.map(c => safeCSV(r[c[0]])).join(","))].join("\r\n"));
}
let xlsxLoading: Promise<any> | null = null;
function ensureXlsx(): Promise<any> {
  const ready = () => (window as any).XLSX?.utils && (window as any).XLSX?.read && (window as any).XLSX;
  if (ready()) return Promise.resolve(ready());
  if (xlsxLoading) return xlsxLoading;
  xlsxLoading = new Promise((resolve, reject) => {
    const old = document.getElementById("xlsx-reader"); if (old) old.remove();
    const script = document.createElement("script"); script.id = "xlsx-reader"; script.src = "/vendor/xlsx.full.min.js"; script.dataset.readerState = "loading";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timeout); clearInterval(poll);
      script.dataset.readerState = error ? "failed" : "ready";
      if (error) { xlsxLoading = null; reject(error); } else resolve(ready());
    };
    const timeout = setTimeout(() => finish(new Error("Excel 组件加载超时。请刷新页面后重试，也可以先导出 CSV。")), 12000);
    const poll = setInterval(() => { if (ready()) finish(); }, 200);
    script.onload = () => ready() ? finish() : finish(new Error("Excel 组件已加载但未能初始化，请刷新后重试。"));
    script.onerror = () => finish(new Error("Excel 组件加载失败，请刷新后重试。"));
    document.head.appendChild(script);
  });
  return xlsxLoading;
}
async function exportXlsx(sheets: { name: string; rows: RecordItem[]; columns: [string, string][] }[]) {
  const XLSX = await ensureXlsx(), workbook = XLSX.utils.book_new();
  for (const spec of sheets) {
    const values = [spec.columns.map(c => c[1]), ...spec.rows.map(r => spec.columns.map(([key]) => {
      const value = r[key];
      if (value == null) return "";
      if (/id$|^sku$|^phone$|^postcode$|^adCode/i.test(key)) return text(value);
      return typeof value === "number" ? value : Array.isArray(value) ? value.map(text).join("\n") : text(value);
    }))];
    const sheet = XLSX.utils.aoa_to_sheet(values);
    spec.columns.forEach(([key], column) => { if (key === "lifetimeGmv") for (let row = 1; row < values.length; row++) { const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]; if (cell?.t === "n") cell.z = '"€"#,##0.00'; } });
    sheet["!cols"] = spec.columns.map(([key, label]) => ({ wch: /notes|name|style|tendency|Links|street/i.test(key) ? 36 : /id|sku|phone|order/i.test(key) ? 24 : Math.max(14, label.length * 2 + 2) }));
    sheet["!autofilter"] = { ref: sheet["!ref"] };
    XLSX.utils.book_append_sheet(workbook, sheet, spec.name.slice(0, 31).replace(/[\\/?*\[\]:]/g, "_"));
  }
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true });
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function extractRows(book: any, sheet: string, XLSX: any): any[][] {
  const ws = book.Sheets[sheet]; let maxR = 0, maxC = 0;
  for (const key of Object.keys(ws)) {
    if (!/^[A-Z]+\d+$/.test(key) || !ws[key] || ws[key].v == null) continue;
    const cell = XLSX.utils.decode_cell(key); maxR = Math.max(maxR, cell.r); maxC = Math.max(maxC, cell.c);
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true, blankrows: true, range: { s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } } });
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function inferRange(name: string, allowMonth = true) {
  const m = name.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})[-_–](20\d{2})(\d{2})(\d{2})(?=\D|$)/);
  if (m) {
    const rangeStart = `${m[1]}-${m[2]}-${m[3]}`, rangeEnd = `${m[4]}-${m[5]}-${m[6]}`;
    if (validDate(rangeStart) && validDate(rangeEnd) && rangeStart <= rangeEnd) return { month: rangeStart.slice(0, 7) === rangeEnd.slice(0, 7) ? rangeStart.slice(0, 7) : "", rangeStart, rangeEnd };
    return null;
  }
  if (!allowMonth) return null;
  const n = name.match(/(20\d{2})[.\-年_/](\d{1,2})/);
  if (n && num(n[2]) >= 1 && num(n[2]) <= 12) { const month = `${n[1]}-${n[2].padStart(2, "0")}`; return { month, ...rangeForMonth(month) }; }
  return null;
}
function rangeForMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return { rangeStart: "", rangeEnd: "" };
  const [y, m] = month.split("-").map(Number); if (m < 1 || m > 12) return { rangeStart: "", rangeEnd: "" }; return { rangeStart: `${month}-01`, rangeEnd: `${month}-${new Date(y, m, 0).getDate()}` };
}
function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
function LevelBadge({ level, label }: { level: any; label?: string }) { return <span className={`level-badge level-${num(level) || 1}`}><Star size={11} fill="currentColor" /> L{num(level) || 1}{label && <span>{label}</span>}</span>; }
function Empty({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) { return <div className="empty-state"><div className="empty-icon"><FileSpreadsheet size={28} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>; }

export default function CreatorWorkbench({ user, onLogout, loggingOut, onSessionExpired }: { user: WorkbenchUser; onLogout: () => Promise<void>; loggingOut: boolean; onSessionExpired: () => void }) {
  const isAdmin = user.role === "admin";
  const [state, setState] = useState<any>(null), [revision, setRevision] = useState(0), [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [loadError, setLoadError] = useState(""), [canUndo, setCanUndo] = useState(false);
  const [notice, setNotice] = useState<Notice>(null), [view, setView] = useState<ViewName>("overview"), [month, setMonth] = useState("");
  const [mobileNav, setMobileNav] = useState(false), [help, setHelp] = useState(false), [search, setSearch] = useState("");
  const [sampleFilter, setSampleFilter] = useState("全部记录"), [creatorLevel, setCreatorLevel] = useState("all"), [creatorWillingness, setCreatorWillingness] = useState("");
  const [page, setPage] = useState(1), [sort, setSort] = useState("lifetimeItemsSold"), [promoMode, setPromoMode] = useState("calculated");
  const [promotionSort, setPromotionSort] = useState<{ key: PromotionSortKey; direction: "asc" | "desc" }>({ key: "itemsSold", direction: "desc" });
  const [editSample, setEditSample] = useState<RecordItem | null>(null), [editCreator, setEditCreator] = useState<RecordItem | null>(null);
  const [ruleDraft, setRuleDraft] = useState<any>(null), [sampleDraft, setSampleDraft] = useState<RecordItem>({}), [creatorDraft, setCreatorDraft] = useState<RecordItem>({});
  const [rulesDirty, setRulesDirty] = useState(false), [restoreData, setRestoreData] = useState<any>(null);
  const [selectedCreatorIds, setSelectedCreatorIds] = useState<Set<string>>(new Set());
  const [bulkWillingness, setBulkWillingness] = useState(""), [creatorWillingnessEdited, setCreatorWillingnessEdited] = useState(false);
  const [fileName, setFileName] = useState(""), [sourceHash, setSourceHash] = useState(""), [workbook, setWorkbook] = useState<any>(null), [sheet, setSheet] = useState("");
  const [sheetRows, setSheetRows] = useState<any[][]>([]), [headerRow, setHeaderRow] = useState(1), [importType, setImportType] = useState("orders");
  const [mapping, setMapping] = useState<Record<string, string>>({}), [importMonth, setImportMonth] = useState("");
  const [rangeStart, setRangeStart] = useState(""), [rangeEnd, setRangeEnd] = useState(""), [reportYear, setReportYear] = useState(String(new Date().getFullYear())), [dateFormat, setDateFormat] = useState("auto");
  const [sampleSource, setSampleSource] = useState(false), [reading, setReading] = useState(false), [preview, setPreview] = useState<any>(null);
  const [importError, setImportError] = useState(""), [replaceOverlapping, setReplaceOverlapping] = useState(false), [importedSheet, setImportedSheet] = useState("");
  const [replacePeriod, setReplacePeriod] = useState(true), [overwriteManual, setOverwriteManual] = useState(false);
  const [videoImportMode, setVideoImportMode] = useState<"sales" | "publication" | "pending">("sales");
  const [videoViewsKind, setVideoViewsKind] = useState<ViewsKind>("period");
  const [separateViewsPeriod, setSeparateViewsPeriod] = useState(false);
  const [viewsRangeStart, setViewsRangeStart] = useState(""), [viewsRangeEnd, setViewsRangeEnd] = useState("");
  const stageVideo = videoImportMode === "pending", publicationVideo = videoImportMode === "publication";
  const videoFactsOnly = stageVideo || publicationVideo;
  const [mappingInfo, setMappingInfo] = useState<any>(null), [sourceVersion, setSourceVersion] = useState(0);
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, PendingDraft>>({});
  const [publicationViewsDrafts, setPublicationViewsDrafts] = useState<Record<string, ViewsPeriodDraft>>({});
  const [pendingReview, setPendingReview] = useState<RecordItem | null>(null), [pendingError, setPendingError] = useState<{ id: string; message: string } | null>(null);
  const [exporting, setExporting] = useState(false), [preparedExport, setPreparedExport] = useState<{ name: string; url: string; sheetCount: number } | null>(null);
  const exportUrl = useRef<string | null>(null), exportRequest = useRef(0), exportLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null), restoreInput = useRef<HTMLInputElement>(null), saveLock = useRef(false), monthInitialized = useRef(false);
  const importRequest = useRef(0);
  const all = useMemo(() => state ? E.deriveData(state, {}) : { samples: [], creators: [], promotions: [], videos: [], stats: {}, months: [], issues: [] }, [state]);
  const commissionData = useCommissionData(state);
  const willingnessConfig = useMemo(() => getWillingnessConfig(state || E.defaultSettings), [state]);
  const willingnessFilterOptions = useMemo(() => unique([...willingnessConfig.options, ...(all.creators || []).map((c: RecordItem) => text(c.willingness))]) as string[], [all, willingnessConfig]);
  const willingnessRulesError = useMemo(() => { if (!ruleDraft) return ""; try { validateWillingnessConfig(ruleDraft); return ""; } catch (error: any) { return error.message || "请检查合作配合意愿选项。"; } }, [ruleDraft]);
  const selected = useMemo(() => state ? E.deriveData(state, { month: month || undefined }) : all, [state, month, all]);
  const salesDisplayMode = text(selected.stats?.displaySalesMode);
  const historicalSalesDisplay = !!month && salesDisplayMode.startsWith("historical-");
  const historicalPublicationDisplay = salesDisplayMode === "historical-publication";
  const salesDisplayCutoff = text(selected.stats?.displaySalesCutoff);
  const months = useMemo(() => unique([...(all.months || []), ...((state?.promotions || []).map(monthOf)), ...((all.videos || []).map(monthOf)), ...((all.samples || []).map(monthOf))]).filter(x => /^\d{4}-\d{2}$/.test(text(x))).sort().reverse() as string[], [all, state]);
  const currentNav = navItems.find(n => n.id === view)!;
  const ready = !!state;
  const importSignature = useMemo(() => JSON.stringify({ revision, sourceVersion, fileName, sourceHash, sheet, headerRow, importType, mapping, importMonth, rangeStart, rangeEnd, reportYear, dateFormat, sampleSource, replacePeriod, replaceOverlapping, overwriteManual, videoImportMode, videoViewsKind, separateViewsPeriod, viewsRangeStart, viewsRangeEnd }), [revision, sourceVersion, fileName, sourceHash, sheet, headerRow, importType, mapping, importMonth, rangeStart, rangeEnd, reportYear, dateFormat, sampleSource, replacePeriod, replaceOverlapping, overwriteManual, videoImportMode, videoViewsKind, separateViewsPeriod, viewsRangeStart, viewsRangeEnd]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true); setLoadError("");
    try { const res = await loadWorkbench(); if (res.status === 401) { setState(null); onSessionExpired(); return; } const json = await res.json() as RecordItem; if (!res.ok) throw new Error(json.error || "暂时无法读取数据，请重试。"); setState(json.state || E.createEmptyState()); setRevision(json.revision || 0); setUpdatedAt(json.updatedAt || ""); setCanUndo(!!json.canUndo); }
    catch (err: any) { setLoadError(err.message || "读取失败"); }
    finally { setLoading(false); }
  }, [onSessionExpired]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!monthInitialized.current && state && months.length) { const reportMonth = unique([state.meta?.videoReportMonth, ...months]).filter((m: any) => /^\d{4}-\d{2}$/.test(text(m))).sort().at(-1) || months[0]; setMonth(reportMonth); setImportMonth(reportMonth); const r = rangeForMonth(reportMonth); setRangeStart(r.rangeStart); setRangeEnd(r.rangeEnd); monthInitialized.current = true; } }, [state, months]);
  useEffect(() => { setPage(1); }, [view, search, month, sampleFilter, creatorLevel, creatorWillingness, sort]);
  useEffect(() => { setSelectedCreatorIds(new Set()); }, [view, search, creatorLevel, creatorWillingness]);
  useEffect(() => { if (bulkWillingness && !willingnessConfig.options.includes(bulkWillingness)) setBulkWillingness(""); }, [bulkWillingness, willingnessConfig]);
  useEffect(() => { if (notice?.type !== "success") return; const id = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(id); }, [notice]);
  useEffect(() => { if (state && !rulesDirty) { const config = getWillingnessConfig(state); setRuleDraft(clone({ ...E.defaultSettings, ...state.settings, willingnessOptions: config.options, defaultWillingness: config.defaultValue })); } }, [state, rulesDirty]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) { setEditSample(null); setEditCreator(null); setHelp(false); setMobileNav(false); setRestoreData(null); } }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [saving]);
  useEffect(() => { setPreview(null); }, [importSignature]);
  useEffect(() => () => { importRequest.current++; exportRequest.current++; if (exportUrl.current) URL.revokeObjectURL(exportUrl.current); }, []);

  const save = async (nextState: any, reason: string): Promise<boolean> => {
    if (!isAdmin) { setNotice({ type: "error", message: "普通账号仅可查看和导出，请使用管理员账号修改。" }); return false; }
    if (saveLock.current) return false; saveLock.current = true; setSaving(true);
    try {
      const response = await saveWorkbench(nextState, revision, reason);
      if (response.status === 401) { setState(null); onSessionExpired(); return false; }
      const result = await response.json() as RecordItem;
      if (!response.ok) throw new Error(response.status === 409 ? "数据已在其他页面更新。当前填写内容仍保留，请先点击右上角刷新，再重新保存。" : result.error || "保存失败，请重试。");
      setState(result.state || nextState); setRevision(result.revision); setUpdatedAt(result.updatedAt || new Date().toISOString()); setCanUndo(result.canUndo ?? true); setNotice({ type: "success", message: reason + "，已保存" }); return true;
    } catch (error: any) { setNotice({ type: "error", message: error.message }); return false; }
    finally { saveLock.current = false; setSaving(false); }
  };
  const go = (next: ViewName) => { if (!isAdmin && ["commissions", "imports", "rules", "admin"].includes(next)) return; setView(next); setMobileNav(false); setSearch(""); };
  const openPublicationPeriods = () => { go("imports"); requestAnimationFrame(() => document.getElementById("publication-reports")?.scrollIntoView({ block: "start", behavior: "smooth" })); };
  const openImport = () => { if (!isAdmin || saving || saveLock.current) return; go("imports"); setTimeout(() => { if (!saveLock.current) fileInput.current?.click(); }, 30); };
  const logout = async () => { try { await onLogout(); } catch (error: any) { setNotice({ type: "error", message: error.message || "退出未完成，请重试。" }); } };
  const headers = useMemo(() => (sheetRows[Math.max(0, headerRow - 1)] || []).map((v, i) => text(v).trim() || `未命名列 ${i + 1}`), [sheetRows, headerRow]);
  const fields = E.fieldSchemas[importType] || [];
  const missingRequired = fields.filter((f: any) => f.required && (mapping[f.key] == null || mapping[f.key] === ""));
  const hasMappedVideoPeriod = ["salesDate", "reportMonth"].some(key => !blank(mapping[key])) || (!blank(mapping.periodStart) && !blank(mapping.periodEnd));
  const mappingLabels = (keys: string[]) => keys.map(key => fields.find((f: any) => f.key === key)?.label || key).join("、");
  const missingPresetFields = (mappingInfo?.missing || []).filter((key: string) => blank(mapping[key]));
  const ambiguousPresetFields = (mappingInfo?.ambiguous || []).filter((key: string) => blank(mapping[key]));
  const samples = selected.samples || [];
  const filteredSamples = samples.filter((r: RecordItem) => (sampleFilter === "全部记录" || (sampleFilter === "候选待确认" ? num(r.candidateVideoCount) > 0 && r.effective !== false : sampleStatus(r) === sampleFilter)) && (!search || [r.creatorId, r.buyerUsername, r.orderCreatorId, r.orderId, r.productId, r.sku, r.skuId, r.notes, r.productName].some(v => text(v).toLowerCase().includes(search.toLowerCase()))));
  const creators = (all.creators || []).filter((r: RecordItem) => (creatorLevel === "all" || num(r.level) === num(creatorLevel)) && (!creatorWillingness || text(r.willingness) === creatorWillingness) && (!search || [r.creatorId, r.name, r.notes, r.tendency, r.style].some(v => text(v).toLowerCase().includes(search.toLowerCase())))).sort((a: RecordItem, b: RecordItem) => {
    const key = sort === "lifetimeGmvAsc" ? "lifetimeGmv" : sort;
    const missingA = a[key] == null || (key === "lifetimeGmv" && a.gmvAvailable === false), missingB = b[key] == null || (key === "lifetimeGmv" && b.gmvAvailable === false);
    if (["cumulativeVideoViews", "lifetimeGmv"].includes(key) && (missingA || missingB)) return missingA ? missingB ? 0 : 1 : -1;
    const result = num(b[key]) - num(a[key]); return sort === "lifetimeGmvAsc" ? -result : result;
  });
  const filteredCreatorIds = new Set<string>(creators.map((c: RecordItem) => cid(c.creatorId)));
  const effectiveSelectedCreatorIds = [...selectedCreatorIds].filter(id => filteredCreatorIds.has(id));
  const selectedCreatorCount = effectiveSelectedCreatorIds.length;
  const creatorPageRows = creators.slice((page - 1) * 12, page * 12);
  const creatorPageIds = creatorPageRows.map((c: RecordItem) => cid(c.creatorId));
  const selectedOnPage = creatorPageIds.filter((id: string) => selectedCreatorIds.has(id)).length;
  const allPageSelected = creatorPageIds.length > 0 && selectedOnPage === creatorPageIds.length;
  const toggleCreatorSelection = (id: string, checked: boolean) => setSelectedCreatorIds(previous => { const next = new Set(previous); if (checked) next.add(cid(id)); else next.delete(cid(id)); return next; });
  const toggleCreatorPage = (checked: boolean) => setSelectedCreatorIds(previous => { const next = new Set(previous); for (const id of creatorPageIds) { if (checked) next.add(id); else next.delete(id); } return next; });
  const saveBulkWillingness = async () => {
    if (!isAdmin || saving || !selectedCreatorCount || !willingnessConfig.options.includes(bulkWillingness)) return;
    try {
      const result = updateCreatorWillingness(state, effectiveSelectedCreatorIds, bulkWillingness);
      if (await save(result.state, `已将 ${formatNum(result.summary.selected)} 位达人的合作配合意愿设为「${bulkWillingness}」`)) { setSelectedCreatorIds(new Set()); setBulkWillingness(""); }
    } catch (error: any) { setNotice({ type: "error", message: error.message || "批量修改未完成，请重试。" }); }
  };
  const filteredPromotions = (selected.promotions || []).filter((r: RecordItem) => (!month || !r.month || monthOf(r) === month) && (!search || [r.productId, r.sku, r.representativeSku, r.productName].some(v => text(v).toLowerCase().includes(search.toLowerCase()))));
  const promotions = [...filteredPromotions].sort((a: RecordItem, b: RecordItem) => {
    const key = promotionSort.key, missingA = blank(a[key]) || (key === "itemsSold" && a.salesAvailable === false), missingB = blank(b[key]) || (key === "itemsSold" && b.salesAvailable === false);
    if (missingA || missingB) return missingA ? missingB ? 0 : 1 : -1;
    return (num(a[key]) - num(b[key])) * (promotionSort.direction === "asc" ? 1 : -1);
  });
  const promotionSalesMode = text(selected.stats?.promotionSalesMode);
  const promotionReferenceDisplay = isPromotionReference(promotionSalesMode);
  const promotionSalesLabel = !month ? "推广出单 / 参考合计" : ["publication-unconfirmed", "publication-cross-month"].includes(promotionSalesMode) ? "发布报表出单参考" : promotionReferenceDisplay ? "历史出单参考" : "视频出单";
  const promotionViewsMode = text(selected.stats?.promotionViewsMode);
  const promotionViewsLabel = !month ? "推广播放 / 参考合计" : ["publication-unconfirmed", "publication-cross-month"].includes(promotionViewsMode) ? "发布报表播放参考" : isPromotionReference(promotionViewsMode) ? "播放量 / 历史参考" : "当月播放量";
  const promotionSoldTotal = promotionSalesMode === "unavailable" || selected.stats?.promotionItemsSold == null ? null : num(selected.stats.promotionItemsSold);
  const promotionViewsTotal = selected.stats?.promotionViewsAvailable === false || selected.stats?.promotionViews == null ? null : num(selected.stats.promotionViews);
  const promotionSalesSource = text(selected.stats?.promotionSalesSource);
  const promotionViewsSource = text(selected.stats?.promotionViewsSource);
  const promotionViewsCoverage = text(selected.stats?.promotionViewsCoverage);
  const promotionSortLabel = promotionSort.key === "itemsSold" && promotionReferenceDisplay ? "出单参考" : promotionSortColumns.find(column => column.key === promotionSort.key)!.label;
  const changePromotionSort = (key: PromotionSortKey) => {
    setPromotionSort(current => ({ key, direction: current.key === key && current.direction === "desc" ? "asc" : "desc" }));
    setPage(1);
  };
  const issues = all.issues || [];
  const sampleOrders = selected.stats?.sampleOrders ?? unique(samples.filter((r: RecordItem) => r.effective !== false).map((r: RecordItem) => r.orderId || r.id)).length;
  const matchedSamples = selected.stats?.matchedSamples ?? samples.filter((r: RecordItem) => sampleStatus(r) === "已发视频").length;
  const sampleCreators = unique(samples.filter((r: RecordItem) => r.effective !== false).map((r: RecordItem) => r.creatorId)).length;
  const effectiveSamples = samples.filter((r: RecordItem) => r.effective !== false);
  const pendingSamples = selected.stats?.pendingSamples ?? effectiveSamples.length - matchedSamples;
  const candidateSamples = effectiveSamples.filter((row: RecordItem) => num(row.candidateVideoCount) > 0).length;
  const pendingReportCount = (state?.pendingVideoImports || []).filter((report: RecordItem) => report.status === "period_unconfirmed" && report.active !== false).length;
  const publicationReports = (state?.pendingVideoImports || []).filter((report: RecordItem) => report.status === "publication_only" && report.active !== false);
  const selectedSalesRanges = month ? unique((state?.videos || []).filter((row: RecordItem) => row.reportPurpose !== "publication" && text(row.periodStart).slice(0, 7) === month && text(row.periodEnd).slice(0, 7) === month).map((row: RecordItem) => `${dateText(row.periodStart)} 至 ${dateText(row.periodEnd)}`)).sort() : [];
  const promotionSampleOrders = selected.stats?.promotionSampleOrders ?? sampleOrders;
  const promotionSampleQuantity = selected.stats?.promotionSampleQuantity ?? effectiveSamples.reduce((sum: number, r: RecordItem) => sum + num(r.quantity), 0);
  const promotionSampleCreators = selected.stats?.promotionSampleCreators ?? sampleCreators;
  const promotionUnlinkedOrders = num(selected.stats?.promotionUnlinkedSampleOrders);
  const promotionSampleSource = text(selected.stats?.promotionSampleSource) || "收样台账";
  const selectedVideos = selected.videos || [];
  const uniqueVideos = selected.stats?.videoCount ?? unique(selectedVideos.map((r: RecordItem) => r.videoId || r.id)).length;
  const soldTotal = num(selected.stats?.displayItemsSold ?? selected.stats?.itemsSold ?? selected.stats?.totalItemsSold ?? promotions.reduce((n: number, r: RecordItem) => n + num(r.itemsSold), 0));
  const viewsTotal = selected.stats?.viewsAvailable === false || selected.stats?.views == null ? null : num(selected.stats.views);
  const viewsMetricLabel = month ? "当月播放量" : "已确认累计播放量";
  const viewsCoverage = text(selected.stats?.viewsCoverage);
  const unconfirmedViewsReportCount = num(all.stats?.unconfirmedViewsReportCount);
  const excellentCount = (all.creators || []).filter((r: RecordItem) => num(r.level) === 5).length;
  const cooperationCreators = (all.creators || []).filter((r: RecordItem) => num(r.videoCount) > 0 || num(r.sampleCount) > 0);
  const rankCreators = [...(all.creators || [])].sort((a: RecordItem, b: RecordItem) => num(b.itemsSold) - num(a.itemsSold)).filter((c: RecordItem) => num(c.itemsSold) > 0).slice(0, 5);
  const productLeaders = filteredPromotions.filter((p: RecordItem) => num(p.itemsSold) > 0).sort((a: RecordItem, b: RecordItem) => num(b.itemsSold) - num(a.itemsSold)).slice(0, 5);
  const sampleCols: [string, string][] = [["manualRecordId", "手工记录ID"], ["creatorId", "达人ID"], ["buyerUsername", "Buyer Username（订单达人ID）"], ["orderCreatorId", "订单识别达人ID"], ["creatorIdentityConflict", "达人ID待核对"], ["orderId", "订单号"], ["date", "日期"], ["received", "收样状态"], ["sku", "Seller SKU"], ["skuId", "SKU ID / 样品ID"], ["productId", "产品PID"], ["quantity", "数量"], ["videoLinks", "已确认视频链接"], ["candidateVideoLinks", "候选视频链接（未确认）"], ["candidateVideoCount", "候选视频数"], ["matchedVideoCount", "已确认链接匹配视频数"], ["itemsSold", "关联视频出单"], ["views", "关联视频历史最高播放参考"], ["matchStatus", "匹配状态"], ["notes", "备注"]];
  const creatorCols: [string, string][] = [["creatorId", "达人ID"], ["level", "等级"], ["levelLabel", "等级名称"], ["admissionReason", "纳入管理依据"], ["lifetimeItemsSold", "已确认销售期间累计出单量"], ["lifetimeGmv", "累计出单金额（GMV，EUR）"], ["gmvCoverageLabel", "GMV数据完整性"], ["gmvSource", "累计GMV统计来源"], ["gmvRecordCount", "已提供GMV记录数"], ["gmvMissingRecords", "缺少GMV记录数"], ["historicalItemsSold", "历史累计出单(参考)"], ["cumulativeVideoViews", "累计播放量（历史底数＋后续期间）"], ["cumulativeVideoViewsSource", "累计播放量来源"], ["cumulativeVideoViewsCoverage", "累计播放量覆盖范围"], ["historicalVideoViewsReference", "历史报表最高播放参考（期间可能不同）"], ["views", "达人视频均播放量（导入快照）"], ["viewsAsOf", "均播放量更新日期"], ["viewsSource", "均播放量来源"], ["videoCount", "视频数"], ["cooperationCount", "合作次数"], ["cooperationSource", "合作次数依据"], ["recordedSampleQuantity", "有效收样件数"], ["manualSelfPurchasedSampleQuantity", "自购样品数量（手工）"], ["selfPurchasedSampleQuantity", "计入合作的自购样品数量"], ["estimatedSelfPurchaseQuantity", "默认估计自购件数"], ["selfPurchaseNotes", "自购样品备注"], ["sampleCount", "有效收样记录数"], ["topProductId", "主要出单产品PID"], ["topProductSku", "主要出单产品代表SKU"], ["topProductName", "主要出单产品名称"], ["topProductSold", "主要产品累计出单"], ["topProductShare", "主要产品销量占比"], ["topProductSampleStatus", "主要产品收样匹配"], ["topProductVideoUrl", "主要产品代表视频"], ["successfulSampleVideoCount", "表现好样品视频数"], ["productContributionSummary", "产品出单贡献明细"], ["tendency", "带货倾向"], ["style", "视频特点/风格"], ["willingness", "合作配合意愿"], ["notes", "备注"], ["gradeReason", "评级依据"], ["cumulativeVideoViewsBaseline", "历史播放底数"], ["cumulativeVideoViewsPeriodTotal", "后续已确认期间播放"], ["cumulativeVideoViewsBaselineCutoff", "历史底表截止日"]];
  const creatorExportRows = (rows: RecordItem[]) => rows.map(r => ({ ...r, lifetimeGmv: r.gmvAvailable === false || r.lifetimeGmv == null ? null : r.lifetimeGmv, gmvCoverageLabel: gmvCoverageLabel(r.gmvCoverageStatus), cumulativeVideoViews: r.cumulativeVideoViewsAvailable === false ? null : creatorPlaybackNumber(r.cumulativeVideoViews), cumulativeVideoViewsBaseline: creatorPlaybackNumber(r.cumulativeVideoViewsBaseline), cumulativeVideoViewsPeriodTotal: creatorPlaybackNumber(r.cumulativeVideoViewsPeriodTotal), cumulativeVideoViewsBaselineCutoff: text(r.cumulativeVideoViewsBaselineCutoff), topProductId: r.topProduct?.productId || "", topProductSku: r.topProduct?.representativeSku || "", topProductName: r.topProduct?.productName || "", topProductSold: r.topProduct?.itemsSold ?? "", topProductShare: r.topProduct ? salesShare(r.topProduct.salesShare) : "", topProductSampleStatus: r.topProduct ? r.topProduct.sampleLinked ? "已匹配收样产品" : "未匹配收样产品" : "", topProductVideoUrl: hasPositiveContributionVideo(r.topProduct) ? r.topProduct.topVideoUrl || "" : "", productContributionSummary: (r.productContributions || []).map((p: RecordItem) => `${p.representativeSku || p.productName || p.productId || "未识别产品"} | PID ${p.productId || "待补充"} | ${formatNum(p.itemsSold)}件 | ${salesShare(p.salesShare)} | ${p.sampleLinked ? "已匹配收样" : "未匹配收样"}`).join("\n") }));
  const contributionCols: [string, string][] = [["creatorId", "达人ID"], ["productId", "产品PID"], ["representativeSku", "代表SKU"], ["productName", "产品名称"], ["itemsSold", "累计出单量"], ["salesShareText", "占达人累计销量"], ["sampleStatus", "收样匹配"], ["sampleQuantity", "样品件数"], ["goodVideoCount", "超过表现阈值的视频数"], ["topVideoId", "最高出单视频ID"], ["topVideoUrl", "最高出单视频链接"], ["topVideoItemsSold", "最高视频累计出单"], ["salesStatus", "出单状态"]];
  const promotionCols: [string, string][] = [["month", "月份"], ["productId", "产品PID"], ["representativeSku", "代表SKU"], ["productName", "产品名称"], ["sampleOrders", "发样订单数"], ["sampleMetricSource", "发样数据来源"], ["unlinkedSampleOrders", "达人待关联发样订单数"], ["sampleQuantity", "发样数量"], ["creatorCount", "发样达人数"], ["videoCount", "视频数（按发布日期）"], ["sellingVideoCount", "出单视频数（来源见后列）"], ["sellingVideoSource", "出单视频明细来源"], ["primarySalesVideoSummary", "主要出单及爆款视频（链接与件数）"], ["publishedVideoLinks", "发布视频链接（按发布日期）"], ["itemsSold", "视频出单量"], ["views", "播放量（来源见后列）"], ["viewsDisplayLabel", "播放展示口径"], ["viewsSource", "播放量来源"], ["viewsCoverage", "播放量覆盖范围"], ["sellingCreators", "出单达人"], ["videoLinks", "出单/历史参考视频链接"], ["historicalSampleQuantity", "历史填报发样量"], ["historicalItemsSold", "历史填报单量"], ["videoMetricSource", "出单数据来源"], ["confirmedPeriodItemsSold", "已确认当期视频出单"], ["historicalPublicationItemsSold", "按发布月份归组的历史累计参考"], ["salesDisplayLabel", "出单展示口径"], ["salesDisplayCutoff", "历史参考截止日"], ["notes", "备注"]];
  const sampleExcelCols: [string, string][] = [["manualRecordId", "手工记录ID"], ["date", "日期"], ["creatorId", "达人ID"], ["orderId", "Order ID"], ["creatorName", "达人名字"], ["region", "地址 Autonomous Community"], ["province", "Province"], ["city", "City"], ["street", "Street Name"], ["house", "House Name or Number"], ["phone", "电话/wasp"], ["email", "邮箱"], ["postcode", "邮编"], ["skuId", "样品ID"], ["sku", "样品SKU"], ["quantity", "发样数量"], ["logisticsUpdated", "是否更新物流"], ["received", "是否收到样品"], ["contacted", "是否联系申样"], ["videoUpdateDate", "更新视频日期"], ["videoNotes", "视频备注"], ["historicalItemsSold", "卖出个数"], ["itemsSold", "关联视频出单量"], ["notes", "后续合作沟通"], ["url", "视频链接"], ["adCode1", "ad code1"], ["url2", "视频链接2"], ["adCode2", "ad code2"], ["url3", "视频链接3"], ["productId", "Product ID"], ["videoLinks", "全部已确认视频链接"], ["candidateVideoLinks", "候选视频链接（未确认）"], ["candidateVideoCount", "候选视频数"], ["views", "关联视频历史最高播放参考"], ["matchStatus", "匹配状态"]];
  const promotionExcelColumns = (period: string): [string, string][] => [["representativeSku", "SKU"], ["productId", "Product ID"], ["sampleQuantity", `${/^\d{4}-\d{2}$/.test(period) ? Number(period.slice(5)) + "月" : ""}发样数量`], ["itemsSold", `${/^\d{4}-\d{2}$/.test(period) ? Number(period.slice(5)) + "月" : ""}视频出单情况Items sold`], ["viralVideoLinks", "是否有爆款视频"], ["sellingCreators", "出单达人ID"], ["notes", "备注"], ["month", "月份"], ["sampleOrders", "发样订单数"], ["sampleMetricSource", "发样数据来源"], ["unlinkedSampleOrders", "达人待关联发样订单数"], ["creatorCount", "发样达人数"], ["videoCount", "视频数（按发布日期）"], ["sellingVideoCount", "出单视频数（来源见后列）"], ["sellingVideoSource", "出单视频明细来源"], ["primarySalesVideoSummary", "主要出单及爆款视频（链接与件数）"], ["publishedVideoLinks", "发布视频链接（按发布日期）"], ["views", "播放量（来源见后列）"], ["viewsDisplayLabel", "播放展示口径"], ["viewsSource", "播放量来源"], ["viewsCoverage", "播放量覆盖范围"], ["historicalSampleQuantity", "历史填报发样数量"], ["historicalItemsSold", "历史填报出单量"], ["videoMetricSource", "出单数据来源"], ["confirmedPeriodItemsSold", "已确认当期视频出单"], ["historicalPublicationItemsSold", "按发布月份归组的历史累计参考"], ["salesDisplayLabel", "出单展示口径"], ["salesDisplayCutoff", "历史参考截止日"], ["videoLinks", "出单/历史参考视频链接"]];
  const promotionExportRows = (rows: RecordItem[]) => rows.map(row => ({ ...row, itemsSold: row.salesAvailable === false ? null : row.itemsSold, views: row.viewsAvailable === false ? null : row.views, salesDisplayLabel: promotionSourceLabel(row.salesDisplayMode), viewsDisplayLabel: promotionSourceLabel(row.viewsDisplayMode), primarySalesVideoSummary: (row.primarySalesVideos || []).map((video: RecordItem, index: number) => `${index === 0 ? "主要出单" : "出单视频"}${video.isViral ? " / 爆款" : ""} | ${formatNum(video.itemsSold)} 件 | ${video.url || `视频ID ${video.videoId}（缺少链接）`}`).join("\n") }));
  const promoExcelCols = promotionExcelColumns(month);
  const sampleExcelRows = (rows: RecordItem[]) => rows.map(r => ({ ...r, url: linksOf(r)[0] || "", url2: linksOf(r)[1] || "", url3: linksOf(r)[2] || "" }));
  const clearPreparedExport = () => {
    if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
    exportUrl.current = null; setPreparedExport(null);
  };
  const exportTable = async (type: "samples" | "promotion" | "creators" | "all") => {
    if (exportLock.current) return;
    exportLock.current = true; setExporting(true); clearPreparedExport();
    const request = ++exportRequest.current;
    const sheets = [];
    if (["samples", "all"].includes(type)) sheets.push({ name: "收样表", rows: sampleExcelRows(type === "all" ? all.samples : filteredSamples), columns: sampleExcelCols });
    if (type === "promotion") sheets.push({ name: `推广${month ? month.replace("-", ".") : "全部月份"}`, rows: promotionExportRows(promotions), columns: promoExcelCols });
    if (type === "all") {
      const rows = all.promotions || [], periods = unique(rows.map((r: RecordItem) => monthOf(r) || "未分月")).sort() as string[];
      for (const period of periods) sheets.push({ name: `推广${period.replace("-", ".")}`, rows: promotionExportRows(rows.filter((r: RecordItem) => (monthOf(r) || "未分月") === period)), columns: promotionExcelColumns(period) });
    }
    if (["creators", "all"].includes(type)) {
      const selectedCreators = type === "all" ? all.creators : creators;
      sheets.push({ name: "分层管理", rows: creatorExportRows(selectedCreators), columns: creatorCols });
      sheets.push({ name: "达人产品出单贡献", rows: contributionExportRows(selectedCreators), columns: contributionCols });
    }
    if (type === "all") sheets.push({ name: "产品id表", rows: state.productMappings || [], columns: [["productId", "Product ID"], ["productName", "Product Name"], ["skuId", "SKU ID"], ["sku", "SKU Name"]] as [string,string][] });
    setNotice({ type: "info", message: "正在准备 Excel 文件…" });
    try {
      const blob = await exportXlsx(sheets);
      if (request !== exportRequest.current) return;
      const name = `heihei_${type === "all" ? "达人工作台" : type === "samples" ? "收样表" : type === "promotion" ? "推广" : "达人分层"}_${type === "all" ? "全部月份" : type === "creators" ? "累计" : month || "全部"}.xlsx`;
      const url = URL.createObjectURL(blob); exportUrl.current = url;
      setPreparedExport({ name, url, sheetCount: sheets.length }); setNotice(null);
    } catch (err: any) { if (request === exportRequest.current) setNotice({ type: "error", message: err.message || "导出失败，请重试。" }); }
    finally { if (request === exportRequest.current) { exportLock.current = false; setExporting(false); } }
  };

  const restoreMapping = (nextHeaders: string[], nextType: string, reuse = true) => {
    const result = restoreImportPreset(nextHeaders, E.guessMappings(nextHeaders, nextType), reuse ? state?.mappingPresets?.[nextType] : undefined);
    setMapping(result.mapping); setMappingInfo({ ...result, manual: false }); setPreview(null);
  };

  const resetImportDraft = () => {
    // Invalidate in-flight reads before clearing only the local upload draft.
    const request = ++importRequest.current;
    setFileName(""); setSourceHash(""); setWorkbook(null); setSheet(""); setSheetRows([]);
    setHeaderRow(1); setImportType("orders"); setMapping({}); setMappingInfo(null);
    setImportMonth(""); setRangeStart(""); setRangeEnd(""); setReportYear(String(new Date().getFullYear())); setDateFormat("auto");
    setSampleSource(false); setReading(false); setPreview(null); setImportError(""); setImportedSheet("");
    setReplaceOverlapping(false); setReplacePeriod(true); setOverwriteManual(false);
    setVideoImportMode("sales"); setVideoViewsKind("period"); setSeparateViewsPeriod(false); setViewsRangeStart(""); setViewsRangeEnd("");
    setSourceVersion(value => value + 1);
    if (fileInput.current) fileInput.current.value = "";
    return request;
  };
  const clearCurrentFile = () => {
    if (!isAdmin || saving || saveLock.current) return;
    resetImportDraft();
    setNotice({ type: "info", message: "已清除本次文件、填写内容和预览。已保存的记录继续保留，下次可重新选择文件。" });
  };
  const selectSheet = async (book: any, sheetName: string, originalFile = fileName, fileRequest?: number) => {
    if (!isAdmin || saving || saveLock.current) return;
    const request = fileRequest ?? ++importRequest.current;
    if (request !== importRequest.current) return;
    setReading(true); setPreview(null); setImportError("");
    try {
      const XLSX = await ensureXlsx();
      if (request !== importRequest.current) return;
      const rows = extractRows(book, sheetName, XLSX); setSheet(sheetName); setSheetRows(rows); setReplaceOverlapping(false);
      const fallbackType = fileRequest === undefined ? importType : "orders";
      let best = { score: -1, row: 0, type: fallbackType, maps: {} };
      for (let i = 0; i < Math.min(rows.length, 18); i++) {
        const hs = rows[i].map(text); const detected = E.detectType(hs, sheetName) || fallbackType;
        const maps = E.guessMappings(hs, typeof detected === "string" ? detected : detected.type || fallbackType);
        const score = Object.values(maps).filter(v => v !== "" && v != null).length;
        if (score > best.score) best = { score, row: i, type: typeof detected === "string" ? detected : detected.type || fallbackType, maps };
      }
      setSourceVersion(v => v + 1); setHeaderRow(best.row + 1); setImportType(best.type); setVideoImportMode("sales"); setVideoViewsKind("period"); setSeparateViewsPeriod(false); setViewsRangeStart(""); setViewsRangeEnd("");
      restoreMapping((rows[best.row] || []).map((v, i) => text(v).trim() || `未命名列 ${i + 1}`), best.type);
      setSampleSource(/发样|寄样|样品订单|sample.*order/i.test(sheetName));
      const range = inferRange(originalFile, best.type !== "videos") || inferRange(sheetName, best.type !== "videos"); if (range) { setImportMonth(range.month); setRangeStart(range.rangeStart); setRangeEnd(range.rangeEnd); setReportYear(range.rangeStart.slice(0, 4)); } else if (best.type === "videos") { setImportMonth(""); setRangeStart(""); setRangeEnd(""); }
    } catch (error: any) {
      if (request === importRequest.current) { setSheetRows([]); setMapping({}); setMappingInfo(null); setImportError(error.message || "工作表读取失败，请重新选择文件。"); }
    } finally { if (request === importRequest.current) setReading(false); }
  };
  const receiveFile = async (file?: File) => {
    if (!isAdmin || !file || saving || saveLock.current) return;
    const request = resetImportDraft();
    setReading(true); setFileName(file.name); setNotice(null); setView("imports");
    try {
      const XLSX = await ensureXlsx();
      if (request !== importRequest.current) return;
      const buf = await file.arrayBuffer();
      if (request !== importRequest.current) return;
      const fingerprint = await fileFingerprint(buf);
      if (request !== importRequest.current) return;
      const book = XLSX.read(buf, { type: "array", cellDates: false, nodim: true, raw: true, cellText: true });
      if (!book.SheetNames?.length) throw new Error("这个文件没有可读取的工作表。");
      setWorkbook(book); setFileName(file.name); setSourceHash(fingerprint);
      const first = book.SheetNames.find((s: string) => /video|收样|发样|产品id|分层/i.test(s)) || book.SheetNames[0];
      await selectSheet(book, first, file.name, request);
    } catch (error: any) { if (request === importRequest.current) setImportError(error.message || "文件读取失败，请使用 XLSX、XLS 或 CSV 文件。"); }
    finally { if (request === importRequest.current) { setReading(false); if (fileInput.current) fileInput.current.value = ""; } }
  };
  const changeHeader = (n: number) => { setHeaderRow(n); restoreMapping((sheetRows[n - 1] || []).map((v, i) => text(v).trim() || `未命名列 ${i + 1}`), importType); };
  const changeType = (type: string) => { setImportType(type); restoreMapping(headers, type); setImportError(""); };
  const importContext = () => {
    const factsOnly = importType === "videos" && videoFactsOnly;
    return { sourceName: fileName, fileName, sourceHash, headers, mappingSignature: JSON.stringify({ mapping, dateFormat, headerRow, importType, reportYear: importType === "videos" ? reportYear : undefined }), sheetName: sheet, headerRow, month: factsOnly ? "" : importMonth, rangeStart: factsOnly ? "" : rangeStart, rangeEnd: factsOnly ? "" : rangeEnd, suggestedRangeStart: factsOnly ? rangeStart : "", suggestedRangeEnd: factsOnly ? rangeEnd : "", viewsKind: importType === "videos" ? stageVideo ? "unconfirmed" : videoViewsKind : undefined, ...(importType === "videos" && !stageVideo && videoViewsKind === "period" && (publicationVideo || separateViewsPeriod) ? { viewsPeriodStart: publicationVideo ? rangeStart : viewsRangeStart, viewsPeriodEnd: publicationVideo ? rangeEnd : viewsRangeEnd } : {}), reportYear, dateFormat, sampleSource, replaceOverlapping: !factsOnly && replaceOverlapping, replacePeriod: importType === "videos" && !factsOnly && replacePeriod, overwriteManual, reportPurpose: importType === "videos" ? publicationVideo ? "publication" : "sales" : undefined, allowUnconfirmedPeriod: factsOnly, importedAt: new Date().toISOString() };
  };
  const mergeSelectedImport = (records: RecordItem[]) => importType === "videos" && videoFactsOnly ? stageVideoImport(state, records, importContext()) : E.mergeImport(state, importType, records, importContext());
  const duplicateVideoSource = importType === "videos" && state ? E.findDuplicateVideoImport(state, importContext()) : null;
  const previewImport = () => {
    if (!isAdmin || !workbook || reading || saving || saveLock.current) return;
    setImportError("");
    try {
      if (duplicateVideoSource) { const result = mergeSelectedImport([]); setPreview({ ...result, records: [], contextSignature: importSignature, rejected: 0, warnings: result.summary.warnings || [] }); return; }
      if (missingRequired.length) throw new Error(`请匹配必填列：${missingRequired.map((f: any) => f.label).join("、")}`);
      if (importType === "videos" && publicationVideo && videoViewsKind === "period" && (!validDate(rangeStart) || !validDate(rangeEnd) || rangeStart > rangeEnd)) throw new Error("请确认发布报表的统计月份或有效起止日期；只有发布日期时，可选择“统计期间待确认”并保留为发布报表参考。");
      if (importType === "videos" && !videoFactsOnly && videoViewsKind === "period" && separateViewsPeriod && (!validDate(viewsRangeStart) || !validDate(viewsRangeEnd) || viewsRangeStart > viewsRangeEnd)) throw new Error("请填写独立播放统计期间的有效起止日期。");
      if (importType === "videos" && !videoFactsOnly && !hasMappedVideoPeriod && (!rangeStart || !rangeEnd)) throw new Error("请匹配出单日期、统计月份或完整起止日期列；未确定报表用途或销售期间时，可选择先暂存。");
      if (importType === "videos" && !videoFactsOnly && !hasMappedVideoPeriod && (!validDate(rangeStart) || !validDate(rangeEnd))) throw new Error("请填写有效的统计起止日期，不能使用视频发布日期代替统计周期。");
      if (!videoFactsOnly && !hasMappedVideoPeriod && rangeStart && rangeEnd && rangeStart > rangeEnd) throw new Error("统计开始日期不能晚于结束日期。");
      const normalized = E.normalizeRows(importType, sheetRows.slice(headerRow), mapping, importContext());
      if (!normalized.records.length) throw new Error(`没有识别到有效记录。请检查表头行、必填列与工作表选择。${normalized.warnings?.slice(0, 2).join("；") || ""}`);
      const result = mergeSelectedImport(normalized.records);
      const playbackWarnings: string[] = [];
      if (importType === "videos" && !stageVideo && videoViewsKind === "period") {
        const affectedVideos = new Set(normalized.records.map((record: RecordItem) => text(record.videoId)));
        const warningGroups = new Map<string, { count: number; message: string }>();
        for (const issue of deriveVideoViews(result.state).issues as RecordItem[]) {
          const affectedReport = !!result.summary?.pendingImportId && issue.reportId === result.summary.pendingImportId;
          if (!affectedVideos.has(text(issue.videoId)) && !affectedReport) continue;
          const previous = warningGroups.get(issue.type);
          warningGroups.set(issue.type, { count: (previous?.count || 0) + 1, message: issue.message });
        }
        for (const warning of warningGroups.values()) playbackWarnings.push(`${formatNum(warning.count)} 项播放核对：${warning.message}`);
      }
      const periodCounts = new Map<string, RecordItem>();
      const viewsPeriodCounts = new Map<string, RecordItem>();
      if (importType === "videos" && !videoFactsOnly) for (const record of normalized.records) { const key = `${record.periodStart}|${record.periodEnd}`; const previous = periodCounts.get(key); periodCounts.set(key, { periodStart: record.periodStart, periodEnd: record.periodEnd, reportMonth: record.reportMonth, recordCount: (previous?.recordCount || 0) + 1 }); }
      if (importType === "videos" && !stageVideo && videoViewsKind === "period") for (const record of normalized.records) {
        const start = publicationVideo ? rangeStart : separateViewsPeriod ? viewsRangeStart : record.viewsPeriodStart || record.periodStart;
        const end = publicationVideo ? rangeEnd : separateViewsPeriod ? viewsRangeEnd : record.viewsPeriodEnd || record.periodEnd;
        if (!start || !end) continue;
        const key = `${start}|${end}`, previous = viewsPeriodCounts.get(key);
        viewsPeriodCounts.set(key, { start, end, recordCount: (previous?.recordCount || 0) + 1 });
      }
      setPreview({ ...result, records: normalized.records, recognizedPeriods: [...periodCounts.values()].sort((a, b) => text(a.periodStart).localeCompare(text(b.periodStart))), recognizedViewsPeriods: [...viewsPeriodCounts.values()].sort((a, b) => text(a.start).localeCompare(text(b.start))), contextSignature: importSignature, rejected: normalized.rejected, warnings: [...playbackWarnings, ...(normalized.warnings || []), ...(result.summary?.warnings || [])] });
    } catch (error: any) { setPreview(null); setImportError(error.code === "OVERLAPPING_PERIOD" ? `统计期间与已有视频报表重叠。请核对起止日期；需要用这份文件替换重叠数据时，可勾选下方“替换重叠区间”。${error.message || ""}` : error.message || "预览失败"); }
  };
  const confirmImport = async () => {
    if (!isAdmin || !workbook || !preview || reading || saving || saveLock.current) return;
    if (preview.contextSignature !== importSignature) { setPreview(null); setImportError("导入条件或工作台数据已变化，请重新预览合并结果。"); return; }
    try {
      const result = mergeSelectedImport(preview.records);
      if (result.summary.duplicateFile) { setPreview(null); setImportedSheet(""); setImportError(""); setNotice({ type: "info", message: "已识别为重复文件和工作表，本次没有再次累计销量。" }); return; }
      const next = result.state; next.mappingPresets = { ...(next.mappingPresets || {}), [importType]: createImportPreset(headers, mapping, headerRow) };
      if (await save(next, importType === "videos" && publicationVideo ? `已更新 ${sheet} 的发布记录与月度推广，达人累计仍由出单报表更新` : importType === "videos" && stageVideo ? `已暂存 ${sheet}，销量将在统计期间确认后计入` : `已导入 ${sheet}（新增 ${result.summary.added || 0}，更新 ${result.summary.updated || 0}）`)) { setImportedSheet(sheet); setPreview(null); setImportError(""); }
    } catch (error: any) { setImportError(error.message); }
  };
  const pendingDraft = (id: string) => pendingDrafts[id] || newPendingDraft();
  const usePendingAsPublication = async (id: string) => {
    if (!isAdmin || saving) return;
    try {
      const result = markPendingVideoAsPublication(state, id, { at: new Date().toISOString() });
      if (await save(result.state, "已设为发布视频报表，用于月度推广，达人累计仍以出单报表为准")) { setPendingReview(null); setPendingError(null); }
    } catch (error: any) { setPendingError({ id, message: error.message || "报表用途更新失败，请重试。" }); }
  };
  const publicationViewsDraft = (report: RecordItem): ViewsPeriodDraft => publicationViewsDrafts[report.id] || {
    month: text(report.viewsPeriodStart).slice(0, 7) === text(report.viewsPeriodEnd).slice(0, 7) ? text(report.viewsPeriodStart).slice(0, 7) : "",
    viewsPeriodStart: text(report.viewsPeriodStart), viewsPeriodEnd: text(report.viewsPeriodEnd),
  };
  const changePublicationViewsDraft = (report: RecordItem, key: keyof ViewsPeriodDraft, value: string) => {
    setPublicationViewsDrafts(drafts => {
      const next = { ...publicationViewsDraft(report), [key]: value };
      if (key === "month") { const range = rangeForMonth(value); next.viewsPeriodStart = range.rangeStart; next.viewsPeriodEnd = range.rangeEnd; }
      else next.month = next.viewsPeriodStart.slice(0, 7) === next.viewsPeriodEnd.slice(0, 7) ? next.viewsPeriodStart.slice(0, 7) : "";
      return { ...drafts, [report.id]: next };
    });
    setPendingError(null);
  };
  const savePublicationViewsPeriod = async (report: RecordItem) => {
    if (!isAdmin || saving) return;
    try {
      const draft = publicationViewsDraft(report);
      if (!validDate(draft.viewsPeriodStart) || !validDate(draft.viewsPeriodEnd) || draft.viewsPeriodStart > draft.viewsPeriodEnd) throw new Error("请填写发布报表的有效统计起止日期，不能用发布日期或文件名推断。");
      const result = confirmVideoReportViewsPeriod(state, report.id, { viewsKind: "period", viewsPeriodStart: draft.viewsPeriodStart, viewsPeriodEnd: draft.viewsPeriodEnd, at: new Date().toISOString() });
      if (!result.summary.updated) { setNotice({ type: "info", message: "发布报表统计期间已经是这个范围，无需重复保存。" }); return; }
      if (await save(result.state, `已确认发布报表统计期间 ${draft.viewsPeriodStart} 至 ${draft.viewsPeriodEnd}，用于月度推广`)) {
        setPendingError(null);
        if (result.summary.warnings?.length) setNotice({ type: "info", message: `发布报表统计期间已保存。${result.summary.warnings.slice(0, 2).join("；")}` });
      }
    } catch (error: any) { setPendingError({ id: report.id, message: error.message || "发布报表统计期间保存失败，请核对后重试。" }); }
  };
  const changePendingDraft = (id: string, key: string, value: any) => {
    setPendingDrafts(drafts => ({ ...drafts, [id]: { ...(drafts[id] || newPendingDraft()), ...(key !== "replaceOverlapping" ? { replaceOverlapping: false } : {}), [key]: value } }));
    if (key !== "replaceOverlapping") setPendingReview(null);
    setPendingError(null);
  };
  const previewPending = (id: string) => {
    if (!isAdmin) return;
    try {
      const draft = pendingDraft(id), result = draft.mode === "historicalBaseline" ? previewHistoricalBaseline(state, id, draft) : previewPendingVideoImport(state, id, draft);
      setPendingDrafts(drafts => ({ ...drafts, [id]: { ...draft, replaceOverlapping: false } }));
      setPendingReview({ ...result, revision, draftSignature: JSON.stringify({ mode: draft.mode, rangeStart: draft.rangeStart, rangeEnd: draft.rangeEnd, cutoffDate: draft.cutoffDate }) }); setPendingError(null);
    } catch (error: any) { setPendingReview(null); setPendingError({ id, message: error.message || "请核对统计起止日期。" }); }
  };
  const activatePending = async (id: string) => {
    if (!isAdmin || !pendingReview || pendingReview.pendingId !== id) return;
    const draft = pendingDraft(id);
    if (pendingReview.revision !== revision || pendingReview.draftSignature !== JSON.stringify({ mode: draft.mode, rangeStart: draft.rangeStart, rangeEnd: draft.rangeEnd, cutoffDate: draft.cutoffDate })) {
      setPendingReview(null); setPendingError({ id, message: "数据或统计周期已变化，请重新预览后确认。" }); return;
    }
    try {
      const result = draft.mode === "historicalBaseline" ? confirmHistoricalBaseline(state, id, draft) : confirmPendingVideoImport(state, id, draft);
      if (await save(result.state, draft.mode === "historicalBaseline" ? `已建立截至 ${draft.cutoffDate} 的历史出单底表` : `已确认视频统计周期 ${draft.rangeStart} 至 ${draft.rangeEnd}`)) { setPendingReview(null); setPendingError(null); }
    } catch (error: any) { setPendingError({ id, message: error.message || "统计周期确认失败，请重新预览。" }); }
  };
  const openSample = (row: RecordItem) => { setEditSample(row); setSampleDraft({ manualRecordId: row.manualRecordId || "", creatorId: row.creatorId || "", orderId: row.orderId || "", skuId: row.skuId || "", sku: row.sku || "", productId: row.productId || "", date: dateText(row.date) === "—" ? "" : dateText(row.date), received: row.received || "", quantity: row.quantity ?? 1, videoLinksText: linksOf(row).join("\n"), notes: row.notes || "" }); };
  const saveSample = async () => {
    if (!isAdmin) return;
    if (!cid(sampleDraft.creatorId) && !text(sampleDraft.orderId).trim()) { setNotice({ type: "error", message: "请填写达人 ID；达人尚待关联时，至少保留订单号。" }); return; }
    if (![sampleDraft.skuId, sampleDraft.sku, sampleDraft.productId].some(v => text(v).trim())) { setNotice({ type: "error", message: "请至少填写 SKU ID、Seller SKU 或产品 PID，便于识别同一样品。" }); return; }
    if (sampleDraft.quantity === "" || !Number.isSafeInteger(Number(sampleDraft.quantity)) || Number(sampleDraft.quantity) < 0) { setNotice({ type: "error", message: "样品数量请填写 0 或正整数。" }); return; }
    const next = clone(state); const fieldsToSave = ["creatorId", "orderId", "skuId", "sku", "productId", "date", "received", "quantity", "videoLinks", "videoIds", "notes"];
    const record: any = { ...sampleDraft, creatorId: cid(sampleDraft.creatorId), orderId: text(sampleDraft.orderId).trim(), skuId: text(sampleDraft.skuId).trim(), sku: text(sampleDraft.sku).trim(), productId: text(sampleDraft.productId).trim(), videoLinks: unique(text(sampleDraft.videoLinksText).split(/\n/).map(s => safeUrl(s.trim())).filter(Boolean)), quantity: Number(sampleDraft.quantity), manualFields: fieldsToSave, _manual: Object.fromEntries(fieldsToSave.map(f => [f, true])), updatedAt: new Date().toISOString() };
    record.videoIds = E.videoIdsFromLinks(record.videoLinks);
    delete record.videoLinksText;
    const invalid = text(sampleDraft.videoLinksText).split(/\n/).filter(s => s.trim() && !safeUrl(s.trim())); if (invalid.length) { setNotice({ type: "error", message: "视频链接中有无效网址，请填写以 https:// 开头的完整链接。" }); return; }
    const existingRows: RecordItem[] = next.samples || [];
    const sameOrderItem = (r: RecordItem) => !!record.orderId && text(r.orderId) === record.orderId && (record.skuId && r.skuId ? record.skuId === text(r.skuId) : record.sku && r.sku ? record.sku === text(r.sku) : !!record.productId && record.productId === text(r.productId));
    const creatingNew = !editSample?.id && !editSample?.orderId && !editSample?.manualRecordId;
    if (creatingNew && (all.samples || []).some(sameOrderItem)) { setNotice({ type: "error", message: "这个订单与样品已有收样记录。请搜索订单号并编辑原记录；本次未新增，也未覆盖原备注和视频链接。" }); return; }
    const existingIndex = existingRows.findIndex((r: RecordItem) => (editSample?.id && r.id === editSample.id) || (editSample?.manualRecordId && r.manualRecordId === editSample.manualRecordId));
    const matchingIndexes = existingRows.map((r, index) => sameOrderItem(r) ? index : -1).filter(index => index >= 0);
    if (matchingIndexes.length > 1 || (existingIndex >= 0 && matchingIndexes.some(index => index !== existingIndex))) { setNotice({ type: "error", message: "这个订单与样品已对应另一条记录。请先核对原记录，避免重复计入合作。" }); return; }
    const idx = existingIndex >= 0 ? existingIndex : matchingIndexes[0] ?? -1;
    if (!record.manualRecordId && idx >= 0) record.manualRecordId = existingRows[idx].manualRecordId || "";
    if (idx >= 0) next.samples[idx] = { ...next.samples[idx], ...record, manualFields: unique([...(next.samples[idx].manualFields || []), ...fieldsToSave]), _manual: { ...next.samples[idx]._manual, ...record._manual } };
    else { const id = editSample?.id || `manual-${crypto.randomUUID()}`; next.samples ||= []; next.samples.push({ ...record, id, manualRecordId: record.manualRecordId || (!record.orderId ? id : ""), source: "手动更新" }); }
    if (await save(next, "收样记录已更新")) setEditSample(null);
  };
  const inspectIssue = (issue: RecordItem) => {
    if (issue.type === "missingPromotionProduct") { go("promotion"); setMonth(issue.month || ""); setSearch(text(issue.sku)); return; }
    const sample = (all.samples || []).find((r: RecordItem) => (issue.id && r.id === issue.id) || (issue.orderId && r.orderId === issue.orderId && (!issue.skuId || r.skuId === issue.skuId)));
    go("samples"); setMonth(""); setSampleFilter("全部记录");
    setSearch(text(issue.orderId || issue.creatorId || issue.skuId || issue.sku || issue.productId || ""));
    if (sample) openSample(sample);
  };
  const openCreator = (row: RecordItem) => { setEditCreator(row); setCreatorWillingnessEdited(false); setCreatorDraft({ creatorId: row.creatorId, willingness: row.willingness || willingnessConfig.defaultValue, notes: row.notes || "", style: row.style || "", tendency: text(row.tendency || row.preferences), selfPurchasedSampleQuantity: row.manualSelfPurchasedSampleQuantity ?? "", selfPurchaseNotes: row.selfPurchaseNotes || "" }); };
  const saveCreator = async () => {
    if (!isAdmin || saving) return;
    const key = cid(creatorDraft.creatorId);
    const selfPurchasedSampleQuantity = blank(creatorDraft.selfPurchasedSampleQuantity) ? null : Number(creatorDraft.selfPurchasedSampleQuantity);
    if (selfPurchasedSampleQuantity !== null && (!Number.isSafeInteger(selfPurchasedSampleQuantity) || selfPurchasedSampleQuantity < 0)) { setNotice({ type: "error", message: "自购样品数量请填写 0 或正整数；留空使用默认规则。" }); return; }
    try {
      const willingness = text(creatorDraft.willingness), previousWillingness = text(editCreator?.willingness);
      if (!willingnessConfig.options.includes(willingness) && willingness !== previousWillingness) throw new Error("请选择规则设置中有效的合作配合意愿。原有历史标签可以继续保留。");
      const updatedAt = new Date().toISOString();
      const changeWillingness = willingnessConfig.options.includes(willingness) && (creatorWillingnessEdited || willingness !== previousWillingness);
      const next = clone(changeWillingness ? updateCreatorWillingness(state, [key], willingness, { at: updatedAt }).state : state);
      const manualFields = ["notes", "style", "tendency", "selfPurchasedSampleQuantity", "selfPurchaseNotes"];
      const patch = { creatorId: key, notes: creatorDraft.notes, style: creatorDraft.style, tendency: creatorDraft.tendency, selfPurchasedSampleQuantity, selfPurchaseNotes: creatorDraft.selfPurchaseNotes, updatedAt };
      const applyPatch = (profile: RecordItem) => ({ ...profile, ...patch, manualFields: unique([...(Array.isArray(profile.manualFields) ? profile.manualFields : []), ...manualFields]), _manual: { ...(profile._manual || {}), ...Object.fromEntries(manualFields.map(field => [field, true])) } });
      let found = false;
      next.creators = (next.creators || []).map((profile: RecordItem) => { if (cid(profile.creatorId) !== key) return profile; found = true; return applyPatch(profile); });
      if (!found) next.creators.push(applyPatch(editCreator?.rosterSource === "salesThreshold" ? { admissionOrigin: "salesThreshold" } : {}));
      if (await save(next, `@${key} 的合作档案已更新`)) setEditCreator(null);
    } catch (error: any) { setNotice({ type: "error", message: error.message || "档案保存失败，请重试。" }); }
  };
  const undo = async () => {
    if (!isAdmin) return;
    if (!window.confirm("恢复到上一次保存前的数据？本次撤回完成后不能再次连续撤回。需要保留当前内容时，请先下载完整备份。")) return;
    setSaving(true);
    try { const res = await fetch("/api/undo", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }) }); if (res.status === 401) { setState(null); onSessionExpired(); return; } const json = await res.json() as RecordItem; if (!res.ok) throw new Error(json.error || "暂时无法撤回"); await load(true); setNotice({ type: "success", message: "已恢复上一次保存前的数据" }); }
    catch (err: any) { setNotice({ type: "error", message: err.message }); } finally { setSaving(false); }
  };
  const backup = () => downloadBlob(`heihei_达人工作台备份_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "spsil-creator-workbench", exportedAt: new Date().toISOString(), revision, state }, null, 2), "application/json");
  const readBackup = async (file?: File) => { if (!isAdmin || !file) return; try { const j = JSON.parse(await file.text()); const s = j.state || j; if (!Array.isArray(s.samples) || !Array.isArray(s.videos) || !Array.isArray(s.productMappings)) throw new Error("这不是工作台导出的完整备份文件。"); setRestoreData(s); } catch (err: any) { setNotice({ type: "error", message: err.message }); } finally { if (restoreInput.current) restoreInput.current.value = ""; } };
  const setRule = (i: number, field: string, val: any) => { const draft = clone(ruleDraft); draft.rules[i][field] = val; setRuleDraft(draft); setRulesDirty(true); };
  const setWillingnessOptions = (options: string[], defaultValue = ruleDraft.defaultWillingness) => { setRuleDraft({ ...ruleDraft, willingnessOptions: options, defaultWillingness: defaultValue }); setRulesDirty(true); };
  const renameWillingnessOption = (index: number, value: string) => { const options = [...ruleDraft.willingnessOptions], oldValue = options[index]; options[index] = value; setWillingnessOptions(options, ruleDraft.defaultWillingness === oldValue ? value : ruleDraft.defaultWillingness); };
  const moveWillingnessOption = (index: number, direction: number) => { const options = [...ruleDraft.willingnessOptions]; [options[index], options[index + direction]] = [options[index + direction], options[index]]; setWillingnessOptions(options); };
  const saveRules = async () => {
    if (!isAdmin || saving || !ruleDraft) return;
    let config;
    try { config = validateWillingnessConfig(ruleDraft); } catch (error: any) { setNotice({ type: "error", message: error.message }); return; }
    const bad = (ruleDraft.rules || []).find((r: any) => r.enabled !== false && (num(r.level) < 1 || num(r.level) > 5 || num(r.minSold) < 0 || (r.maxSold != null && num(r.maxSold) < num(r.minSold)) || num(r.minCollaborations) < 0));
    if (bad) { setNotice({ type: "error", message: "请检查规则：等级应为 1–5，最大单量不能小于最小单量。" }); return; }
    if (ruleDraft.selfPurchaseDefaultQuantity === "" || !Number.isSafeInteger(Number(ruleDraft.selfPurchaseDefaultQuantity ?? 1)) || Number(ruleDraft.selfPurchaseDefaultQuantity ?? 1) < 0) { setNotice({ type: "error", message: "无收样达人默认自购样品数量应为 0 或正整数。" }); return; }
    if (await save({ ...state, settings: { ...clone(ruleDraft), willingnessOptions: config.options, defaultWillingness: config.defaultValue, cooperationBasis: "sampleQuantity", useHistoricalFallback: false } }, "分层、统计与合作配合意愿规则已更新")) setRulesDirty(false);
  };

  return <div className="cw-app">
    {isAdmin && <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv,.tsv" className="visually-hidden" aria-label="选择要导入的表格" onChange={e => receiveFile(e.target.files?.[0])} />}
    {isAdmin && <input ref={restoreInput} type="file" accept=".json" className="visually-hidden" aria-label="选择工作台备份" onChange={e => readBackup(e.target.files?.[0])} />}
    {mobileNav && <button className="nav-scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
      <a href="#" className="brand" onClick={e => { e.preventDefault(); go("overview"); }}><div className="brand-symbol"><span /><span /><span /></div><div><strong>heihei<span className="brand-dot">.</span></strong><small>达人工作台 · CREATOR WORKSPACE</small></div></a>
      <div className="workspace-pill"><span className="flag-spain" /><span>西班牙 · TikTok Shop</span><span className="live-dot" /></div>
      <nav aria-label="工作台总览" style={{ marginTop: 14 }}>{navItems.filter(n => n.id === "overview").map(n => <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => go(n.id)}><n.icon size={19} /><span>{n.title}</span>{n.id === view && <span className="nav-active-dot" />}</button>)}</nav>
      <p className="nav-label">合作管理</p>
      <nav aria-label="合作管理">{navItems.filter(n => ["samples", "promotion", "creators", "commissions"].includes(n.id) && (isAdmin || n.id !== "commissions")).map(n => <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => go(n.id)}><n.icon size={19} /><span>{n.title}</span>{n.id === "samples" && ready && <span className="nav-count">{compact(all.samples?.length)}</span>}{n.id === view && <span className="nav-active-dot" />}</button>)}</nav>
      {isAdmin && <><p className="nav-label data-label">数据与设置</p>
      <nav aria-label="数据设置">{navItems.filter(n => ["imports", "rules", "admin"].includes(n.id)).map(n => <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => go(n.id)}><n.icon size={19} /><span>{n.title}</span>{n.id === view && <span className="nav-active-dot" />}</button>)}</nav></>}
      <div className="sidebar-guide"><div className="guide-icon"><Sparkles size={17} /></div><strong>表格更新，合作持续</strong><p>导入报表合并收样与出单，确认视频链接，持续跟进合作。</p><button onClick={() => setHelp(true)}>查看使用说明 <ArrowRight size={14} /></button></div>
      <div className="sidebar-footer"><div className="owner-avatar">{initials(user.username)}</div><div className="sidebar-account"><strong title={user.username}>{user.username}</strong><span><ShieldCheck size={11} />{isAdmin ? "管理员 · 数据维护" : "普通账号 · 查看与导出"}</span></div>{isAdmin && <button className="icon-button dark" aria-label="打开管理员中心" onClick={() => go("admin")}><Settings2 size={16} /></button>}</div>
    </aside>
    <div className="workspace-main">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="展开菜单" onClick={() => setMobileNav(true)}><Menu size={20} /></button><span>heihei达人工作台</span><ChevronRight size={13} /><strong>{currentNav.title}</strong></div><div className="topbar-actions">{view !== "admin" && <><span className={`sync-status ${saving ? "busy" : ""}`}>{saving ? <Loader2 className="spin" size={13} /> : <Cloud size={14} />}{saving ? "正在保存" : ready ? "已同步" : "正在连接"}</span><button className="icon-button" onClick={() => load(true)} disabled={saving || loading} aria-label="刷新最新数据" title="刷新最新数据"><RefreshCw size={17} className={loading ? "spin" : ""} /></button><span className="topbar-divider" /></>}<span className={`account-role ${isAdmin ? "admin" : "viewer"}`}><ShieldCheck size={12} />{isAdmin ? "管理员" : "普通账号"}</span><button className="logout-button" aria-label="退出登录" onClick={() => void logout()} disabled={loggingOut || saving} title={`退出 ${user.username}`}>{loggingOut ? <Loader2 size={15} className="spin" /> : <LogOut size={15} />}<span>退出登录</span></button></div></header>
      <main className="main-content">
        {notice && <div className={`notice notice-${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>{notice.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}<span>{notice.message}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
        {preparedExport && <div className="download-ready" role="status"><div className="download-ready-icon"><FileSpreadsheet size={23} /></div><div className="download-ready-content"><strong>Excel 已准备好</strong><span>{preparedExport.name}</span><small>共 {preparedExport.sheetCount} 个工作表，点击下载保存到你的设备。</small></div><a className="button primary" href={preparedExport.url} download={preparedExport.name}><Download size={16} />下载 Excel</a><button className="icon-button" aria-label="关闭下载入口" onClick={clearPreparedExport}><X size={16} /></button></div>}
        <div className="page-heading"><div><div className="eyebrow">heihei · CREATOR OPERATIONS</div><h1>{currentNav.title}{view === "overview" && <span className="title-pill">ES</span>}</h1><p>{currentNav.subtitle}</p></div><div className="heading-actions"><button type="button" className="button guide-open-button" onClick={() => setHelp(true)}><BookOpen size={16} />使用说明</button>{!["imports", "rules", "creators", "commissions", "admin"].includes(view) && <label className="month-select"><Clock3 size={15} /><select value={month} onChange={e => setMonth(e.target.value)} aria-label="选择统计月份"><option value="">全部月份</option>{months.map(m => <option value={m} key={m}>{monthText(m)}</option>)}</select></label>}{view === "creators" && <span className="scope-label">累计出单 · 累计 GMV · 累计播放</span>}{isAdmin && !["commissions", "imports", "admin"].includes(view) && <button className="button primary" onClick={openImport} disabled={!ready}><Plus size={17} />导入新数据</button>}{!isAdmin && <button className="button primary" onClick={() => exportTable("all")} disabled={!ready || exporting}>{exporting ? <Loader2 className="spin" size={16} /> : <Download size={16} />}导出完整工作簿</button>}</div></div>
        {!isAdmin && <div className="viewer-notice"><LockKeyhole size={15} /><span>普通账号 · 可查看、筛选和导出数据。数据维护由管理员完成。</span></div>}
        {isAdmin && view === "admin" && <WorkbenchAdmin onSessionExpired={onSessionExpired} />}
        {view !== "admin" && loadError && <div className="error-card"><AlertCircle size={24} /><div><h3>暂时无法加载工作台</h3><p>{loadError}</p></div><button className="button" onClick={() => load()}>重试</button></div>}
        {view !== "admin" && (loading && !state ? <div className="loading-panel"><Loader2 className="spin" size={28} /><h3>正在整理合作数据</h3><p>收样、视频与达人档案即将就绪</p></div> : ready && <>
          {["overview", "promotion"].includes(view) && <div className="metric-scope-note"><Clock3 size={16} aria-hidden="true" /><div><p>{view === "promotion" ? <><strong>月度推广使用发布视频报表</strong>：视频数按 Post date，出单与播放按报表统计期间；旧月份缺项保留历史参考。</> : <><strong>视频数按发布日期归月</strong>；出单与播放按各自已确认期间统计，达人分层累计有效期间。</>}</p>{view === "overview" && selectedSalesRanges.length > 0 && <small><strong>本月已确认的销售期间：</strong>{selectedSalesRanges.join("；")}</small>}{view === "overview" && num(all.stats?.undatedVideoCount) > 0 && <small>另有 {formatNum(all.stats.undatedVideoCount)} 条视频缺少发布日期，保留在“全部月份”，暂不分配到具体月份。</small>}</div><button type="button" className="text-button" onClick={() => setHelp(true)}>计算说明 <ArrowUpRight size={13} /></button></div>}
          {pendingReportCount > 0 && ["overview", "promotion"].includes(view) && <div className="viewer-notice"><Clock3 size={16} /><span>有 {formatNum(pendingReportCount)} 份视频报表的销售期间待确认。视频发布记录与候选链接已保留；销量和播放量分别在实际统计期间确认后计入。</span>{isAdmin && <button className="text-button" onClick={() => go("imports")}>查看待确认报表<ArrowRight size={13} /></button>}</div>}
          {view === "overview" && <div className="metric-scope-note playback-scope-note"><BarChart3 size={17} /><div><strong>{viewsMetricLabel} · 按播放发生期间统计</strong><small>{viewsCoverage || "只统计已导入且播放期间明确的视频；同视频同期间去重，不同且不重叠期间累计。"}</small><small>包含旧视频在当期产生的播放；发布日期只用于发布视频数。达人视频均播放量仍使用倾向表快照。</small>{selected.stats?.historicalViewsReference != null && <small className="playback-reference">历史报表最高播放参考：{compact(selected.stats.historicalViewsReference)} 次。原报表统计期间可能不同，此参考不加入确认累计。</small>}{unconfirmedViewsReportCount > 0 && <small className="playback-pending">还有 {formatNum(unconfirmedViewsReportCount)} 份资料的播放期间待确认。</small>}{num(selected.stats?.viewsOverlapVideoCount) > 0 && <small className="playback-pending">有 {formatNum(selected.stats.viewsOverlapVideoCount)} 个视频的播放期间部分重叠，重叠记录等待核对。</small>}</div>{isAdmin && (unconfirmedViewsReportCount > 0 || num(selected.stats?.viewsOverlapVideoCount) > 0) && <button className="text-button" onClick={() => go("imports")}>核对播放期间<ArrowRight size={13} /></button>}</div>}
          {historicalSalesDisplay && view === "overview" && <div className="historical-sales-note"><Files size={19} aria-hidden="true" /><div><strong>{historicalPublicationDisplay ? `${monthText(month)}发布视频的历史表现` : `${monthText(month)}历史推广表参考`}</strong><p>{historicalPublicationDisplay ? `出单参考来自该月发布视频截至 ${salesDisplayCutoff || "历史底表截止日"} 的历史累计；原资料没有当月出单日期。此参考不会再次叠加到达人累计出单。` : "使用已保存的历史推广表出单数值。已有该月实际视频出单报表时，优先采用明细统计；历史参考不会再次叠加到累计。"}</p></div><Badge tone="amber">历史参考</Badge></div>}
          {month && ["overview", "promotion"].includes(view) && /归档/.test(text(selected.stats?.videoMetricSource)) && <div className="viewer-notice"><FileSpreadsheet size={15} /><span>该月视频数据来自已归档月报，已包含在累计基线中，不会再次叠加到累计出单。</span></div>}
          {isAdmin && view === "commissions" && <CreatorCommissions state={state} data={commissionData} isAdmin={isAdmin} saving={saving} onSave={save} ensureXlsx={ensureXlsx} />}
          {view === "overview" && <>
            {isAdmin && <TargetExpiryNotice data={commissionData} onOpen={() => go("commissions")} />}
            <div className="overview-context"><span><span className="live-dot teal" />{monthText(month)}合作概览</span><small>{updatedAt ? `最近更新 ${new Date(updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "导入报表后自动更新"}</small></div>
            <section className="stat-grid" aria-label="合作统计">
              <Stat title="发样订单" value={formatNum(promotionSampleOrders)} unit="单" icon={Package} detail={`${formatNum(promotionSampleCreators)} 位已关联达人 · ${formatNum(promotionSampleQuantity)} 件样品`} color="teal" />
              <Stat title="合作视频" value={formatNum(uniqueVideos)} unit="条" icon={Table2} detail={`${formatNum(matchedSamples)} 条收样记录已确认视频`} color="blue" />
              <Stat title={historicalSalesDisplay ? "历史出单参考" : "视频带货销量"} value={formatNum(soldTotal)} unit="件" icon={TrendingIcon} detail={`${viewsMetricLabel} ${viewsTotal == null ? "待确认" : compact(viewsTotal) + " 次"}`} color="purple" />
              <Stat title="优秀达人" value={formatNum(excellentCount)} unit="位" icon={Star} detail={`${formatNum(cooperationCreators.length)} 位达人已建立合作记录`} color="amber" />
            </section>
            <div className="dashboard-grid"><section className="card product-card"><div className="card-heading"><div><h2>产品推广表现</h2><p>{!month ? "按产品月份行的出单 / 参考值排序" : promotionSalesMode === "publication-unconfirmed" ? "按发布报表参考出单排序，统计期间待确认" : promotionReferenceDisplay ? "按当前推广来源的参考出单排序" : "按当月发布报表出单排序"}</p></div><button className="text-button" onClick={() => go("promotion")}>查看月报 <ArrowUpRight size={16} /></button></div>{productLeaders.length ? <div className="product-bars">{productLeaders.map((p: RecordItem, i: number) => <div className="product-bar-row" key={p.id || p.productId}><span className="bar-index">0{i + 1}</span><div className="bar-info"><div className="bar-label"><span title={p.productName}>{p.representativeSku || p.sku || p.productName || p.productId}</span><strong>{formatNum(p.itemsSold)}<small>件</small></strong></div><div className="bar-track"><div style={{ width: `${Math.max(3, num(p.itemsSold) / num(productLeaders[0].itemsSold) * 100)}%` }} /></div><small>{p.productName || `PID ${p.productId}`}</small>{isPromotionReference(p.salesDisplayMode) && <small className="sales-basis-note">{promotionSourceLabel(p.salesDisplayMode)}{p.salesDisplayCutoff ? ` · 截至 ${p.salesDisplayCutoff}` : ""}</small>}</div></div>)}</div> : <Empty title={promotionReferenceDisplay ? "已有参考资料中暂无正销量产品" : "等待本月发布报表"} detail={promotionReferenceDisplay ? "已读取保存的参考记录；产品榜只展示出单大于 0 的产品。" : "导入并确认发布视频报表的统计期间后，会显示该月产品推广表现。"} action={isAdmin && !promotionReferenceDisplay ? <button className="button small" onClick={openImport}>导入视频数据</button> : undefined} />}<div className="card-footnote"><Activity size={13} />同一视频、同一统计区间重复导入，只更新一次。</div></section>
            <section className="card followup-card"><div className="card-heading"><div><h2>今天跟进什么</h2><p>让每一份样品得到回应</p></div><div className="soft-icon"><Clock3 size={19} /></div></div><div className="followup-number"><strong>{formatNum(pendingSamples)}</strong><span>条收样记录待跟进</span></div><div className="completion-line"><span>收样视频确认进度</span><strong>{samples.length ? Math.round(matchedSamples / samples.length * 100) : 0}%</strong></div><div className="completion-track"><span style={{ width: `${samples.length ? matchedSamples / samples.length * 100 : 0}%` }} /></div><div className="followup-links"><button onClick={() => { setSampleFilter("待追踪"); go("samples"); }}><span><span className="status-dot amber" />待追踪</span><strong>{formatNum(samples.filter((s: RecordItem) => sampleStatus(s) === "待追踪").length)}<ChevronRight size={14} /></strong></button><button onClick={() => { setSampleFilter("候选待确认"); go("samples"); }}><span><span className="status-dot blue" />候选视频待确认</span><strong>{formatNum(candidateSamples)}<ChevronRight size={14} /></strong></button><button onClick={() => { setSampleFilter("待核对"); go("samples"); }}><span><span className="status-dot blue" />匹配需要核对</span><strong>{formatNum(samples.filter((s: RecordItem) => sampleStatus(s) === "待核对").length)}<ChevronRight size={14} /></strong></button></div><button className="button full" onClick={() => { setSampleFilter("待追踪"); go("samples"); }}>打开收样记录 <ArrowRight size={16} /></button></section></div>
            <div className="dashboard-bottom"><section className="card"><div className="card-heading"><div><h2>值得持续合作的达人</h2><p>按累计带货销量排序</p></div><button className="text-button" onClick={() => go("creators")}>全部达人 <ArrowUpRight size={16} /></button></div><div className="table-scroll"><table className="data-table compact-table"><thead><tr><th>达人</th><th>等级</th><th className="num">合作视频</th><th className="num">带货销量</th><th /></tr></thead><tbody>{rankCreators.map((c: RecordItem) => <tr key={c.creatorId}><td><CreatorIdentity row={c} /></td><td><LevelBadge level={c.level} /></td><td className="num">{formatNum(c.videoCount)}</td><td className="num strong">{formatNum(c.itemsSold)}<span className="muted-unit"> 件</span></td><td><button className="icon-button" aria-label={`查看${c.creatorId}`} onClick={() => openCreator(c)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>{!rankCreators.length && <Empty title="下一位优质达人，从这里发现" detail="导入视频出单数据后，系统会按你设定的规则自动分层。" />}</section><section className="card activity-card"><div className="card-heading"><div><h2>最近数据更新</h2><p>每一次导入都有记录</p></div><Files size={18} className="muted" /></div><div className="activity-list">{[...(state.imports || [])].reverse().slice(0, 4).map((r: RecordItem, i) => <div className="activity-item" key={r.id || i}><div className="activity-icon"><FileSpreadsheet size={15} /></div><div><strong>{r.sheetName || typeNames[r.type] || r.sourceName || "数据导入"}</strong><p>{r.sourceName || r.fileName || "已更新合作记录"}</p><small>{dateText(r.at || r.importedAt || r.date || r.createdAt)} · {formatNum(r.added ?? r.summary?.added ?? r.recordCount ?? r.rows)} 条新增</small></div><CheckCircle2 size={14} className="success-text" /></div>)}</div>{!state.imports?.length && <div className="activity-empty"><Files size={24} /><p>已有数据已就绪<br />后续导入记录会展示在这里</p></div>}{isAdmin && <button className="text-button" onClick={() => go("imports")}>进入导入中心 <ArrowRight size={14} /></button>}</section></div>
            {isAdmin && issues.length > 0 && <div className="info-strip"><AlertCircle size={17} /><span>检测到 {formatNum(issues.length)} 项数据提示，导入中心可查看并核对。</span><button onClick={() => go("imports")}>查看提示 <ArrowRight size={14} /></button></div>}
          </>}

          {view === "samples" && <>
            <div className="mini-stat-row"><MiniStat label="收样记录" value={samples.length} /><MiniStat label="已确认视频" value={matchedSamples} /><MiniStat label="待跟进" value={pendingSamples} /><MiniStat label="发样达人" value={sampleCreators} /></div>
            <div className="metric-scope-note"><Link2 size={17} /><div><strong>收样按订单与样品合并，视频链接由你确认</strong><small>All Orders、收样明细与手工新增支持合并更新。重复订单不增加合作次数；视频报表提供候选，已有确认链接与备注持续保留。</small></div></div>
            <section className="card"><div className="table-toolbar"><div className="segmented">{["全部记录", "待追踪", "候选待确认", "已发视频", "待核对", "已取消"].map(s => <button className={sampleFilter === s ? "selected" : ""} key={s} onClick={() => setSampleFilter(s)}>{s}</button>)}</div><div className="toolbar-actions"><SearchBox value={search} onChange={setSearch} placeholder="搜索达人、SKU、订单或 PID" /><button className="button small" onClick={() => exportTable("samples")} disabled={exporting}><Download size={15} />导出 Excel</button><button className="text-button" onClick={() => exportCSV(`heihei_收样记录_${month || "全部"}.csv`, filteredSamples, sampleCols)}>CSV</button>{isAdmin && <button className="button small primary" onClick={() => { setEditSample({}); setSampleDraft({ creatorId: "", orderId: "", skuId: "", sku: "", productId: "", date: new Date().toISOString().slice(0, 10), quantity: 1, received: "", videoLinksText: "", notes: "" }); }}><Plus size={15} />新增</button>}</div></div><div className="table-scroll"><table className="data-table sample-table"><thead><tr><th>达人 / 收样日期</th><th>样品 / 产品</th><th>订单号</th><th className="num">数量</th><th>视频进度</th><th>视频链接</th><th>备注</th><th /></tr></thead><tbody>{filteredSamples.slice((page - 1) * 12, page * 12).map((s: RecordItem, i: number) => <tr key={s.id || `${s.orderId}-${s.skuId}-${i}`}><td><CreatorIdentity row={s} detail={dateText(s.date)} /></td><td><strong className="cell-title">{s.sku || s.productName || "待补充 SKU"}</strong><small className="cell-sub id-text">PID {s.productId || "待匹配"}</small><small className="cell-sub">{text(s.received) || "收样状态待补充"}</small></td><td><span className="id-text small-text">{s.orderId || "手工记录"}</span></td><td className="num">{formatNum(s.quantity)}</td><td><Badge tone={sampleStatus(s) === "已发视频" ? "green" : ["待核对", "候选待确认"].includes(sampleStatus(s)) ? "blue" : "amber"}><span className="badge-dot" />{sampleStatus(s)}</Badge>{num(s.itemsSold) > 0 && <small className="cell-sub">出单 {formatNum(s.itemsSold)} 件</small>}{num(s.pendingVideoCount) > 0 && <small className="cell-sub">{formatNum(s.pendingVideoCount)} 条视频待确认销量周期</small>}</td><td>{linksOf(s).length ? <div className="link-stack">{linksOf(s).slice(0, 2).map((l, j) => <a key={l} href={l} target="_blank" rel="noreferrer">视频 {j + 1}<ExternalLink size={11} /></a>)}{linksOf(s).length > 2 && <button onClick={() => openSample(s)}>+{linksOf(s).length - 2} 条</button>}</div> : <span className="muted small-text">等待手动追踪</span>}{num(s.candidateVideoCount) > 0 && <button className="candidate-open text-button" onClick={() => openSample(s)}>{formatNum(s.candidateVideoCount)} 条候选待确认<ChevronRight size={12} /></button>}</td><td><span className="cell-note" title={text(s.notes)}>{text(s.notes) || "—"}</span></td><td><button className="row-edit" onClick={() => openSample(s)}>{isAdmin ? "编辑" : "详情"}</button></td></tr>)}</tbody></table></div>{!filteredSamples.length && <Empty title="没有符合条件的收样记录" detail="试试其他月份或筛选条件，也可以导入新的发样订单。" />}<Pagination page={page} setPage={setPage} total={filteredSamples.length} /></section><div className="section-note"><Link2 size={14} />All Orders、收样明细和手工新增合并为同一台账。视频报表只推荐候选链接；手工填写或选入并保存后，才确认属于这次收样。</div>
          </>}

          {view === "promotion" && <>
            <div className="metric-scope-note"><FileSpreadsheet size={17} /><div><strong>汇总模板：推广2026.9</strong><small>2026 年 9 月起，使用当月 All Orders、PID 对照和发布视频报表汇总。2025 年 10 月至 2026 年 8 月的缺项按 PID 补充历史参考。每月独立展示，不跨月累加。</small></div></div>
            <div className="metric-scope-note"><Package size={17} /><div><strong>发样来源：{promotionSampleSource}</strong><small>每月优先使用 All Orders 的有效发样数量；该月无订单来源时使用收样台账或历史推广表，三种来源不会相加。{promotionUnlinkedOrders > 0 ? `当前有 ${formatNum(promotionUnlinkedOrders)} 个发样订单的达人仍待关联，件数照常保留。` : ""}</small></div></div>
            <div className="metric-scope-note playback-scope-note"><BarChart3 size={17} /><div><strong>{promotionSalesSource || "发布视频报表 · 月度推广"}</strong><small>{promotionViewsSource}{promotionViewsCoverage ? `；${promotionViewsCoverage}` : ""}</small>{promotionSalesMode === "publication-unconfirmed" && <small className="playback-pending">当前显示发布报表观察值，实际统计期间尚未确认。请按后台导出条件补充日期，不按 Post date 或文件名推定。</small>}{promotionSalesMode === "publication-cross-month" && <small className="playback-pending">报表统计期间跨越多个月份，当前按视频发布日期显示参考，尚未拆分成精确月报。</small>}{num(selected.stats?.promotionMissingPostDateCount) > 0 && <small>有 {formatNum(selected.stats.promotionMissingPostDateCount)} 个视频仍缺发布日期，未计入发布视频数；报表期间明确时其出单与播放保留。</small>}{promotionReferenceDisplay && !["publication-unconfirmed", "publication-cross-month"].includes(promotionSalesMode) && <small>历史明细按视频发布月份归组，用于补缺；它表示原报表中的历史表现，不能视为精确的当月新增销量或播放。</small>}{!month && <small>这里合计各月推广显示值，包含标注的历史参考；不是达人累计。切换单月可查看该月来源。</small>}</div>{isAdmin && (promotionSalesMode === "publication-unconfirmed" || promotionSalesMode === "unavailable") && <button className="text-button" onClick={openPublicationPeriods}>确认发布报表期间<ArrowRight size={13} /></button>}</div>
            <div className="mini-stat-row"><MiniStat label="推广产品 PID" value={promotions.length} /><MiniStat label="发样件数" value={promotions.reduce((n: number, p: RecordItem) => n + num(p.sampleQuantity), 0)} /><MiniStat label={promotionSalesLabel} value={promotionSoldTotal} missingLabel="待提供" /><MiniStat label={promotionViewsLabel} value={promotionViewsTotal} missingLabel="待确认" /></div>
            <section className="card"><div className="table-toolbar"><div className="segmented"><button className={promoMode === "calculated" ? "selected" : ""} onClick={() => setPromoMode("calculated")}>自动统计</button><button className={promoMode === "historical" ? "selected" : ""} onClick={() => setPromoMode("historical")}>对照历史填报</button></div><div className="toolbar-actions"><SearchBox value={search} onChange={setSearch} placeholder="搜索 PID、SKU 或产品" /><button className="button small" onClick={() => exportTable("promotion")} disabled={exporting}><Download size={15} />导出推广表</button><button className="text-button" onClick={() => exportCSV(`heihei_推广${month || "全部月份"}.csv`, promotionExportRows(promotions), promotionCols)}>CSV</button></div></div><div className="promotion-sort-note" aria-live="polite"><ArrowUpDown size={14} aria-hidden="true" /><span>点击表头切换排序 · 当前：<strong>{promotionSortLabel} · {promotionSort.direction === "desc" ? "从高到低" : "从低到高"}</strong></span></div><div className="table-scroll"><table className="data-table promotion-table"><thead><tr><th>产品 / PID</th><th>代表 SKU</th>{promotionSortColumns.map(({ key, label }) => {
                const active = promotionSort.key === key;
                const displayLabel = key === "itemsSold" && promotionReferenceDisplay ? "出单参考" : key === "sellingVideoCount" && promotionReferenceDisplay ? "参考出单视频数" : label;
                const nextDirection = active && promotionSort.direction === "desc" ? "从低到高" : "从高到低";
                return <th key={key} className="num" aria-sort={active ? promotionSort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className={`promotion-sort-button${active ? " active" : ""}`} onClick={() => changePromotionSort(key)} aria-label={`按${displayLabel}${nextDirection}排序`} title={`${key === "videoCount" ? "按 Video Analysis 发布日期统计；" : ""}点击按${displayLabel}${nextDirection}排序`}><span>{displayLabel}</span>{active ? promotionSort.direction === "desc" ? <ArrowDown size={13} aria-hidden="true" /> : <ArrowUp size={13} aria-hidden="true" /> : <ArrowUpDown size={13} aria-hidden="true" />}</button></th>;
              })}<th className="num" title="9 月起采用发布视频报表的统计期间；旧月份缺项补充历史播放参考，来源逐行标明">{promotionViewsLabel}</th>{promoMode === "historical" && <><th className="num">历史发样</th><th className="num">历史出单</th></>}<th>主要出单 / 爆款视频链接</th><th>出单达人</th></tr></thead><tbody>{promotions.slice((page - 1) * 12, page * 12).map((p: RecordItem, i: number) => <tr key={`${p.month}-${p.productId}-${i}`}><td><strong className="cell-title product-name" title={p.productName}>{p.productName || p.sku || "待补充产品名称"}</strong><small className="cell-sub id-text">{p.productId || "PID 待补充"}</small>{!month && <small className="cell-sub">{p.month}</small>}</td><td><select className="inline-select" aria-label={`${p.productId}代表SKU`} value={p.representativeSku || p.sku || ""} disabled={saving || !isAdmin} onChange={e => save({ ...state, settings: { ...state.settings, representativeSkus: { ...(state.settings?.representativeSkus || {}), [p.productId]: e.target.value } } }, "产品代表 SKU 已更新")}>{unique([p.representativeSku || p.sku || "", ...(state.productMappings || []).filter((m: RecordItem) => text(m.productId) === text(p.productId)).map((m: RecordItem) => m.sku || m.skuName || m.skuId)]).map(s => <option value={text(s)} key={text(s)}>{text(s)}</option>)}{!p.representativeSku && !p.sku && <option value="">待补充</option>}</select></td><td className="num">{formatNum(p.sampleOrders)}</td><td className="num" title={text(p.sampleMetricSource)}>{formatNum(p.sampleQuantity)}{p.sampleSourceMode === "historical-promotion" && <small className="cell-sub sales-basis-note">历史参考</small>}</td><td className="num">{formatNum(p.creatorCount)}{num(p.unlinkedSampleOrders) > 0 && <small className="cell-sub" title="这些发样订单计入数量，但达人身份尚未核实">{formatNum(p.unlinkedSampleOrders)} 单待关联</small>}</td><td className="num">{formatNum(p.videoCount)}</td><td className="num" title={text(p.sellingVideoSource || p.videoMetricSource)}>{p.sellingVideoCount == null ? "—" : formatNum(p.sellingVideoCount)}{p.sellingVideoCount != null && promotionSourceLabel(p.sellingVideoSourceMode || p.salesDisplayMode) && <small className="cell-sub sales-basis-note">{promotionSourceLabel(p.sellingVideoSourceMode || p.salesDisplayMode)}</small>}</td><td className="num" title={text(p.videoMetricSource)}><strong className="success-text">{p.salesAvailable === false || p.itemsSold == null ? "—" : formatNum(p.itemsSold)}</strong><small className="cell-sub sales-basis-note">{promotionSourceLabel(p.salesDisplayMode)}</small></td><td className="num" title={`${text(p.viewsSource)} ${text(p.viewsCoverage)}`}><strong>{p.viewsDisplayMode === "unavailable" ? "—" : periodViews(p.views, p.viewsAvailable !== false)}</strong><small className="cell-sub sales-basis-note">{promotionSourceLabel(p.viewsDisplayMode) || (p.viewsCoverageStatus === "needs_review" ? "播放期间待核对" : p.views == null ? "统计期待确认" : p.viewsCoverageStatus !== "complete" ? "已导入范围" : "")}</small></td>{promoMode === "historical" && <><td className="num muted">{blank(p.historicalSampleQuantity) ? "—" : formatNum(p.historicalSampleQuantity)}</td><td className="num muted">{blank(p.historicalItemsSold) ? "—" : formatNum(p.historicalItemsSold)}</td></>}<td className="primary-sales-cell"><PrimarySalesVideoLinks row={p} /></td><td><PromotionSellingCreators value={p.sellingCreators} /></td></tr>)}</tbody></table></div>{!promotions.length && <Empty title="这个月份还没有推广记录" detail="导入当月订单、PID 对照表与发布视频报表后，系统会按 PID 汇总。" action={isAdmin ? <button className="button primary" onClick={openImport}>导入月度报表</button> : undefined} />}<Pagination page={page} setPage={setPage} total={promotions.length} /></section><div className="section-note"><FileSpreadsheet size={14} />同月同一 PID 汇总一行：发布月报按该 PID 的 Items sold 求和，正销量视频 ID 去重计数。旧月份逐项补齐历史明细，已有明确值（含 0）继续保留。主要链接按其明细来源排序；爆款门槛为 {formatNum(state.settings?.viralMinSold ?? 5)} 件。历史及待确认参考不再加入达人累计。</div>
          </>}

          {view === "creators" && <>
            <div className="creator-data-note"><div><Users size={16} /><span>收样与已有档案持续保留；无收样、累计出单超过 {formatNum(state.settings?.videoOnlyCreatorMinSold ?? 10)} 件的达人自动纳入。</span></div><div><Package size={16} /><span>1 件样品 = 1 次合作；无收样的出单达标达人先按自购 {formatNum(state.settings?.selfPurchaseDefaultQuantity ?? 1)} 件计，可在档案修改。</span></div></div>
            <div className="tier-cards">{[5, 4, 3, 2, 1].map(l => <button className={creatorLevel === String(l) ? "selected" : ""} key={l} onClick={() => setCreatorLevel(creatorLevel === String(l) ? "all" : String(l))}><LevelBadge level={l} /><strong>{formatNum((all.creators || []).filter((c: RecordItem) => num(c.level) === l).length)}</strong><span>{l === 5 ? "优秀达人" : l === 4 ? "可合作达人" : l === 3 ? "潜力合作" : l === 2 ? "持续观察" : "基础达人"}</span></button>)}</div>
            <section className="card"><div className="table-toolbar"><div className="toolbar-actions"><SearchBox value={search} onChange={setSearch} placeholder="搜索达人 ID、风格或备注" /><select className="filter-select" aria-label="筛选达人等级" value={creatorLevel} onChange={e => setCreatorLevel(e.target.value)}><option value="all">全部等级</option>{[5, 4, 3, 2, 1].map(l => <option value={l} key={l}>等级 {l}</option>)}</select><select className="filter-select" aria-label="筛选合作配合意愿" value={creatorWillingness} onChange={e => setCreatorWillingness(e.target.value)}><option value="">全部合作配合意愿</option>{willingnessFilterOptions.map(w => <option key={w} value={w}>{w}{!willingnessConfig.options.includes(w) ? "（历史值）" : ""}</option>)}</select></div><div className="toolbar-actions"><select className="filter-select" aria-label="达人排序" value={sort} onChange={e => setSort(e.target.value)}><option value="lifetimeItemsSold">按累计出单排序</option><option value="lifetimeGmv">累计GMV从高到低</option><option value="lifetimeGmvAsc">累计GMV从低到高</option><option value="cumulativeVideoViews">按累计播放量排序</option><option value="views">按视频均播放量排序</option><option value="cooperationCount">按合作次数排序</option><option value="videoCount">按视频数排序</option><option value="level">按等级排序</option></select><button className="button small" onClick={() => exportTable("creators")} disabled={exporting}><Download size={15} />导出 Excel</button><button className="text-button" onClick={() => exportCSV("heihei_达人分层管理.csv", creatorExportRows(creators), creatorCols)}>CSV</button></div></div>
              {isAdmin && <div className={`creator-bulk-bar ${selectedCreatorCount ? "has-selection" : ""}`} aria-label="批量修改合作配合意愿">
                <div className="creator-selection-summary"><strong>已选 {formatNum(selectedCreatorCount)} 位达人</strong><span>当前页 {formatNum(selectedOnPage)} / {formatNum(creatorPageIds.length)} 位 · 翻页可继续勾选</span></div>
                <div className="creator-selection-actions"><button className="text-button" disabled={saving || !creators.length} onClick={() => setSelectedCreatorIds(new Set(filteredCreatorIds))}>选中全部筛选结果（{formatNum(creators.length)}）</button><button className="text-button" disabled={saving || !selectedCreatorCount} onClick={() => setSelectedCreatorIds(new Set())}>清空选择</button></div>
                <div className="creator-bulk-controls"><label htmlFor="bulk-willingness">合作配合意愿</label><select id="bulk-willingness" className="filter-select" value={bulkWillingness} onChange={e => setBulkWillingness(e.target.value)} disabled={saving || !selectedCreatorCount}><option value="">请选择要设置的意愿</option>{willingnessConfig.options.map((option: string) => <option key={option} value={option}>{option}</option>)}</select><button className="button primary small" onClick={saveBulkWillingness} disabled={saving || !selectedCreatorCount || !willingnessConfig.options.includes(bulkWillingness)}>{saving ? <Loader2 className="spin" size={14} /> : <Check size={14} />}批量应用</button></div>
                <p className="creator-bulk-preview" aria-live="polite">{selectedCreatorCount && bulkWillingness ? <>将把 <strong>{formatNum(selectedCreatorCount)} 位</strong>已选达人的合作配合意愿统一设为 <strong>「{bulkWillingness}」</strong>。</> : "勾选需要修改的达人，再选择合作配合意愿。更换搜索或筛选条件会清空勾选。"}</p>
              </div>}
              <div className="table-scroll"><table className="data-table creator-table"><thead><tr>{isAdmin && <th className="creator-select-cell"><input type="checkbox" className="creator-checkbox" aria-label={`选择当前页全部 ${creatorPageIds.length} 位达人`} aria-checked={selectedOnPage > 0 && !allPageSelected ? "mixed" : allPageSelected} checked={allPageSelected} ref={input => { if (input) input.indeterminate = selectedOnPage > 0 && !allPageSelected; }} onChange={e => toggleCreatorPage(e.target.checked)} disabled={saving || !creatorPageIds.length} /></th>}<th>达人</th><th>等级</th><th className="num">累计出单</th><th className="num" title="已确认历史底表加后续实际销售期间的 GMV；缺失值不按 0 补齐">累计出单金额（GMV）</th><th>主要出单样品 / 产品</th><th className="num" title="历史播放底数加截止日之后已确认、不重叠期间的播放；缺失或冲突的数据单独提示">累计播放量</th><th className="num">达人视频均播放量</th><th>各商品佣金</th><th className="num">合作次数</th><th>带货倾向 / 风格</th><th>合作配合意愿</th><th>备注</th><th /></tr></thead><tbody>{creatorPageRows.map((c: RecordItem) => <tr key={c.creatorId} className={isAdmin && selectedCreatorIds.has(cid(c.creatorId)) ? "creator-selected-row" : ""}>{isAdmin && <td className="creator-select-cell"><input type="checkbox" className="creator-checkbox" aria-label={`选择达人 @${c.creatorId}`} checked={selectedCreatorIds.has(cid(c.creatorId))} onChange={e => toggleCreatorSelection(c.creatorId, e.target.checked)} disabled={saving} /></td>}<td><CreatorIdentity row={c} detail={c.rosterSource === "salesThreshold" ? "出单达标纳入 · 暂无收样记录" : c.rosterSource === "historicalProfile" ? "已有达人档案 · 收样待补充" : `${formatNum(c.videoCount)} 条视频 · ${formatNum(c.sampleQuantity)} 件样品`} /></td><td title={text(c.gradeReason)}><LevelBadge level={c.level} /></td><td className="num strong">{formatNum(c.lifetimeItemsSold)}</td><td className="num cm-gmv-cell" title={text(c.gmvSource)}><strong>{gmvAmount(c.lifetimeGmv, c.gmvAvailable !== false)}</strong>{c.gmvCoverageStatus === "partial" && <small className="cell-sub cm-gmv-partial">部分记录缺GMV</small>}</td><td className="contribution-cell">{c.topProduct ? <><strong className="cell-title" title={text(c.topProduct.productName || c.topProduct.productId)}>{c.topProduct.representativeSku || c.topProduct.productName || c.topProduct.productId || "产品待识别"}</strong><small className="cell-sub">{formatNum(c.topProduct.itemsSold)} 件 · 占 {salesShare(c.topProduct.salesShare)}</small><small className={`cell-sub ${c.topProduct.sampleLinked ? "success-text" : "muted"}`}>{c.topProduct.sampleLinked ? num(c.topProduct.goodVideoCount) > 0 ? `${formatNum(c.topProduct.goodVideoCount)} 条样品视频表现好` : "已匹配收样产品" : "待关联收样产品"}</small></> : <span className="muted">暂无已确认出单</span>}</td><td className="num" title={`${text(c.cumulativeVideoViewsSource)} ${text(c.cumulativeVideoViewsCoverage)}`}>{periodViews(creatorPlaybackNumber(c.cumulativeVideoViews), c.cumulativeVideoViewsAvailable !== false)}<small className="cell-sub">{creatorPlaybackSourceLabel(c)}</small>{creatorPlaybackIssueLabel(c) && <small className="cell-sub creator-playback-warning">{creatorPlaybackIssueLabel(c)}</small>}</td><td className="num" title={text(c.viewsSource)}>{snapshotViews(c.views)}{c.views != null && <small className="cell-sub">{c.viewsAsOf ? dateText(c.viewsAsOf) : "均播放量快照"}</small>}</td><td><button type="button" className="cm-profile-link" onClick={() => openCreator(c)}>{num(commissionData.byCreator?.[cid(c.creatorId)]?.productCount) ? `${formatNum(commissionData.byCreator[cid(c.creatorId)].productCount)} 个 PID` : "暂无记录"}<small>标准 / Shop Ads</small></button></td><td className="num">{formatNum(c.cooperationCount ?? c.collaborationCount)}<small className="cell-sub cooperation-source" title={text(c.cooperationSource)}>{text(c.cooperationSource) || "按样品件数"}</small></td><td><span className="cell-note" title={text(c.tendency)}>{text(c.tendency) || "待补充带货倾向"}</span><small className="cell-sub cell-note">{text(c.style) || "风格待观察"}</small></td><td><Badge tone={willingnessTone(text(c.willingness))}>{text(c.willingness) || willingnessConfig.defaultValue}</Badge>{!willingnessConfig.options.includes(text(c.willingness)) && <small className="cell-sub willingness-legacy">历史值</small>}</td><td><span className="cell-note" title={text(c.notes)}>{text(c.notes) || "—"}</span></td><td><button className="row-edit" onClick={() => openCreator(c)}>{isAdmin ? "管理" : "查看"}</button></td></tr>)}</tbody></table></div>{!creators.length && <Empty title="没有符合条件的达人" detail="调整等级、合作意愿或关键词筛选试试。" />}<Pagination page={page} setPage={setPage} total={creators.length} />
            </section><div className="section-note"><Star size={14} />累计出单和 GMV 沿用已确认历史底表，并叠加后续出单报表的实际销售期间；累计播放量取出单报表中已确认且不重叠的期间。达人视频均播放量取最新西班牙达人带货倾向表，不累加；未提供时留空。样品视频累计出单超过 {formatNum(state.settings?.successfulSampleMinSold ?? 10)} 件时标记为表现好。</div>
          </>}

          {isAdmin && view === "imports" && <>
            <section className="cm-import-entry"><div><strong>联盟订单佣金与 Target 安排</strong><p>联盟订单只更新 Standard / Shop Ads 佣金观察。Target 模板和到期提醒在专门页面维护。</p></div><button type="button" className="button" onClick={() => go("commissions")}>打开佣金与到期</button></section>
            {(state.videoBaselines || []).map((baseline: RecordItem) => <HistoricalBaselineCard key={baseline.id} baseline={baseline} />)}
            {(state.pendingVideoImports || []).filter((r: RecordItem) => r.status === "period_unconfirmed").map((report: RecordItem) => <PendingVideoCard key={report.id} report={report} draft={pendingDraft(report.id)} review={pendingReview?.pendingId === report.id ? pendingReview : null} error={pendingError && pendingError.id === report.id ? pendingError.message : ""} saving={saving} onDraftChange={(key: string, value: any) => changePendingDraft(report.id, key, value)} onPreview={() => previewPending(report.id)} onConfirm={() => activatePending(report.id)} onUsePublication={() => usePendingAsPublication(report.id)} />)}
            {publicationReports.length > 0 && <section className="card publication-views-card" id="publication-reports"><div className="card-heading"><div><h2>发布视频报表的月度推广统计期间</h2><p>已有文件可在这里确认统计月份，无需重传。发布表的出单、播放与视频明细用于月度推广，不再加入达人累计。</p></div><Badge>{formatNum(publicationReports.length)} 份</Badge></div><div className="publication-views-list">{publicationReports.map((report: RecordItem) => {
              const draft = publicationViewsDraft(report), confirmed = report.viewsKind === "period" && validDate(report.viewsPeriodStart) && validDate(report.viewsPeriodEnd);
              return <article className="publication-views-report" key={report.id}><div className="publication-views-report-heading"><div><strong>{report.fileName || report.sourceName || "发布视频报表"}</strong><small>{report.sheetName || "视频数据"} · {formatNum(report.records?.length)} 条记录</small></div><Badge tone={confirmed ? "green" : "amber"}>{confirmed ? "统计期间已确认" : "统计期间待确认"}</Badge></div><div className="publication-views-fields"><Field label="发布报表统计月份"><input type="month" value={draft.month} onChange={e => changePublicationViewsDraft(report, "month", e.target.value)} disabled={saving} /><small className="field-example">选择月份会填写完整月；也可单独填写起止日期。</small></Field><Field label="统计开始日期"><input type="date" value={draft.viewsPeriodStart} onChange={e => changePublicationViewsDraft(report, "viewsPeriodStart", e.target.value)} disabled={saving} /></Field><Field label="统计结束日期"><input type="date" value={draft.viewsPeriodEnd} onChange={e => changePublicationViewsDraft(report, "viewsPeriodEnd", e.target.value)} disabled={saving} /><small className="field-example">按后台导出时的统计区间填写，不使用视频发布日期。</small></Field></div>{pendingError && pendingError.id === report.id && <p className="publication-views-error" role="alert"><AlertCircle size={15} />{pendingError.message}</p>}<div className="publication-views-actions"><span>按后台导出的实际统计期间确认；发布表更新月度推广，出单表负责达人累计，两份表不相加。</span><button className="button small primary" onClick={() => savePublicationViewsPeriod(report)} disabled={saving || !validDate(draft.viewsPeriodStart) || !validDate(draft.viewsPeriodEnd) || draft.viewsPeriodStart > draft.viewsPeriodEnd}>{saving ? <Loader2 className="spin" size={15} /> : <Check size={15} />}保存统计期间</button></div></article>;
            })}</div></section>}
            <div className="import-workflow"><div><span>01</span><strong>选择文件</strong></div><ArrowRight size={15} /><div><span>02</span><strong>确认工作表与列</strong></div><ArrowRight size={15} /><div><span>03</span><strong>预览并合并</strong></div><div className="workflow-note"><ShieldCheck size={15} />保留历史 · 自动去重</div></div>
            <section className={`upload-zone ${reading ? "reading" : ""}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); receiveFile(e.dataTransfer.files[0]); }}>
              <div className="upload-zone-icon">{reading ? <Loader2 className="spin" size={25} /> : <Upload size={25} />}</div>
              <div><h2>{reading ? "正在读取工作表…" : fileName || "把报表拖到这里，开始更新"}</h2><p>{reading ? "读取中也可清除，稍后重新选择文件" : workbook ? `${workbook.SheetNames?.length || 0} 个工作表 · 可逐个选择并导入` : fileName ? "文件尚未读取成功，可更换或清除" : "支持 XLSX、XLS、CSV、TSV · 订单、收样、PID、视频与达人表"}</p></div>
              <div className="upload-file-actions">
                {(fileName || workbook || reading || preview || importError) && <button type="button" className="button" onClick={clearCurrentFile} disabled={saving}><X size={16} />清除本次文件</button>}
                <button type="button" className="button primary" onClick={() => fileInput.current?.click()} disabled={reading || saving}>{fileName ? "更换文件" : "选择文件"}</button>
              </div>
            </section>
            <p className="upload-file-help">选择文件和预览尚未保存；确认合并后才会更新工作台。清除本次文件只清空当前选择与预览，已保存记录保留。</p>
            {workbook && duplicateVideoSource && <div className="notice notice-info"><ShieldCheck size={18} /><span>「{sheet}」已在工作台处理过。已识别相同文件，重复上传不会再次累计；可直接查看重复识别结果。</span></div>}
            {importError && <div className="notice notice-error" role="alert"><AlertCircle size={18} /><span>{importError}</span></div>}
            {importedSheet && <div className="notice notice-success"><CheckCircle2 size={18} /><span>「{importedSheet}」已合并到工作台。可以继续选择本文件的其他工作表。</span></div>}
            {workbook && <section className="card import-settings"><div className="card-heading"><div><h2>确认导入内容</h2><p>列名或位置变化时，在这里选择对应字段。</p></div><Badge tone="blue">{formatNum(Math.max(0, sheetRows.length - headerRow))} 行待识别</Badge></div><div className="form-grid import-options"><Field label="数据类型"><select value={importType} onChange={e => changeType(e.target.value)}>{Object.entries(typeNames).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></Field><Field label="工作表"><select value={sheet} onChange={e => selectSheet(workbook, e.target.value)}>{workbook.SheetNames.map((s: string) => <option value={s} key={s}>{s}</option>)}</select></Field><Field label="表头所在行"><input type="number" min="1" max={sheetRows.length || 1} value={headerRow} onChange={e => changeHeader(Math.max(1, num(e.target.value)))} /></Field>{importType === "videos" && <Field label="视频报表用途"><select value={videoImportMode} onChange={e => setVideoImportMode(e.target.value as "sales" | "publication" | "pending")}><option value="sales">出单视频报表 · 更新达人累计</option><option value="publication">发布视频报表 · 更新月度推广</option><option value="pending">用途或销售期间未确定 · 先暂存</option></select></Field>}<Field label={importType === "videos" ? publicationVideo ? "发布报表的统计月份" : "默认统计月份（未填日期列时）" : "所属月份"}><input type="month" disabled={importType === "videos" && stageVideo} value={importMonth} onChange={e => { setImportMonth(e.target.value); const r = rangeForMonth(e.target.value); setRangeStart(r.rangeStart); setRangeEnd(r.rangeEnd); if (/^\d{4}-\d{2}$/.test(e.target.value)) setReportYear(e.target.value.slice(0, 4)); setPreview(null); }} /></Field>{importType === "videos" && <>{!publicationVideo && <Field label="月份简写所属年份"><input type="number" min="1000" max="9999" step="1" value={reportYear} onChange={e => { setReportYear(e.target.value); setPreview(null); }} placeholder="例如 2026" /><small className="field-example">出单日期只填“10月”时使用这个年份。</small></Field>}<Field label={publicationVideo ? "发布报表统计开始日期" : hasMappedVideoPeriod ? "备用统计开始日期" : "统计开始日期"}><input type="date" disabled={stageVideo} value={rangeStart} onChange={e => { setRangeStart(e.target.value); setPreview(null); }} /></Field><Field label={publicationVideo ? "发布报表统计结束日期" : hasMappedVideoPeriod ? "备用统计结束日期" : "统计结束日期"}><input type="date" disabled={stageVideo} value={rangeEnd} onChange={e => { setRangeEnd(e.target.value); setPreview(null); }} /></Field></>}<Field label="日期文本格式"><select value={dateFormat} onChange={e => { setDateFormat(e.target.value); setPreview(null); }}><option value="auto">自动识别（推荐）</option><option value="dmy">日 / 月 / 年</option><option value="mdy">月 / 日 / 年</option><option value="ymd">年 / 月 / 日</option></select></Field></div>{importType === "videos" && !stageVideo && <details className="playback-import-options"><summary>播放量设置 · {videoViewsKind === "period" ? publicationVideo ? "使用上方发布报表统计期间" : separateViewsPeriod ? "已选择独立播放期间" : "与销售统计期间相同" : videoViewsKind === "unconfirmed" ? "统计期间待确认" : "总播放快照，仅作参考"}</summary><div className="playback-import-options-body"><Field label="播放量口径"><select value={videoViewsKind} onChange={e => setVideoViewsKind(e.target.value as ViewsKind)}><option value="period">所选统计期间内的播放量</option><option value="unconfirmed">播放统计期间待确认</option><option value="lifetime_snapshot">发布以来的总播放快照（仅参考）</option></select><small className="field-example">发布表使用所选期间生成月度推广；出单表按期间计入达人累计。期间不明确时先保留参考。</small></Field>{!publicationVideo && videoViewsKind === "period" && <><label className="checkbox-line"><input type="checkbox" checked={separateViewsPeriod} onChange={e => { setSeparateViewsPeriod(e.target.checked); if (e.target.checked && !viewsRangeStart && !viewsRangeEnd) { setViewsRangeStart(rangeStart); setViewsRangeEnd(rangeEnd); } }} /><span>这份报表的播放统计期间与销售期间不同</span></label>{separateViewsPeriod && <div className="publication-views-fields"><Field label="播放统计开始日期"><input type="date" value={viewsRangeStart} onChange={e => setViewsRangeStart(e.target.value)} /></Field><Field label="播放统计结束日期"><input type="date" value={viewsRangeEnd} onChange={e => setViewsRangeEnd(e.target.value)} /></Field></div>}</>}</div></details>}{importType === "videos" && <div className="sales-period-guidance"><Clock3 size={16} /><div><strong>{publicationVideo ? "选择月份即可填写整月发布报表统计范围" : "出单日期可以填写“10月”或“2026-10”"}</strong><p>{publicationVideo ? "发布表汇总该月发布视频在所选期间的出单和播放。请确认上方统计月份或起止日期与后台导出条件一致；Post date 用于识别发布月份，不能代替统计期间。" : <>只填月份时，按上方所选年份 {reportYear || "（待填写）"} 识别。映射的出单日期、统计月份或起止日期列优先于默认月份；播放量默认采用同一统计期间。Post date 只决定视频发布月份，并辅助推荐收样候选链接。</>}</p></div></div>}{importType === "videos" && <div className="sales-period-guidance"><FileSpreadsheet size={16} /><div><strong>每月两份表，各自负责一个用途</strong><p>发布视频表：按所选月份更新月度推广的视频、出单与播放。出单视频表：按实际销售期间更新达人累计出单、GMV 和播放，可以包含旧视频。2026 年 9 月起的月度推广采用发布报表，两份表不相加。</p>{publicationVideo && <p>这份发布表中的 Items sold 用于月度推广；如果统计期间还没确认，会明确显示为发布报表参考，不计入达人累计。</p>}</div></div>}{importType === "videos" && stageVideo && <div className="sales-period-guidance"><ShieldCheck size={16} /><div><strong>暂存只更新视频事实，暂不增加销量</strong><p>发布日期与候选链接可先使用，原始播放值保留为待确认资料。确认播放期间后才计入累计播放；Items sold 在确认销售期间后计入累计和分层。上方默认日期不会用于这次暂存。</p></div></div>}{["samples", "promotions", "orders"].includes(importType) && <div className="sales-period-guidance"><Package size={16} /><div><strong>{importType === "promotions" ? "按 PID 汇总的推广表，用于月度参考" : "有达人、订单与样品明细，合并更新收样台账"}</strong><p>手填表有个人收样明细时，选择“收样记录表”；只有每月各 PID 数量时，选择“历史月度推广表”。同一订单与样品只保留一次，手工记录导出后请保留“手工记录ID”列。</p></div></div>}{importType === "orders" && <div className="sales-period-guidance"><Users size={16} /><div><strong>Buyer Username 就是达人 ID</strong><p>默认用这列关联收样、统计发样达人和更新合作次数；Creator Handle 的归因信息单独保留。账号与已有手工收样不一致时提示核对，同一订单与样品不会重复增加合作。</p></div></div>}{importType === "orders" && <label className="checkbox-line import-check"><input type="checkbox" checked={sampleSource} onChange={e => { setSampleSource(e.target.checked); setPreview(null); }} /><span>这是已筛选的发样订单表<span className="subtext">这是来源说明；完整 All orders 请保持未勾选。空类型是否计入发样由规则设置决定。</span></span></label>}<label className="checkbox-line import-check"><input type="checkbox" checked={overwriteManual} onChange={e => { setOverwriteManual(e.target.checked); setPreview(null); }} /><span>用本文件中非空内容更新已手工填写的字段<span className="subtext">默认保留页面里手动填写的备注与档案；确认以新收样表为准时再勾选。</span></span></label>{importType === "videos" && !videoFactsOnly && <label className="checkbox-line import-check"><input type="checkbox" checked={replacePeriod} onChange={e => { setReplacePeriod(e.target.checked); setPreview(null); }} /><span>这是完整出单报表，更新同一销售期间<span className="subtext">默认开启。同一销售期间使用最新完整报表，不再多算一次；只含部分出单视频时取消勾选。发布视频表请使用上方“发布视频报表”用途。</span></span></label>}{importType === "videos" && !videoFactsOnly && <label className="checkbox-line import-check"><input type="checkbox" checked={replaceOverlapping} onChange={e => { setReplaceOverlapping(e.target.checked); setPreview(null); }} /><span>用本文件替换重叠的统计区间<span className="subtext">例如 10月1–31日完整报表覆盖之前的1–28日时，替换旧范围。两段有重叠的销量不能直接相加；仅部分覆盖会提示核对。</span></span></label>}<div className="mapping-heading"><h3>字段对应关系</h3><button className="text-button" onClick={() => restoreMapping(headers, importType, false)}><RefreshCw size={13} />重新自动识别</button></div>{mappingInfo && <div className={`mapping-summary ${missingPresetFields.length || ambiguousPresetFields.length ? "needs-review" : ""}`}><div><CheckCircle2 size={16} /><strong>{mappingInfo.hasPreset ? `已按列名复用上次选择：${mappingInfo.applied.length} 个字段` : "已根据当前表头自动识别字段"}{mappingInfo.manual ? " · 已手动调整" : ""}</strong></div>{mappingInfo.hasPreset && mappingInfo.unmapped.length > 0 && <p>{mappingInfo.unmapped.length} 个字段保持上次的“不导入”选择。</p>}{missingPresetFields.length > 0 && <p>原列已不在本表中：{mappingLabels(missingPresetFields)}。请选择新列，或保持不导入。</p>}{ambiguousPresetFields.length > 0 && <p>存在同名列或映射冲突：{mappingLabels(ambiguousPresetFields)}，请手动选择对应列。</p>}<small>确认合并后会记住本次选择。列顺序变化时按列名匹配。</small></div>}<div className="mapping-grid">{fields.map((f: any) => <Field key={f.key} label={<>{f.label}{f.required && <em>*</em>}</>}><select value={mapping[f.key] ?? ""} className={f.required && blank(mapping[f.key]) ? "required-empty" : ""} onChange={e => { setMapping({ ...mapping, [f.key]: e.target.value }); setMappingInfo((info: any) => info ? { ...info, manual: true } : info); setPreview(null); }}><option value="">不导入此字段</option>{headers.map((h, i) => <option value={String(i)} key={i}>{i + 1}. {h}</option>)}</select>{mapping[f.key] !== "" && mapping[f.key] != null && <small className="field-example">示例：{text(sheetRows[headerRow]?.[Number(mapping[f.key])]) || "（首行为空）"}</small>}</Field>)}</div><div className="mapping-heading"><h3>源数据预览</h3><span className="muted small-text">前 4 行</span></div><div className="table-scroll source-preview"><table className="data-table"><thead><tr>{headers.slice(0, 12).map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{sheetRows.slice(headerRow, headerRow + 4).map((r, i) => <tr key={i}>{headers.slice(0, 12).map((_, j) => <td key={j} title={text(r[j])}>{text(r[j]) || "—"}</td>)}</tr>)}</tbody></table></div>{headers.length > 12 && <p className="section-note">预览展示前 12 列，字段映射可选择全部 {headers.length} 列。</p>}<div className="import-bottom"><span><CheckCircle2 size={15} />{importType === "videos" && publicationVideo ? "更新发布记录和月度推广；达人累计由出单报表更新" : importType === "videos" && stageVideo ? "销量周期待确认，暂不计入达人累计" : importType === "videos" && replacePeriod ? "完整报表会替换相同统计期间的视频" : "缺少的行不会删除已有数据"}</span><button className="button primary" onClick={previewImport} disabled={saving || reading || (!duplicateVideoSource && missingRequired.length > 0)}>{duplicateVideoSource ? "查看重复识别结果" : "预览合并结果"} <ArrowRight size={16} /></button></div></section>}
            {preview && <section className="card import-preview-card"><div className="card-heading"><div><h2>{preview.summary?.duplicateFile ? "已识别重复文件" : importType === "videos" && publicationVideo ? "更新月度推广 · 不重复增加达人累计" : importType === "videos" && stageVideo ? "准备暂存 · 不增加累计销量" : "准备好合并了"}</h2><p>{typeNames[importType]} · {sheet}</p></div><Badge tone="green">已完成数据检查</Badge></div>{!preview.summary?.duplicateFile && preview.recognizedPeriods?.length > 0 && <div className="recognized-sales-periods"><div><Clock3 size={16} /><strong>识别到的出单统计周期</strong></div><p>累计与去重按这些周期执行，不按视频发布日期划分。</p><ul>{preview.recognizedPeriods.slice(0, 18).map((period: RecordItem) => <li key={`${period.periodStart}|${period.periodEnd}`}><strong>{period.periodStart} 至 {period.periodEnd}</strong><span>{formatNum(period.recordCount)} 条记录</span></li>)}</ul>{preview.recognizedPeriods.length > 18 && <small>共 {formatNum(preview.recognizedPeriods.length)} 个周期，以上显示前 18 个。</small>}</div>}{!preview.summary?.duplicateFile && preview.recognizedViewsPeriods?.length > 0 && <div className="recognized-sales-periods"><div><BarChart3 size={16} /><strong>{publicationVideo ? "识别到的发布报表统计期间" : "识别到的播放统计期间"}</strong></div><p>{publicationVideo ? "以下统计期间用于发布报表的月度推广；不增加达人累计。" : "以下播放期间用于达人累计；同一视频在同一期间只计一次。"}</p><ul>{preview.recognizedViewsPeriods.slice(0, 18).map((period: RecordItem) => <li key={`${period.start}|${period.end}`}><strong>{period.start} 至 {period.end}</strong><span>{formatNum(period.recordCount)} 条记录</span></li>)}</ul></div>}{preview.summary?.duplicateFile && publicationReports.length > 0 && <p className="section-note">已有发布报表需要补充统计期间时，前往<a href="#publication-reports">发布视频报表的月度推广统计期间</a>直接修改，不必再次导入文件。</p>}{!preview.summary?.duplicateFile && <div className="preview-counts"><MiniStat label="新增" value={preview.summary?.added} /><MiniStat label="更新" value={preview.summary?.updated} /><MiniStat label="未变化" value={preview.summary?.unchanged} /><MiniStat label="跳过 / 无效" value={num(preview.rejected) + num(preview.summary?.rejected)} /></div>}{preview.warnings.length > 0 && <div className="warning-list"><strong><AlertCircle size={15} />需要关注</strong>{preview.warnings.slice(0, 8).map((w: any, i: number) => <p key={i}>{text(w)}</p>)}{preview.warnings.length > 8 && <p>还有 {preview.warnings.length - 8} 条提示，导入后请查看数据记录。</p>}</div>}<div className="import-bottom"><span>{preview.summary?.duplicateFile ? "此文件和工作表已处理，本次不会再次累计。" : "确认后将更新收样、推广与达人分层。"}</span><button className="button primary" onClick={confirmImport} disabled={saving || reading || preview.contextSignature !== importSignature}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}{preview.summary?.duplicateFile ? "知道了，跳过重复文件" : `确认合并 ${formatNum(preview.records.length)} 条记录`}</button></div></section>}
            <div className="import-lower-grid"><section className="card"><div className="card-heading"><div><h2>导入记录</h2><p>新文件合并更新，旧记录持续保留</p></div><button className="button small" disabled={saving || !canUndo} onClick={undo}><Undo2 size={14} />撤回上次更新</button></div><div className="table-scroll"><table className="data-table compact-table"><thead><tr><th>文件 / 工作表</th><th>类型</th><th>更新结果</th><th>时间</th></tr></thead><tbody>{[...(state.imports || [])].reverse().slice(0, 10).map((r: RecordItem, i) => <tr key={r.id || i}><td><strong className="cell-title">{r.sheetName || "—"}</strong><small className="cell-sub source-filename" title={r.sourceName || r.fileName}>{r.sourceName || r.fileName || "初始导入"}</small></td><td>{typeNames[r.type] || r.type || "初始化"}</td><td>{r.duplicateFile || r.status === "duplicateSkipped" ? <Badge tone="neutral">重复已跳过</Badge> : <><span className="success-text">+{formatNum(r.added ?? r.summary?.added ?? r.recordCount ?? r.rows)}</span><small className="cell-sub">{r.mode === "historicalBaseline" ? `历史截至 ${dateText(r.cutoffDate)}` : `更新 ${formatNum(r.updated ?? r.summary?.updated)}`}</small></>}</td><td className="small-text">{dateText(r.at || r.importedAt || r.date || r.createdAt)}</td></tr>)}</tbody></table></div>{!state.imports?.length && <Empty title="尚无后续导入记录" detail="当前已有数据保留在工作台；导入新文件后，这里会记录更新结果。" />}</section><section className="card backup-card"><div className="card-heading"><div><h2>数据备份</h2><p>保存一份完整工作台数据</p></div><ShieldCheck size={19} className="success-text" /></div><p>备份包含收样、映射、视频、达人档案、规则和导入历史。可用于恢复工作台。</p><button className="button full" onClick={() => exportTable("all")} disabled={exporting}><FileSpreadsheet size={16} />导出完整 Excel 工作簿</button><button className="button full" onClick={backup}><Download size={16} />下载完整备份 JSON</button><button className="text-button" onClick={() => restoreInput.current?.click()}><Upload size={14} />从备份恢复</button><div className="backup-count"><strong>{formatNum(state.productMappings?.length)}</strong><span>条 SKU–PID 映射已保留</span></div></section></div>
            {issues.length > 0 && <section className="card issue-card"><div className="card-heading"><div><h2>数据核对提示</h2><p>存在不确定关系时，工作台保留原始记录，等待你确认。</p></div><Badge tone="amber">{issues.length} 项</Badge></div><div className="issue-list">{issues.slice(0, 18).map((issue: any, i: number) => <div key={i}><AlertCircle size={15} /><div className="issue-detail"><p>{typeof issue === "string" ? issue : issue.message || issue.reason || issue.description || text(issue)}</p>{typeof issue !== "string" && <small>{[issue.creatorId && `达人 @${issue.creatorId}`, issue.orderId && `订单 ${issue.orderId}`, issue.sku && `SKU ${issue.sku}`, issue.skuId && `SKU ID ${issue.skuId}`, issue.productId && `PID ${issue.productId}`, issue.videoId && `视频 ${issue.videoId}`, issue.month && `月份 ${issue.month}`, issue.period && `期间 ${issue.period}`, issue.id && `记录 ${issue.id}`].filter(Boolean).join(" · ")}</small>}</div>{typeof issue !== "string" && (issue.id || issue.creatorId || issue.orderId || issue.sku || issue.skuId) && <button className="text-button issue-action" onClick={() => inspectIssue(issue)}>定位记录 <ArrowUpRight size={13} /></button>}</div>)}</div>{issues.length > 18 && <p className="section-note">展示前 18 项；可在收样记录中筛选「待核对」。</p>}</section>}
          </>}

          {isAdmin && view === "rules" && ruleDraft && <>
            <div className="rules-intro"><div className="soft-icon"><SlidersHorizontal size={22} /></div><div><h2>你的规则，实时生效</h2><p>按从上到下的顺序判断，命中第一条即确定等级。保存后自动重算全部达人。</p></div><button className="button primary" onClick={saveRules} disabled={saving || !rulesDirty || !!willingnessRulesError}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}保存规则</button></div>
            <section className="card"><div className="card-heading"><div><h2>达人等级规则</h2><p>单量上下限均包含边界；最大值留空表示不限。</p></div><button className="button small" onClick={() => { setRuleDraft({ ...ruleDraft, rules: [...ruleDraft.rules, { id: `rule-${Date.now()}`, level: 1, label: "自定义等级", minSold: 0, maxSold: null, minCollaborations: 0, enabled: true }] }); setRulesDirty(true); }}><Plus size={14} />添加规则</button></div><div className="table-scroll"><table className="data-table rule-table"><thead><tr><th>启用</th><th>等级</th><th>等级名称</th><th>最少出单</th><th>最多出单</th><th>至少合作次数</th><th>优先顺序</th><th /></tr></thead><tbody>{ruleDraft.rules.map((r: any, i: number) => <tr key={r.id || i}><td><input type="checkbox" aria-label={`启用第${i + 1}条规则`} checked={r.enabled !== false} onChange={e => setRule(i, "enabled", e.target.checked)} /></td><td><select aria-label={`第${i + 1}条规则等级`} value={r.level} onChange={e => setRule(i, "level", num(e.target.value))}>{[1, 2, 3, 4, 5].map(l => <option value={l} key={l}>L{l}</option>)}</select></td><td><input aria-label={`第${i + 1}条等级名称`} value={r.label} onChange={e => setRule(i, "label", e.target.value)} /></td><td><input type="number" min="0" aria-label={`第${i + 1}条最少出单`} value={r.minSold ?? 0} onChange={e => setRule(i, "minSold", num(e.target.value))} /></td><td><input type="number" min="0" placeholder="不限" aria-label={`第${i + 1}条最多出单`} value={r.maxSold ?? ""} onChange={e => setRule(i, "maxSold", e.target.value === "" ? null : num(e.target.value))} /></td><td><input type="number" min="0" aria-label={`第${i + 1}条最少合作次数`} value={r.minCollaborations ?? 0} onChange={e => setRule(i, "minCollaborations", num(e.target.value))} /></td><td><div className="rule-arrows"><button className="icon-button" disabled={i === 0} aria-label="上移规则" onClick={() => { const d = clone(ruleDraft); [d.rules[i - 1], d.rules[i]] = [d.rules[i], d.rules[i - 1]]; setRuleDraft(d); setRulesDirty(true); }}><ArrowUp size={14} /></button><button className="icon-button" disabled={i === ruleDraft.rules.length - 1} aria-label="下移规则" onClick={() => { const d = clone(ruleDraft); [d.rules[i], d.rules[i + 1]] = [d.rules[i + 1], d.rules[i]]; setRuleDraft(d); setRulesDirty(true); }}><ArrowDown size={14} /></button></div></td><td><button className="icon-button danger-text" aria-label="删除规则" onClick={() => { const d = clone(ruleDraft); d.rules.splice(i, 1); setRuleDraft(d); setRulesDirty(true); }}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div><div className="rule-note"><AlertCircle size={16} /><p>未命中任何规则的达人归为 L1。初始规则：合作至少 2 次时，10 单为 L2、11–19 单为 L3、20–50 单为 L4、51 单及以上为 L5；单量达到 60 时也可直接进入 L5。合作次数优先按有效收样件数；没有收样记录时按自购样品件数计算。</p></div><div className="rules-subform"><Field label="合作次数计算方式"><input value="实际收样件数，或无收样时的自购样品件数" readOnly /><small className="field-example">2 件样品 = 2 次合作。补齐收样记录后，以实际记录计数，不再叠加自购估计。</small></Field><Field label="无收样且出单达标：默认自购样品件数"><input type="number" min="0" step="1" value={ruleDraft.selfPurchaseDefaultQuantity ?? 1} onChange={e => { setRuleDraft({ ...ruleDraft, selfPurchaseDefaultQuantity: e.target.value === "" ? "" : Number(e.target.value) }); setRulesDirty(true); }} /><small className="field-example">默认按 1 件、1 次合作计，并标注为估计。已知购买数量时，在达人档案单独填写；不按视频条数猜数量。</small></Field><Field label="样品视频表现好：累计出单严格超过"><input type="number" min="0" value={ruleDraft.successfulSampleMinSold ?? 10} onChange={e => { setRuleDraft({ ...ruleDraft, successfulSampleMinSold: Math.max(0, num(e.target.value)) }); setRulesDirty(true); }} /><small className="field-example">默认超过 10 件，即 11 件起。按同一视频的已确认统计期间累计。</small></Field><Field label="推广表爆款视频：当期出单至少"><input type="number" min="0" value={ruleDraft.viralMinSold ?? 5} onChange={e => { setRuleDraft({ ...ruleDraft, viralMinSold: Math.max(0, num(e.target.value)) }); setRulesDirty(true); }} /><small className="field-example">用于月度推广表的爆款视频链接，包含边界；与样品视频累计表现分别设置。</small></Field><Field label="无收样记录纳入门槛：累计出单大于"><input type="number" min="0" value={ruleDraft.videoOnlyCreatorMinSold ?? 10} onChange={e => { setRuleDraft({ ...ruleDraft, videoOnlyCreatorMinSold: Math.max(0, num(e.target.value)) }); setRulesDirty(true); }} /><small className="field-example">默认大于 10 件。只计算已确认出单；纳入后标注暂无收样记录，自购样品数量可以在达人档案填写。</small></Field><div className="rules-source-note"><FileSpreadsheet size={17} /><p>分层出单只使用已确认统计期间的视频分析数据。旧达人档案的历史累计值保留为参考。累计播放沿用历史底数，并累加截止日之后已确认期间；达人视频均播放量继续取最新倾向表快照。</p></div></div></section>
            <section className="card willingness-settings-card">
              <div className="card-heading"><div><h2>合作配合意愿设置</h2><p>按实际沟通情况手工维护，可在达人分层中单独或批量修改。</p></div><button className="button small" disabled={saving} onClick={() => setWillingnessOptions([...ruleDraft.willingnessOptions, ""])}><Plus size={14} />添加选项</button></div>
              <div className="willingness-settings-grid">
                <div><ol className="willingness-options">{ruleDraft.willingnessOptions.map((option: string, index: number) => <li key={index}><span className="willingness-option-index">{index + 1}</span><input aria-label={`第 ${index + 1} 个合作配合意愿选项`} value={option} onChange={e => renameWillingnessOption(index, e.target.value)} placeholder="填写选项名称" disabled={saving} /><div className="willingness-option-actions"><button className="icon-button" aria-label={`上移第 ${index + 1} 个意愿选项`} disabled={saving || index === 0} onClick={() => moveWillingnessOption(index, -1)}><ArrowUp size={14} /></button><button className="icon-button" aria-label={`下移第 ${index + 1} 个意愿选项`} disabled={saving || index === ruleDraft.willingnessOptions.length - 1} onClick={() => moveWillingnessOption(index, 1)}><ArrowDown size={14} /></button><button className="icon-button danger-text" aria-label={`删除第 ${index + 1} 个意愿选项`} disabled={saving} onClick={() => setWillingnessOptions(ruleDraft.willingnessOptions.filter((_: string, itemIndex: number) => itemIndex !== index), ruleDraft.defaultWillingness === option ? "" : ruleDraft.defaultWillingness)}><Trash2 size={15} /></button></div></li>)}</ol>{!ruleDraft.willingnessOptions.length && <p className="willingness-empty-hint">请添加至少一个合作配合意愿选项。</p>}</div>
                <div className="willingness-default-panel"><Field label="未填写意愿时的默认值"><select value={ruleDraft.defaultWillingness} disabled={saving} onChange={e => { setRuleDraft({ ...ruleDraft, defaultWillingness: e.target.value }); setRulesDirty(true); }}><option value="">请选择默认值</option>{ruleDraft.willingnessOptions.map((option: string, index: number) => <option key={index} value={option} disabled={!option.trim()}>{option || `未命名选项 ${index + 1}`}</option>)}</select></Field><p>初始选项为未沟通、高、低、随性。默认值仅用于未填写意愿的达人；已明确填写的意愿继续保留。</p><div className="willingness-preview">{ruleDraft.willingnessOptions.filter((option: string) => option.trim()).map((option: string, index: number) => <Badge key={index} tone={willingnessTone(option.trim())}>{option.trim()}</Badge>)}</div></div>
              </div>
              {willingnessRulesError && <div className="willingness-validation" role="alert"><AlertCircle size={15} /><span>{willingnessRulesError}</span></div>}
              <div className="rule-note"><ShieldCheck size={16} /><p>重命名或删除选项后，已填写的达人保留原标签，并标注“历史值”。需要统一调整时，在达人分层中筛选、勾选后批量应用新意愿；合作配合意愿不会根据出单量或合作次数自动判断。</p></div>
            </section>
            <section className="card"><div className="card-heading"><div><h2>发样订单筛选</h2><p>导入 All orders 时按以下条件判断；源文件保留，调整后可以重新统计。</p></div><Filter size={19} className="muted" /></div><div className="rule-options">{[["excludeNormal", "排除普通订单", "Normal or Pre-order 为 Normal 的订单不计入发样。"], ["excludeRefunded", "排除退款订单", "订单子状态包含退款、Refund 等标识时不计入。"], ["excludeCancelled", "排除取消订单", "订单子状态包含取消、Cancelled 等标识时不计入。"], ["allowBlankFromSampleSheet", "允许已筛选发样表中的空订单类型", "导入时明确勾选“已筛选的发样订单表”后生效。"], ["allowBlankType", "允许完整订单表中的空订单类型", "按非 Normal 规则纳入空类型订单，仍排除取消和退款；无法确认达人时保留待关联。"]].map(([key, label, desc]) => <label className="checkbox-line" key={key}><input type="checkbox" checked={!!ruleDraft.orderFilter?.[key]} onChange={e => { setRuleDraft({ ...ruleDraft, orderFilter: { ...ruleDraft.orderFilter, [key]: e.target.checked } }); setRulesDirty(true); }} /><span>{label}<span className="subtext">{desc}</span></span></label>)}</div></section>
            <section className="card rules-safeguards"><div><ShieldCheck size={22} /><h3>固定的合并保护</h3></div><p>SKU ID 精确匹配优先；同一个 Seller SKU 对应多个 PID 时需要核对。重复视频报表更新原统计区间，不重复相加。导入表删除了某些行，也不会删除已保存的 PID 映射或手工备注。</p></section><div className="settings-footer"><button className="text-button" onClick={() => { setRuleDraft(clone(E.defaultSettings)); setRulesDirty(true); }}>恢复初始规则</button><button className="button primary" onClick={saveRules} disabled={saving || !rulesDirty || !!willingnessRulesError}>保存并重新计算</button></div>
          </>}
        </>)}
        <footer className="workspace-footer"><span>heihei CREATOR WORKSPACE</span><span>让数据连接每一次合作</span></footer>
      </main>
    </div>

    {editSample && <Drawer title={!isAdmin ? "收样记录详情" : (editSample.id || editSample.orderId) ? "编辑收样记录" : "新增收样记录"} subtitle={isAdmin ? "按订单与样品合并记录；视频链接由你确认后保存。" : "查看收样信息、视频链接与合作备注。"} onClose={() => !saving && setEditSample(null)} footer={<><button className="button" onClick={() => setEditSample(null)} disabled={saving}>{isAdmin ? "取消" : "关闭"}</button>{isAdmin && <button className="button primary" onClick={saveSample} disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}保存记录</button>}</>}><fieldset className="drawer-form readonly-fields" disabled={!isAdmin}>{editSample.buyerUsername && <div className="drawer-info"><strong>订单达人 ID · Buyer Username</strong><p>@{text(editSample.buyerUsername)}</p>{editSample.creatorIdentityConflict && <p>这个账号与历史手工达人 ID 不一致，当前保留原手工关联。请核对达人及本条已确认视频链接，再修改并保存。</p>}</div>}<div className="form-grid"><Field label="达人 ID"><input value={sampleDraft.creatorId} onChange={e => setSampleDraft({ ...sampleDraft, creatorId: e.target.value })} placeholder="例如 rafaq.store" /></Field><Field label="寄样 / 记录日期"><input type="date" value={sampleDraft.date} onChange={e => setSampleDraft({ ...sampleDraft, date: e.target.value })} /></Field><Field label="订单号"><input value={sampleDraft.orderId} onChange={e => setSampleDraft({ ...sampleDraft, orderId: e.target.value })} /></Field><Field label="SKU ID / 样品 ID"><input value={sampleDraft.skuId} onChange={e => setSampleDraft({ ...sampleDraft, skuId: e.target.value })} /></Field><Field label="Seller SKU"><input value={sampleDraft.sku} onChange={e => setSampleDraft({ ...sampleDraft, sku: e.target.value })} /></Field><Field label="产品 PID"><input value={sampleDraft.productId} onChange={e => setSampleDraft({ ...sampleDraft, productId: e.target.value })} placeholder="留空时按 SKU 映射" /></Field><Field label="样品数量"><input type="number" min="0" value={sampleDraft.quantity} onChange={e => setSampleDraft({ ...sampleDraft, quantity: e.target.value })} /></Field><Field label="收样状态"><input value={text(sampleDraft.received)} list="received-options" onChange={e => setSampleDraft({ ...sampleDraft, received: e.target.value })} placeholder="待寄出 / 已寄出 / 已收样" /><datalist id="received-options"><option value="待寄出" /><option value="已寄出" /><option value="已收样" /><option value="待确认" /></datalist></Field></div><Field label="已确认的视频链接（每行一条）"><textarea rows={5} value={sampleDraft.videoLinksText} onChange={e => setSampleDraft({ ...sampleDraft, videoLinksText: e.target.value })} placeholder="https://www.tiktok.com/@creator/video/..." /></Field><div className="field-hint"><Link2 size={13} />填写或选入这里的链接，保存后确认属于当前收样。后续视频报表只更新候选，不会自动替换这些链接。</div><SampleVideoCandidates sample={editSample} draft={sampleDraft} allSamples={all.samples || []} editable={isAdmin} onChange={value => setSampleDraft({ ...sampleDraft, videoLinksText: value })} /><Field label="备注"><textarea rows={4} value={sampleDraft.notes} onChange={e => setSampleDraft({ ...sampleDraft, notes: e.target.value })} placeholder="如已催视频、预计发布时间、达人反馈等" /></Field>{editSample.matchStatus && <div className="drawer-info"><strong>当前匹配状态</strong><p>{text(editSample.matchStatus)}</p></div>}</fieldset></Drawer>}
    {editCreator && <Drawer title="达人合作档案" subtitle="让每一次沟通与合作都有记录。" onClose={() => !saving && setEditCreator(null)} footer={<><a href={profileURL(editCreator.creatorId)} target="_blank" rel="noreferrer" className="button">TikTok 主页 <ExternalLink size={14} /></a>{isAdmin && <button className="button primary" onClick={saveCreator} disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}保存档案</button>}</>}><div className="creator-profile"><div className={`${avatarClass(editCreator.creatorId)} large`}>{initials(editCreator.creatorId)}</div><div><h2>@{editCreator.creatorId}</h2><LevelBadge level={editCreator.level} label={editCreator.levelLabel} /></div></div><div className="profile-metrics"><MiniStat label="累计出单" value={editCreator.lifetimeItemsSold} /><div className="mini-stat cm-gmv-stat" title={text(editCreator.gmvSource)}><span>累计出单金额（GMV）</span><strong>{gmvAmount(editCreator.lifetimeGmv, editCreator.gmvAvailable !== false)}</strong>{editCreator.gmvCoverageStatus === "partial" && <small>部分记录缺GMV</small>}</div><MiniStat label="合作次数" value={editCreator.cooperationCount} /><MiniStat label="累计播放量" value={editCreator.cumulativeVideoViewsAvailable === false ? null : creatorPlaybackNumber(editCreator.cumulativeVideoViews)} missingLabel="待确认" /><MiniStat label="达人视频均播放量" value={editCreator.views} missingLabel="未提供" /></div><p className="profile-source-note"><strong>累计 GMV：</strong>{text(editCreator.gmvSource) || "沿用已确认历史底表，并累加其后出单报表的实际销售期间；缺失金额保留为空。"}{editCreator.gmvCoverageStatus === "partial" && ` 另有 ${formatNum(editCreator.gmvMissingRecords)} 条记录未提供 GMV，当前为已提供金额的合计。`}</p><CreatorPlaybackDetails creator={editCreator} />{editCreator.historicalVideoViewsReference != null && <p className="profile-source-note">历史报表最高播放参考：{compact(editCreator.historicalVideoViewsReference)} 次。仅供核对，可能与已采用的历史底数重合，不作为额外增量加入累计。</p>}<p className="profile-source-note">{editCreator.views == null ? "尚未导入该达人的视频均播放量，待更新相关字段。" : `${text(editCreator.viewsSource) || "西班牙达人带货倾向表"}${editCreator.viewsAsOf ? ` · ${dateText(editCreator.viewsAsOf)}` : ""} · 使用导入的均播放量快照，不累计，不用部分视频报表重新求平均。`}</p><div className="grade-reason"><Star size={15} /><span>{text(editCreator.gradeReason) || "未命中其他规则，归为 L1 基础达人"}</span></div>
      {editCreator.rosterSource === "salesThreshold" && <div className="roster-admission"><Users size={15} /><span>{editCreator.admissionReason || "出单达标纳入，暂无收样记录"}。{text(editCreator.cooperationSource)}。</span></div>}<section className="creator-contributions"><div className="contribution-heading"><div><h3>样品 / 产品出单贡献</h3><p>按已确认统计期间累计，展示各产品的销量贡献。</p></div><Badge tone="green">{formatNum(editCreator.successfulSampleVideoCount)} 条样品视频表现好</Badge></div>
        {(editCreator.productContributions || []).length ? <div className="contribution-list">{editCreator.productContributions.map((product: RecordItem, index: number) => <article className="contribution-product" key={product.productId || index}><div className="contribution-product-title"><div><strong>{product.representativeSku || product.productName || product.productId || "产品待识别"}</strong><small>PID {product.productId || "待补充"}</small></div><div><strong>{formatNum(product.itemsSold)}<small> 件</small></strong><span>占累计出单 {salesShare(contributionShare(product))}</span></div></div><div className="contribution-track"><span style={{ width: `${Math.min(100, contributionShare(product) * 100)}%` }} /></div><div className="contribution-product-detail"><span>{product.sampleLinked ? `该产品有 ${formatNum(product.sampleQuantity)} 件收样` : "未匹配收样产品，待核对"}</span>{num(product.goodVideoCount) > 0 && <span className={product.sampleLinked ? "success-text" : "muted"}>{formatNum(product.goodVideoCount)} 条视频超过 {formatNum(state.settings?.successfulSampleMinSold ?? 10)} 件</span>}</div><ContributionVideoStatus product={product} /></article>)}</div> : <div className="contribution-empty"><Package size={20} /><p>暂无已确认的视频出单数据。导入并确认统计周期后，会显示主要出单样品。</p></div>}
        <p className="contribution-caption">同一视频累计出单严格超过 {formatNum(state.settings?.successfulSampleMinSold ?? 10)} 件时标记为表现好。这里按达人和产品比对，具体属于哪次收样仍需在收样页确认。</p>
      </section><CreatorCommissionDetails data={commissionData} creator={editCreator.creatorId} isAdmin={isAdmin} /><fieldset className="drawer-form readonly-fields" disabled={!isAdmin}>
        <section className="self-purchase-panel"><div className="self-purchase-heading"><Package size={17} /><div><h3>自购样品与合作次数</h3><p>{text(editCreator.cooperationSource) || "按样品数量计算"} · 当前 {formatNum(editCreator.cooperationCount)} 次合作</p></div></div>
          <Field label="自购样品数量（无收样记录时使用）"><input type="number" min="0" step="1" value={creatorDraft.selfPurchasedSampleQuantity} onChange={e => setCreatorDraft({ ...creatorDraft, selfPurchasedSampleQuantity: e.target.value })} placeholder={`留空按默认 ${state.settings?.selfPurchaseDefaultQuantity ?? 1} 件计`} /><small className="field-example">填写实际购买的样品件数；明确 0 会保留。留空使用规则默认值，且仅对出单达标、没有收样记录的达人生效。</small></Field>
          <Field label="自购样品备注"><textarea rows={2} value={creatorDraft.selfPurchaseNotes} onChange={e => setCreatorDraft({ ...creatorDraft, selfPurchaseNotes: e.target.value })} placeholder="例如自购 2 件，订单号或核对依据" /></Field>
          {num(editCreator.sampleRecordCount) > 0 ? <p className="self-purchase-hint"><CheckCircle2 size={14} />已有收样记录，目前按 {formatNum(editCreator.recordedSampleQuantity ?? editCreator.sampleQuantity)} 件有效样品计算。自购数量作为备注保留，不重复增加合作次数。</p> : <p className="self-purchase-hint"><AlertCircle size={14} />默认数量是暂估值；补齐收样记录后，合作次数自动改按实际收样件数。</p>}
        </section><Field label="合作配合意愿"><select value={creatorDraft.willingness} onChange={e => { setCreatorDraft({ ...creatorDraft, willingness: e.target.value }); setCreatorWillingnessEdited(true); }}>{unique([...willingnessConfig.options, editCreator.willingness]).map(w => <option value={text(w)} key={text(w)}>{text(w)}{!willingnessConfig.options.includes(text(w)) ? "（历史值）" : ""}</option>)}</select><small className="field-example">按实际沟通情况填写；选项与默认值由管理员在规则设置中维护。{!willingnessConfig.options.includes(text(editCreator.willingness)) ? "当前历史标签可保留，修改后使用新选项。" : ""}</small></Field><Field label="带货倾向"><textarea rows={3} value={creatorDraft.tendency} onChange={e => setCreatorDraft({ ...creatorDraft, tendency: e.target.value })} placeholder="例如家居清洁、家装维修、汽车养护" /></Field><Field label="视频特点 / 风格"><textarea rows={3} value={creatorDraft.style} onChange={e => setCreatorDraft({ ...creatorDraft, style: e.target.value })} placeholder="记录实拍观察：真人口播、前后对比、使用教程等" /></Field><Field label="合作备注"><textarea rows={5} value={creatorDraft.notes} onChange={e => setCreatorDraft({ ...creatorDraft, notes: e.target.value })} placeholder="沟通情况、配合程度、佣金约定、下一步计划…" /></Field><div className="field-hint"><ShieldCheck size={14} />手动填写的档案字段优先保留，不会被后续空白导入覆盖。</div></fieldset></Drawer>}
    {help && <Modal title="使用说明与计算口径" onClose={() => setHelp(false)} wide><WorkbenchGuide settings={all.settings || state?.settings} /><div className="modal-bottom">{isAdmin ? <button className="button primary" onClick={() => { setHelp(false); go("imports"); }}>开始导入 <ArrowRight size={15} /></button> : <button className="button primary" onClick={() => setHelp(false)}>返回工作台</button>}</div></Modal>}
    {isAdmin && restoreData && <Modal title="确认恢复备份" onClose={() => !saving && setRestoreData(null)}><p className="modal-description">恢复将用备份内容替换当前工作台数据，包括规则与备注。当前版本仍可通过“撤回上次更新”恢复。</p><div className="preview-counts"><MiniStat label="收样记录" value={restoreData.samples.length} /><MiniStat label="视频记录" value={restoreData.videos.length} /><MiniStat label="产品映射" value={restoreData.productMappings.length} /></div><div className="modal-bottom"><button className="button" onClick={() => setRestoreData(null)}>取消</button><button className="button primary" disabled={saving} onClick={async () => { if (await save(restoreData, "完整备份已恢复")) setRestoreData(null); }}>确认恢复</button></div></Modal>}
  </div>;
}

function TrendingIcon(props: any) { return <ArrowUpRight {...props} />; }
function HistoricalBaselineCard({ baseline }: { baseline: RecordItem }) {
  const records = baseline.records || [], nextDate = nextPeriodDate(text(baseline.cutoffDate));
  const nextLabel = nextDate.endsWith("-01") ? `${monthText(nextDate.slice(0, 7))}起` : `${nextDate}起`;
  return <section className="card historical-baseline-card">
    <div className="baseline-heading"><div className="baseline-icon"><CheckCircle2 size={23} /></div><div><div className="pending-eyebrow">历史底表已计入</div><h2>截至 {dateText(baseline.cutoffDate)} 的历史出单</h2><p>{nextLabel}按实际统计周期继续累计。</p></div><Badge tone="green">已生效</Badge></div>
    <div className="baseline-stats"><MiniStat label="历史视频" value={new Set(records.map((r: RecordItem) => r.videoId)).size} /><MiniStat label="历史累计出单" value={records.reduce((total: number, r: RecordItem) => total + num(r.itemsSold), 0)} /><div className="baseline-source"><span>来源文件</span><strong title={text(baseline.fileName)}>{baseline.fileName || "历史合并底表"}</strong><small>历史同一视频取最高出单，原月报保留供核对。</small></div></div>
    <p className="baseline-caption"><ShieldCheck size={15} />历史同一视频取最高出单，不同视频合计；截止日之后按实际出单周期追加。“出单日期”可填 10月，视频发布日期用于视频数量归月与收样匹配。</p>
  </section>;
}
function PendingVideoCard({ report, draft, review, error, saving, onDraftChange, onPreview, onConfirm, onUsePublication }: any) {
  const summary = report.summary || {}, isBaseline = draft.mode === "historicalBaseline";
  const previousPeriods = [...new Map<string, RecordItem>([...(review?.exactPeriods || []), ...(review?.overlappingPeriods || []), ...(review?.coveredPeriods || []), ...(review?.partialPeriods || [])].map((period: RecordItem) => [`${period.periodStart}|${period.periodEnd}`, period] as [string, RecordItem])).values()];
  const previousBaselines = [...(review?.coveredBaselines || []), ...(review?.baselineOverlaps || [])];
  const isDuplicate = !!review?.duplicateFile;
  const blocked = !isDuplicate && !!(review && (review.canActivate === false || review.hasPartialOverlaps || review.baselineOverlaps?.length));
  const readyDates = isBaseline ? !!draft.cutoffDate : !!draft.rangeStart && !!draft.rangeEnd;
  return <section className="card pending-video-card">
    <div className="pending-video-heading"><div className="pending-video-icon"><Clock3 size={22} /></div><div><div className="pending-eyebrow">已接收 · 等待确认</div><h2>{report.fileName || "视频分析报表"}</h2><p>可提供收样候选链接；这份文件的出单还未计入达人累计。</p></div><Badge tone="amber">待确认</Badge></div>
    <div className="pending-video-stats"><MiniStat label="文件内视频" value={summary.videoCount ?? report.records?.length} /><MiniStat label="报表出单（未累计）" value={summary.itemsSold} /><MiniStat label="文件内达人" value={summary.creatorCount} missingLabel="未提供" /><MiniStat label="产品 PID" value={summary.productCount} missingLabel="未提供" /></div>
    <div className="pending-explanation"><AlertCircle size={16} /><div><p>{isBaseline ? "如果这是之前全部历史数据的合并表，只需确认历史截止日。历史同一视频与 PID 取最高出单，再汇总不同视频；截止日之后的新周期继续追加。" : report.reason || "文件未提供明确的统计起止日期，请核对导出后台选择的统计范围。视频发布日期不能代替销售统计周期。"}</p>{num(summary.duplicateExistingVideos) > 0 && <p>已核对：{formatNum(summary.duplicateExistingVideos)} 条视频与已有报表重复，涉及 {formatNum(summary.duplicateExistingItemsSold)} 件出单。确认后会先核对覆盖范围，再计算累计。</p>}</div></div>
    <div className="publication-purpose-choice"><div><strong>如果这是按发布月份筛选的视频表</strong><p>可先更新发布记录和候选链接，再单独确认播放统计期间；销量由出单报表累计。此操作保留原文件数据。</p></div><button className="button small" onClick={onUsePublication} disabled={saving}>设为发布视频报表</button></div>
    <div className="pending-mode-choice"><Field label="这份文件的统计方式"><select value={draft.mode} onChange={e => onDraftChange("mode", e.target.value)} disabled={saving}><option value="period">按明确统计周期累计</option><option value="historicalBaseline">作为全部历史出单底表</option></select></Field></div>
    <div className={`pending-period-form ${isBaseline ? "baseline-period-form" : ""}`}>{isBaseline ? <Field label="历史出单截止日期"><input type="date" value={draft.cutoffDate} onChange={e => onDraftChange("cutoffDate", e.target.value)} disabled={saving} /></Field> : <><Field label="实际统计开始日期"><input type="date" value={draft.rangeStart} onChange={e => onDraftChange("rangeStart", e.target.value)} disabled={saving} /></Field><Field label="实际统计结束日期"><input type="date" value={draft.rangeEnd} onChange={e => onDraftChange("rangeEnd", e.target.value)} disabled={saving} /></Field></>}<button className="button primary" onClick={onPreview} disabled={saving || !readyDates}>{isBaseline ? "预览历史底表" : "确认统计周期并预览"} <ArrowRight size={15} /></button></div>
    <p className="pending-date-hint">{isBaseline ? "历史同一视频取最高出单；开始日期未知时保持未知，截止日期之后按出单周期追加。" : "请填写这份报表在导出后台选定的日期范围，不使用视频发布起止日。"}</p>
    {error && <div className="pending-error" role="alert"><AlertCircle size={16} />{error}</div>}
    {review && <div className="pending-review"><div className="pending-review-heading"><div><h3>{isDuplicate ? "已识别重复文件" : "本次更新预览"}</h3><p>{isBaseline ? `历史底表截至 ${review.cutoffDate}` : `${review.rangeStart} 至 ${review.rangeEnd}`}</p></div><Badge tone={blocked ? "amber" : "green"}>{isDuplicate ? "不会重复累计" : blocked ? "需要核对" : "已按填写范围预览"}</Badge></div><div className="pending-review-total"><span>更新后的工作台视频累计出单</span><strong>{blocked || review.projectedItemsSold == null ? "待核对" : <>{formatNum(review.projectedItemsSold)}<small>件</small></>}</strong></div>
      {isDuplicate ? <p className="pending-archive-title">相同文件和工作表已处理。本次不改变历史底表或累计销量。</p> : <>
        {previousPeriods.length > 0 && <><p className="pending-archive-title">已有周期报告（确认覆盖后保留归档，销量只计算一次）：</p><ul className="pending-period-list">{previousPeriods.map(period => <li key={`${period.periodStart}|${period.periodEnd}`}><div><strong>{period.periodStart} 至 {period.periodEnd}</strong><span>{formatNum(period.recordCount)} 条记录 · {formatNum(period.itemsSold)} 件出单{period.partialOverlap ? " · 仅部分重叠" : ""}</span></div><small>{(period.sourceFiles || []).join("、") || "已有视频报表"}</small></li>)}</ul></>}
        {previousBaselines.length > 0 && <><p className="pending-archive-title">涉及已有历史底表：</p><ul className="pending-period-list">{previousBaselines.map((baseline: RecordItem, index: number) => <li key={baseline.id || index}><div><strong>截至 {baseline.cutoffDate}</strong><span>{formatNum(baseline.recordCount ?? baseline.records?.length)} 条视频记录</span></div><small>{baseline.fileName || "历史底表"}</small></li>)}</ul></>}
        {num(review.duplicateRows) > 0 && <p className="pending-archive-title">文件内 {formatNum(review.duplicateRows)} 条重复历史视频记录会合并，同一视频取最高出单。</p>}
        {num(review.maxResolvedRows) > 0 && <p className="pending-archive-title">有 {formatNum(review.maxResolvedRows)} 条重复记录存在不同出单数，已按每个视频的最高出单值取用，其他指标保留对应源行。</p>}
        {!previousPeriods.length && !previousBaselines.length && <p className="pending-archive-title">{isBaseline ? "这份历史底表将作为之后按周期累计的起点。" : "这个统计区间与已确认报表不重叠，可以作为新一期数据累计。"}</p>}
      </>}
      {blocked ? <div className="pending-error" role="alert"><AlertCircle size={16} /><span>{review.baselineOverlaps?.length ? "此统计周期已包含在历史底表中。请选择截止日之后的新周期；若要更新全部历史，请使用历史底表方式。" : "新范围未完整覆盖旧报告，或存在无法确定归属的数据。请核对日期和来源后重新预览。"}</span></div> : !isDuplicate && review.requiresOverlapConfirmation && <label className="checkbox-line pending-confirm-check"><input type="checkbox" checked={draft.replaceOverlapping} onChange={e => onDraftChange("replaceOverlapping", e.target.checked)} disabled={saving} /><span>{isBaseline ? "确认这份文件包含截至该日期的全部历史数据" : "确认这份报表完整覆盖以上统计区间"}<span className="subtext">原记录保留归档，以本文件计算已覆盖范围的销量，避免重复累计。</span></span></label>}
      <div className="pending-review-actions"><span><ShieldCheck size={14} />确认后更新收样关联、累计出单、GMV 与达人等级</span><button className="button primary" onClick={onConfirm} disabled={saving || blocked || (!isDuplicate && review.requiresOverlapConfirmation && !draft.replaceOverlapping)}>{saving ? <Loader2 className="spin" size={15} /> : <Check size={15} />}{isDuplicate ? "跳过重复文件" : isBaseline ? "确认建立历史底表" : "确认更新累计数据"}</button></div>
    </div>}
  </section>;
}
function Stat({ title, value, unit, icon: Icon, detail, color }: any) { return <div className="stat-card"><div className="stat-top"><span>{title}</span><div className={`stat-icon ${color}`}><Icon size={19} /></div></div><div className="stat-value">{value}<span>{unit}</span></div><div className="stat-detail">{detail}</div></div>; }
function MiniStat({ label, value, missingLabel }: any) { return <div className="mini-stat"><span>{label}</span><strong>{value == null && missingLabel ? missingLabel : formatNum(value)}</strong></div>; }
function CreatorIdentity({ row, detail }: { row: RecordItem; detail?: string }) { return <div className="creator-identity"><div className={avatarClass(row.creatorId)}>{initials(row.creatorId)}</div><div><strong title={text(row.creatorId)}>{row.creatorId ? `@${row.creatorId}` : "达人待关联"}</strong>{!row.creatorId && row.buyerUsername && <small title="All Orders 的 Buyer Username 对应达人 ID">订单达人：{text(row.buyerUsername)}</small>}{row.creatorIdentityConflict && <small className="identity-conflict" title="历史手工达人与 Buyer Username 不一致，已保留手工关联">账号待核对 · Buyer @{text(row.buyerUsername)}</small>}{detail && <small>{detail}</small>}</div></div>; }

function CreatorPlaybackDetails({ creator }: { creator: RecordItem }) {
  const baseline = creatorPlaybackNumber(creator.cumulativeVideoViewsBaseline), periods = creatorPlaybackNumber(creator.cumulativeVideoViewsPeriodTotal);
  const cutoff = text(creator.cumulativeVideoViewsBaselineCutoff), issue = creatorPlaybackIssueLabel(creator);
  return <section className="creator-playback-breakdown" aria-label="累计播放量拆分">
    <div className="creator-playback-breakdown-heading"><h3>累计播放量拆分</h3>{issue && <span className="creator-playback-warning"><AlertCircle size={14} aria-hidden="true" />{issue}</span>}</div>
    <dl>
      <div><dt>历史播放底数</dt><dd className={baseline === null ? "creator-playback-missing" : ""}>{baseline === null ? "未提供" : `${formatNum(baseline)} 次`}</dd></div>
      <div><dt>{baseline !== null || cutoff ? "后续已确认期间播放" : "已确认期间播放"}</dt><dd className={periods === null ? "creator-playback-missing" : ""}>{periods === null ? "待补充或确认" : `${formatNum(periods)} 次`}</dd></div>
      <div><dt>历史底表截止日（含当日）</dt><dd className={!cutoff ? "creator-playback-missing" : ""}>{cutoff ? dateText(cutoff) : baseline !== null ? creator.cumulativeVideoViewsCoverageStatus === "needs_review" ? "待核对" : "待确认" : "未设置"}</dd></div>
    </dl>
    <p>{text(creator.cumulativeVideoViewsCoverage) || "累计采用历史播放底数与其后已确认、不重叠期间的播放；未提供的分项保留为空。"}</p>
    <p className="creator-playback-explanation">缺少的分项不按 0 补齐；历史底数已覆盖的期间不重复累加。期间跨越截止日或存在重叠冲突时，保留提示供核对。</p>
  </section>;
}

function ContributionVideoStatus({ product }: { product: RecordItem }) {
  if (num(product.itemsSold) <= 0) return <p className="contribution-video-status">暂无已确认出单</p>;
  if (!hasPositiveContributionVideo(product)) return <p className="contribution-video-status">已有确认出单，最高视频信息待补充</p>;
  const url = safeUrl(product.topVideoUrl);
  return url ? <a className="contribution-video-link" href={url} target="_blank" rel="noreferrer"><Link2 size={13} />最高出单视频 · 累计 {formatNum(product.topVideoItemsSold)} 件<ExternalLink size={12} /></a> : <p className="contribution-video-status">最高出单视频 · 累计 {formatNum(product.topVideoItemsSold)} 件 · 链接待补充</p>;
}

function PromotionSellingCreators({ value }: { value: unknown }) {
  const creators = (Array.isArray(value) ? value : text(value).split(/[,，、;；\n\r]+/)).map(creator => text(creator).trim()).filter(Boolean);
  if (!creators.length) return <span className="muted" aria-label="暂无出单达人">—</span>;
  const previewCount = 3, remaining = creators.slice(previewCount);
  const renderCreator = (creator: string, index: number) => <li key={`${index}-${creator}`}>{creator}</li>;
  return <div className="promotion-selling-creators">
    <ul className="promotion-selling-creators-list" aria-label={remaining.length ? "出单达人名单前 3 位" : "出单达人名单"}>{creators.slice(0, previewCount).map(renderCreator)}</ul>
    {remaining.length > 0 && <details className="promotion-selling-creators-details">
      <summary><ChevronRight size={12} aria-hidden="true" /><span className="selling-creators-expand">展开其余 {formatNum(remaining.length)} 位达人</span><span className="selling-creators-collapse">收起其余达人</span></summary>
      <div className="promotion-selling-creators-scroll" role="region" tabIndex={0} aria-label={`其余 ${formatNum(remaining.length)} 位出单达人，可滚动查看`}>
        <ul className="promotion-selling-creators-list">{remaining.map((creator, index) => renderCreator(creator, index + previewCount))}</ul>
      </div>
    </details>}
  </div>;
}

function PrimarySalesVideoLinks({ row }: { row: RecordItem }) {
  const videos: RecordItem[] = row.primarySalesVideos || [];
  const detailMode = row.sellingVideoSourceMode || row.salesDisplayMode;
  const reference = isPromotionReference(detailMode);
  const renderVideo = (video: RecordItem, index: number) => <div className="primary-sales-video" key={video.videoId || index}>
    <div>{safeUrl(video.url) ? <a href={safeUrl(video.url)} target="_blank" rel="noreferrer">{index === 0 ? "主要出单视频" : `出单视频 ${index + 1}`}<ExternalLink size={11} /></a> : <span title={text(video.videoId)}>{index === 0 ? "主要视频链接待补" : `视频 ${index + 1} 链接待补`}</span>}{video.isViral && <Badge tone="amber">爆款</Badge>}</div>
    <small>{formatNum(video.itemsSold)} 件{reference ? ` · ${promotionSourceLabel(detailMode) || "参考"}` : " · 当期出单"}</small>
  </div>;
  if (videos.length) return <div className="primary-sales-links">{videos.slice(0, 2).map(renderVideo)}{videos.length > 2 && <details><summary>查看其余 {formatNum(videos.length - 2)} 条出单视频</summary>{videos.slice(2).map((video, index) => renderVideo(video, index + 2))}</details>}</div>;
  const historicalLinks = row.salesDisplayMode === "historical-promotion" ? linksOf(row) : [];
  if (historicalLinks.length) return <div className="link-stack">{historicalLinks.slice(0, 2).map((link, index) => <a key={link} href={link} target="_blank" rel="noreferrer">历史手填链接 {index + 1}<ExternalLink size={11} /></a>)}<small className="cell-sub">无逐视频销量，暂不判定爆款</small></div>;
  return <span className="muted small-text">{row.sellingVideoCount == null ? "待导入或确认视频报表" : "暂无正销量视频"}</span>;
}

function SampleVideoCandidates({ sample, draft, allSamples, editable, onChange }: { sample: RecordItem; draft: RecordItem; allSamples: RecordItem[]; editable: boolean; onChange: (value: string) => void }) {
  const rows: RecordItem[] = sample.candidateVideos || [];
  const selectedLinks = unique(text(draft.videoLinksText).split(/\n/).map(safeUrl).filter(Boolean));
  const selectedIds = new Set(E.videoIdsFromLinks(selectedLinks));
  const identityChanged = ["creatorId", "skuId", "sku", "productId", "date"].some(key => text(draft[key]).slice(0, key === "date" ? 10 : undefined) !== text(sample[key]).slice(0, key === "date" ? 10 : undefined));
  return <section className="sample-video-candidates" aria-label="收样候选视频">
    <div className="candidate-heading"><Link2 size={17} /><div><h3>候选视频 · 人工确认</h3><p>依据已保存的达人、产品和寄样时间推荐。视频报表没有收样订单号，请打开视频核对内容。</p></div><Badge tone="blue">{formatNum(rows.length)} 条</Badge></div>
    {identityChanged ? <p className="candidate-empty">达人、产品或日期已修改。先保存记录，再查看更新后的候选视频。</p> : rows.length ? <div className="candidate-list">{rows.map((video, index) => {
      const url = safeUrl(video.url), selected = !!url && (selectedLinks.includes(url) || selectedIds.has(video.videoId));
      const usedByOthers = allSamples.filter(other => other.id !== sample.id && cid(other.creatorId) === cid(sample.creatorId) && E.videoIdsFromLinks(linksOf(other)).includes(video.videoId)).length;
      return <article className={`candidate-row${selected ? " selected" : ""}`} key={`${video.videoId}-${index}`}>
        <div className="candidate-row-title">{url ? <a href={url} target="_blank" rel="noreferrer">打开候选视频 {index + 1}<ExternalLink size={12} /></a> : <strong>视频 {text(video.videoId) || index + 1}</strong>}<span>发布 {dateText(video.postDate)}</span></div>
        <p>PID {text(video.productId) || "待核对"} · {video.publicationOnly ? "发布记录；销量以出单报表为准" : video.pendingPeriod ? "销售期间待确认" : `确认累计出单 ${formatNum(video.itemsSold)} 件`}</p>
        {usedByOthers > 0 && <small className="candidate-used">已在其他 {formatNum(usedByOthers)} 条收样中确认，请核对是否属于本次合作。</small>}
        {editable && url && <button type="button" className={`button small${selected ? "" : " primary"}`} aria-pressed={selected} onClick={() => onChange(selected ? selectedLinks.filter(link => link !== url && !E.videoIdsFromLinks([link]).includes(video.videoId)).join("\n") : [...selectedLinks, url].join("\n"))}>{selected ? <Check size={13} /> : <Plus size={13} />}{selected ? "已选入 · 点击移除" : "选为本次收样视频"}</button>}
      </article>;
    })}</div> : <p className="candidate-empty">暂未找到候选。可以直接在上方填入向达人索取或手动找到的视频链接。</p>}
    {editable && <p className="candidate-footnote">选入后请点击底部“保存记录”。未选入的候选不算本次收样已发视频，也不计入本条收样的关联出单。</p>}
  </section>;
}
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) { return <label className="search-box"><Search size={16} /><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />{value && <button aria-label="清空搜索" onClick={() => onChange("")}><X size={13} /></button>}</label>; }
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Drawer({ title, subtitle, children, footer, onClose }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode; onClose: () => void }) {
  return <div className="overlay" role="presentation"><button className="overlay-scrim" aria-label="关闭详情" onClick={onClose} /><section className="drawer" role="dialog" aria-modal="true" aria-label={title}><div className="drawer-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="关闭详情" onClick={onClose}><X size={21} /></button></div><div className="drawer-content">{children}</div><div className="drawer-footer">{footer}</div></section></div>;
}
function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) { return <div className="overlay centered" role="presentation"><button className="overlay-scrim" aria-label="关闭弹窗" onClick={onClose} /><section className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><div className="drawer-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button></div><div className="modal-content">{children}</div></section></div>; }

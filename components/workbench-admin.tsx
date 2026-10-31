"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserCheck, UserRoundCog, UserRoundX, Users, X } from "lucide-react";
import "./workbench-admin.css";

type Role = "admin" | "viewer";
type Account = { id: string; username: string; role: Role; active: boolean; createdAt: string; updatedAt: string; isCurrent: boolean };
type AccountList = { accounts: Account[]; currentAccountId: string; activeAdminCount: number };
type Action = { kind: "create" } | { kind: "role" | "status" | "reset" | "delete"; account: Account };
type Notice = { kind: "success" | "error"; message: string } | null;
type ApiRequest = (path: string, method?: string, body?: Record<string, unknown>) => Promise<Record<string, unknown>>;
const roleName = (role: Role) => role === "admin" ? "管理员" : "普通账号";
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
};

function parseList(value: Record<string, unknown>): AccountList {
  if (!Array.isArray(value.accounts) || typeof value.currentAccountId !== "string" || !Number.isSafeInteger(value.activeAdminCount) || Number(value.activeAdminCount) < 0) throw new Error("账号列表格式不完整，请刷新重试。");
  const accounts = value.accounts.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("账号列表格式不完整，请刷新重试。");
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || typeof row.username !== "string" || !["admin", "viewer"].includes(String(row.role)) || typeof row.active !== "boolean") throw new Error("账号列表格式不完整，请刷新重试。");
    return { id: row.id, username: row.username, role: row.role as Role, active: row.active, createdAt: typeof row.createdAt === "string" ? row.createdAt : "", updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "", isCurrent: row.id === value.currentAccountId };
  });
  return { accounts, currentAccountId: value.currentAccountId, activeAdminCount: Number(value.activeAdminCount) };
}

export default function WorkbenchAdmin({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [data, setData] = useState<AccountList | null>(null);
  const [loading, setLoading] = useState(true), [notice, setNotice] = useState<Notice>(null);
  const [search, setSearch] = useState(""), [status, setStatus] = useState("all");
  const [action, setAction] = useState<Action | null>(null);
  const alive = useRef(true), loadSequence = useRef(0);

  const api = useCallback<ApiRequest>(async (path, method = "GET", body) => {
    const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const raw = await response.json().catch(() => null);
    const result = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    if (response.status === 401) { onSessionExpired(); throw new Error("登录已失效，请重新登录。"); }
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "账号操作未完成，请稍后重试。");
    return result;
  }, [onSessionExpired]);

  const load = useCallback(async (successMessage?: string) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    if (!successMessage) setNotice(null);
    try {
      const next = parseList(await api("/api/admin/accounts"));
      if (!alive.current || sequence !== loadSequence.current) return;
      setData(next);
      if (successMessage) setNotice({ kind: "success", message: successMessage });
    } catch (error) {
      if (alive.current && sequence === loadSequence.current) setNotice({ kind: "error", message: (successMessage ? successMessage + " 但列表刷新未完成，请点击“刷新列表”核对。 " : "") + (error instanceof Error ? error.message : "读取账号列表失败，请重试。") });
    } finally { if (alive.current && sequence === loadSequence.current) setLoading(false); }
  }, [api]);

  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; loadSequence.current++; }; }, [load]);
  const rows = useMemo(() => (data?.accounts || []).filter(account => (!search || account.username.toLowerCase().includes(search.trim().toLowerCase())) && (status === "all" || account.active === (status === "active"))), [data, search, status]);
  const activeCount = (data?.accounts || []).filter(account => account.active).length;
  const openAction = (next: Action) => { setNotice(null); setAction(next); };
  const complete = (message: string) => { setAction(null); void load(message); };

  return <section className="workbench-admin" aria-labelledby="wa-section-heading">
    <div className="wa-intro">
      <div><span className="wa-eyebrow">ACCOUNT MANAGEMENT</span><h2 id="wa-section-heading">管理每个人的访问权限</h2><p>添加合作账号，按需要调整权限，随时收回访问。</p></div>
      <button type="button" className="wa-button wa-primary" disabled={loading || !data} onClick={() => openAction({ kind: "create" })}><Plus size={16} aria-hidden="true" />新增账号</button>
    </div>

    <div className="wa-summary" aria-label="账号概览">
      <div><span className="wa-summary-icon"><Users size={19} aria-hidden="true" /></span><span>全部账号<strong>{data ? data.accounts.length : "—"}</strong></span></div>
      <div><span className="wa-summary-icon"><ShieldCheck size={19} aria-hidden="true" /></span><span>有效管理员<strong>{data ? data.activeAdminCount : "—"}</strong></span></div>
      <div><span className="wa-summary-icon"><UserCheck size={19} aria-hidden="true" /></span><span>使用中的账号<strong>{data ? activeCount : "—"}</strong></span></div>
    </div>

    <div className="wa-permissions">
      <ShieldCheck size={19} aria-hidden="true" />
      <div><strong>所有账号使用同一份工作台资料</strong><p>普通账号可查看、筛选、排序和导出；管理员还可导入、编辑资料、维护规则和管理账号。停用后可恢复；删除账号不删除达人、收样等业务资料。</p></div>
    </div>

    {notice && <div className={"wa-notice " + notice.kind} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}<span>{notice.message}</span></div>}

    <div className="wa-account-card">
      <div className="wa-table-heading"><div><h3>账号列表</h3><p>{data ? "共 " + data.accounts.length + " 个账号" : "读取账号信息"}</p></div><button type="button" className="wa-button wa-quiet" disabled={loading} onClick={() => void load()}><RefreshCw size={15} className={loading ? "wa-spin" : ""} aria-hidden="true" />刷新列表</button></div>
      <div className="wa-filters">
        <label className="wa-search"><Search size={16} aria-hidden="true" /><span className="wa-sr-only">搜索账号</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索账号名称" type="search" /></label>
        <label className="wa-status-filter"><span className="wa-sr-only">筛选账号状态</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option><option value="active">使用中</option><option value="inactive">已停用</option></select></label>
      </div>
      <div className="wa-table-scroll" aria-busy={loading}>
        <table className="wa-account-table">
          <thead><tr><th scope="col">账号</th><th scope="col">权限</th><th scope="col">状态</th><th scope="col">创建时间</th><th scope="col">管理操作</th></tr></thead>
          <tbody>{!data ? <tr><td colSpan={5}><div className="wa-empty">{loading ? <><Loader2 size={23} className="wa-spin" aria-hidden="true" /><strong>正在读取账号列表</strong></> : <><AlertCircle size={24} aria-hidden="true" /><strong>暂时无法读取账号</strong><span>请点击“刷新列表”重试。</span></>}</div></td></tr> : !rows.length ? <tr><td colSpan={5}><div className="wa-empty"><Search size={23} aria-hidden="true" /><strong>没有符合条件的账号</strong><span>试试其他账号名称或状态。</span></div></td></tr> : rows.map(account => {
            const lastAdmin = account.active && account.role === "admin" && data.activeAdminCount <= 1;
            const protectedAccount = account.isCurrent || lastAdmin;
            const protectedReason = account.isCurrent ? "不能停用、删除或降低当前登录账号的权限" : lastAdmin ? "至少保留一个使用中的管理员" : "";
            return <tr key={account.id} className={!account.active ? "wa-inactive-row" : undefined}>
              <td><div className="wa-account-identity"><span className={"wa-avatar " + (account.role === "admin" ? "admin" : "")}>{account.username.slice(0, 1).toUpperCase()}</span><div><strong>{account.username}</strong>{account.isCurrent && <span className="wa-current">当前账号</span>}{lastAdmin && <small>最后一个有效管理员</small>}</div></div></td>
              <td><span className={"wa-badge " + account.role}>{account.role === "admin" && <ShieldCheck size={12} aria-hidden="true" />}{roleName(account.role)}</span></td>
              <td><span className={"wa-account-status " + (account.active ? "active" : "inactive")}><i aria-hidden="true" />{account.active ? "使用中" : "已停用"}</span></td>
              <td><time dateTime={account.createdAt || undefined} title={account.createdAt || undefined}>{dateLabel(account.createdAt)}</time></td>
              <td><div className="wa-row-actions">
                <button type="button" disabled={loading || protectedAccount} title={protectedReason || "修改账号权限"} onClick={() => openAction({ kind: "role", account })}><UserRoundCog size={14} aria-hidden="true" />权限</button>
                <button type="button" disabled={loading} onClick={() => openAction({ kind: "reset", account })}><KeyRound size={14} aria-hidden="true" />重置密码</button>
                <button type="button" disabled={loading || (account.active && protectedAccount)} title={account.active ? protectedReason || "停用后可再次启用" : "重新允许此账号登录"} onClick={() => openAction({ kind: "status", account })}>{account.active ? <UserRoundX size={14} aria-hidden="true" /> : <UserCheck size={14} aria-hidden="true" />}{account.active ? "停用" : "启用"}</button>
                <button type="button" className="wa-delete-button" disabled={loading || protectedAccount} title={protectedReason || "删除账号"} onClick={() => openAction({ kind: "delete", account })}><Trash2 size={14} aria-hidden="true" />删除</button>
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="wa-table-footnote">至少保留一个使用中的管理员。当前登录账号不能停用、删除或降为普通账号。</div>
    </div>
    <p className="wa-session-note"><KeyRound size={15} aria-hidden="true" /><span>停用、删除、修改权限或重置密码后，该账号原有登录会话会失效。已经保存的截图或导出文件不会被收回。</span></p>
    {action && <AccountDialog action={action} api={api} onClose={() => setAction(null)} onComplete={complete} onSessionExpired={onSessionExpired} />}
  </section>;
}

function AccountDialog({ action, api, onClose, onComplete, onSessionExpired }: { action: Action; api: ApiRequest; onClose: () => void; onComplete: (message: string) => void; onSessionExpired: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId();
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [role, setRole] = useState<Role>(action.kind === "role" ? action.account.role : "viewer");
  const [showPassword, setShowPassword] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const locked = useRef(false), mounted = useRef(true);
  const account = action.kind !== "create" ? action.account : null;
  const passwordAction = action.kind === "create" || action.kind === "reset";
  const title = action.kind === "create" ? "新增账号" : action.kind === "reset" ? "重置账号密码" : action.kind === "role" ? "修改账号权限" : action.kind === "delete" ? "删除账号" : account?.active ? "停用账号" : "启用账号";
  const danger = action.kind === "delete" || (action.kind === "status" && account?.active);
  const clearPassword = () => { setPassword(""); setConfirmation(""); setShowPassword(false); };
  const close = () => { if (locked.current) return; clearPassword(); onClose(); };
  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { mounted.current = false; if (element?.open) element.close(); };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current) return;
    setError("");
    if (action.kind === "create" && !username.trim()) { setError("请输入账号名称。"); return; }
    if (passwordAction && (password.length < 8 || password.length > 256)) { setError("新密码请使用 8–256 个字符。"); return; }
    if (passwordAction && password !== confirmation) { setError("两次输入的密码不一致，请重新核对。"); return; }
    if (action.kind === "role" && role === action.account.role) return;
    locked.current = true; setBusy(true);
    try {
      let result: Record<string, unknown>, message: string;
      if (action.kind === "create") {
        result = await api("/api/admin/accounts", "POST", { username: username.trim(), password, role });
        const created = result.account && typeof result.account === "object" ? result.account as Record<string, unknown> : {};
        message = "已创建" + roleName(role) + "「" + (typeof created.username === "string" ? created.username : username.trim()) + "」。";
      } else {
        const path = "/api/admin/accounts/" + encodeURIComponent(action.account.id);
        if (action.kind === "delete") { result = await api(path, "DELETE", {}); message = "已删除账号「" + action.account.username + "」，工作台业务资料已保留。"; }
        else if (action.kind === "status") { result = await api(path, "PATCH", { active: !action.account.active }); message = "已" + (action.account.active ? "停用" : "启用") + "账号「" + action.account.username + "」。"; }
        else if (action.kind === "role") { result = await api(path, "PATCH", { role }); message = "已将「" + action.account.username + "」设为" + roleName(role) + "，该账号需要重新登录。"; }
        else { result = await api(path, "PATCH", { password }); message = "已重置「" + action.account.username + "」的密码，原有登录会话已失效。"; }
      }
      if (!mounted.current) return;
      clearPassword();
      if (action.kind !== "create" && action.account.isCurrent && (result.sessionRevoked === true || action.kind === "reset")) { onSessionExpired(); return; }
      onComplete(message);
    } catch (cause) {
      if (mounted.current) { if (passwordAction) clearPassword(); setError(cause instanceof Error ? cause.message : "操作未完成，请稍后重试。"); }
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  };

  return <dialog ref={dialog} className="wa-dialog" aria-labelledby={id + "-title"} aria-describedby={id + "-description"} onCancel={event => { event.preventDefault(); close(); }}>
    <form onSubmit={submit}>
      <div className="wa-dialog-heading"><div className={"wa-dialog-symbol " + (danger ? "danger" : "")}>{action.kind === "delete" ? <Trash2 size={22} aria-hidden="true" /> : action.kind === "reset" ? <KeyRound size={22} aria-hidden="true" /> : <UserRoundCog size={22} aria-hidden="true" />}</div><button type="button" className="wa-dialog-close" onClick={close} aria-label="关闭账号管理弹窗" disabled={busy}><X size={19} aria-hidden="true" /></button></div>
      <h2 id={id + "-title"}>{title}</h2>
      <p className="wa-dialog-description" id={id + "-description"}>{action.kind === "create" ? "设置账号和初始密码，选择此账号可以进行的操作。" : action.kind === "delete" ? "删除后，该账号将无法继续登录，已有登录会话也会失效。需要再次使用时，需重新创建账号。" : action.kind === "status" ? account?.active ? "停用后，该账号无法继续登录，已有登录会话会失效。以后可以重新启用。" : "启用后，此账号可使用原密码重新登录。" : action.kind === "reset" ? account?.isCurrent ? "保存后，你当前的登录也会失效，请使用新密码重新登录。" : "设置新密码后，此账号的所有原有登录会话都会失效。" : "保存后，此账号的原有登录会话会失效，重新登录后使用新权限。"}</p>
      {account && <div className="wa-target-account"><span>操作账号</span><strong>{account.username}</strong><small>{roleName(account.role)} · {account.active ? "使用中" : "已停用"}{account.isCurrent ? " · 当前账号" : ""}</small></div>}
      <fieldset className="wa-fields" disabled={busy}>
        {action.kind === "create" && <label className="wa-field" htmlFor={id + "-username"}><span>账号名称</span><input id={id + "-username"} name="new-account-username" value={username} onChange={event => setUsername(event.target.value)} maxLength={254} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="填写账号名或邮箱" autoFocus required /><small>账号名称不区分大小写，不能与已有账号重复。</small></label>}
        {(action.kind === "create" || action.kind === "role") && <label className="wa-field" htmlFor={id + "-role"}><span>账号权限</span><select id={id + "-role"} value={role} onChange={event => setRole(event.target.value as Role)} autoFocus={action.kind === "role"}><option value="viewer">普通账号</option><option value="admin">管理员</option></select><small>{role === "admin" ? "可维护全部工作台资料、统计规则和账号权限。" : "可查看、筛选、排序和导出工作台资料。"}</small></label>}
        {passwordAction && <>
          <label className="wa-field" htmlFor={id + "-password"}><span>{action.kind === "create" ? "初始密码" : "新密码"}</span><div className="wa-password-input"><input id={id + "-password"} name="new-account-password" type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} minLength={8} maxLength={256} autoComplete="new-password" autoCapitalize="none" spellCheck={false} placeholder="输入 8–256 个字符" autoFocus={action.kind === "reset"} required /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button></div></label>
          <label className="wa-field" htmlFor={id + "-confirm"}><span>确认密码</span><input id={id + "-confirm"} name="new-account-password-confirmation" type={showPassword ? "text" : "password"} value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={8} maxLength={256} autoComplete="new-password" autoCapitalize="none" spellCheck={false} placeholder="再次输入密码" required /><small>密码保存后不会在账号列表中显示。</small></label>
        </>}
      </fieldset>
      {action.kind === "delete" && <p className="wa-dialog-note">此操作只删除登录账号，达人档案、收样记录、推广记录和备注均会保留。</p>}
      {action.kind === "reset" && !account?.active && <p className="wa-dialog-note">此账号目前已停用。重置密码不会自动启用账号。</p>}
      {action.kind === "role" && role === "admin" && <p className="wa-dialog-note">设为管理员后，对方也可以新增、停用或删除其他账号。</p>}
      {error && <p className="wa-dialog-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{error}</span></p>}
      <div className="wa-dialog-footer"><button type="button" className="wa-button wa-secondary" onClick={close} disabled={busy} autoFocus={action.kind === "delete" || action.kind === "status"}>取消</button><button type="submit" className={"wa-button " + (danger ? "wa-danger" : "wa-primary")} disabled={busy || (action.kind === "role" && role === action.account.role)}>{busy ? <><Loader2 size={16} className="wa-spin" aria-hidden="true" />正在保存</> : action.kind === "create" ? "创建账号" : action.kind === "reset" ? "确认重置密码" : action.kind === "role" ? "确认设为" + roleName(role) : action.kind === "delete" ? "确认删除账号" : account?.active ? "确认停用账号" : "确认启用账号"}</button></div>
    </form>
  </dialog>;
}

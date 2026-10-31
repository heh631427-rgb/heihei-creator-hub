"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BarChart3, Check, Eye, EyeOff, Loader2, LockKeyhole, Package, RefreshCw, ShieldCheck, Users } from "lucide-react";
import CreatorWorkbench from "./creator-workbench";

export type WorkbenchUser = { username: string; role: "admin" | "viewer" };

async function readResponse(response: Response): Promise<{ user?: unknown; error?: string }> {
  const value = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = value as Record<string, unknown>;
  return { user: result.user, error: typeof result.error === "string" ? result.error : undefined };
}

function readUser(value: unknown): WorkbenchUser | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.username === "string" && ["admin", "viewer"].includes(String(candidate.role))
    ? { username: candidate.username, role: candidate.role as WorkbenchUser["role"] }
    : null;
}

export default function WorkbenchAuth() {
  const [user, setUser] = useState<WorkbenchUser | null>(null);
  const [checking, setChecking] = useState(true), [checkError, setCheckError] = useState("");
  const [sessionNotice, setSessionNotice] = useState(""), [loggingOut, setLoggingOut] = useState(false);
  const sessionGeneration = useRef(0);

  const expireSession = useCallback(() => {
    sessionGeneration.current++;
    setUser(null); setSessionNotice("登录已失效，请重新登录。"); setChecking(false);
  }, []);

  const checkSession = useCallback(async (initial = false) => {
    const generation = sessionGeneration.current;
    if (initial) { setChecking(true); setCheckError(""); }
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
      if (generation !== sessionGeneration.current) return;
      if (response.status === 401) { if (!initial) setSessionNotice("登录已失效，请重新登录。"); setUser(null); return; }
      const result = await readResponse(response);
      if (generation !== sessionGeneration.current) return;
      if (!response.ok) throw new Error(result.error || "暂时无法连接账号服务，请稍后重试。");
      const nextUser = readUser(result.user);
      if (!initial && !nextUser) setSessionNotice("登录已失效，请重新登录。");
      setUser(nextUser);
    } catch (error) {
      if (initial) setCheckError(error instanceof Error ? error.message : "暂时无法连接账号服务，请稍后重试。");
    } finally { if (initial) setChecking(false); }
  }, []);

  useEffect(() => { void checkSession(true); }, [checkSession]);
  useEffect(() => {
    if (!user) return;
    const onFocus = () => { void checkSession(); };
    const timer = window.setInterval(onFocus, 60000);
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [user?.username, user?.role, checkSession]);

  const logout = useCallback(async () => {
    sessionGeneration.current++;
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok && response.status !== 401) {
        const result = await readResponse(response);
        throw new Error(result.error || "退出未完成，请重试。");
      }
      setUser(null); setSessionNotice("已退出登录。");
    } finally { setLoggingOut(false); }
  }, []);

  if (checking) return <main className="auth-checking"><div className="auth-mark">h<span>.</span></div><h1>heihei达人工作台</h1><p><Loader2 size={17} className="spin" />正在验证登录状态</p></main>;
  if (checkError) return <main className="auth-checking"><div className="auth-mark">h<span>.</span></div><h1>heihei达人工作台</h1><p role="alert">{checkError}</p><button className="button primary" onClick={() => void checkSession(true)}><RefreshCw size={16} />重新连接</button></main>;
  if (user) return <CreatorWorkbench key={`${user.username}:${user.role}`} user={user} onLogout={logout} loggingOut={loggingOut} onSessionExpired={expireSession} />;
  return <LoginScreen notice={sessionNotice} onLogin={next => { sessionGeneration.current++; setSessionNotice(""); setUser(next); }} />;
}

function LoginScreen({ notice, onLogin }: { notice: string; onLogin: (user: WorkbenchUser) => void }) {
  const [username, setUsername] = useState(""), [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (pending) return;
    if (!username.trim() || !password) { setError("请输入账号和密码。"); return; }
    setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: username.trim(), password }) });
      const result = await readResponse(response); const authenticated = readUser(result.user);
      if (!response.ok || !authenticated) throw new Error(result.error || "账号或密码不正确，请重新输入。");
      setPassword(""); onLogin(authenticated);
    } catch (cause) { setPassword(""); setError(cause instanceof Error ? cause.message : "登录未完成，请重试。"); }
    finally { setPending(false); }
  };
  return <main className="auth-page">
    <section className="auth-story" aria-label="工作台介绍">
      <div className="auth-brand"><div className="auth-mark">h<span>.</span></div><span>heihei达人工作台<small>CREATOR WORKSPACE</small></span></div>
      <div className="auth-story-main"><span className="auth-eyebrow">合作有记录，增长有方向</span><h1>把每一次合作，<br />连接起来。</h1><p>从收样到视频，从月度推广到达人分层。<br />在同一个工作台，掌握合作的每一步。</p>
        <div className="auth-feature-list">{[[Package,"收样记录","追踪样品进度与视频回传"],[BarChart3,"月度推广","按产品汇总出单与播放表现"],[Users,"达人分层","积累档案，发现长期合作伙伴"]].map(([Icon,title,detail]) => { const FeatureIcon = Icon as typeof Package; return <div className="auth-feature" key={String(title)}><span><FeatureIcon size={20} /></span><div><strong>{String(title)}</strong><small>{String(detail)}</small></div><Check size={15} /></div>; })}</div>
      </div><div className="auth-story-footer"><span className="live-dot" />西班牙 · TikTok Shop 合作管理</div>
    </section>
    <section className="auth-form-side" aria-labelledby="login-heading"><div className="auth-login-card"><div className="auth-login-icon"><LockKeyhole size={25} /></div><span className="auth-eyebrow">欢迎回来</span><h2 id="login-heading">登录工作台</h2><p className="auth-form-intro">使用你的工作台账号和密码登录。</p>
      {notice && !error && <p className="auth-message" role="status">{notice}</p>}
      <form onSubmit={submit} className="auth-form">
        <label htmlFor="workbench-username">账号<input id="workbench-username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} placeholder="输入账号" value={username} onChange={event => setUsername(event.target.value)} disabled={pending} required /></label>
        <label htmlFor="workbench-password">密码<span className="auth-password-field"><input id="workbench-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" maxLength={256} placeholder="输入密码" value={password} onChange={event => setPassword(event.target.value)} disabled={pending} required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} disabled={pending}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="auth-submit" disabled={pending}>{pending ? <><Loader2 size={18} className="spin" />正在登录</> : <>登录<ArrowRight size={18} /></>}</button>
      </form>
      <div className="auth-permissions"><ShieldCheck size={18} /><div><strong>按账号权限进入工作台</strong><p>管理员可维护数据、规则与账号；普通账号可查看、筛选和导出。</p></div></div>
    </div><footer className="auth-form-footer">heihei达人工作台 <span>让数据连接每一次合作</span></footer></section>
  </main>;
}

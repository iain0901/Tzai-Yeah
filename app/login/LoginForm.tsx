"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { UserIdentity } from "@/lib/contracts";

type Result = { user?: UserIdentity | null; registrationOpen?: boolean; error?: string; returnTo?: string; message?: string };
async function request(path: string, body?: Record<string, unknown>): Promise<Result> {
  const response = await fetch(`/api/auth/${path}`, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json() as Result;
  if (!response.ok) throw new Error(data.error || "目前無法完成，請稍後再試。");
  return data;
}

export default function LoginForm({ returnTo }: { returnTo: string }) {
  const [user, setUser] = useState<UserIdentity | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [changePassword, setChangePassword] = useState(false);

  useEffect(() => { let active = true; void request("session").then(data => { if (active) { setUser(data.user || null); setRegistrationOpen(data.registrationOpen !== false); } }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setReady(true); }); return () => { active = false; }; }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    setBusy(true); setError(""); setMessage("");
    try { const data = await request(mode, { ...values, returnTo }); window.location.assign(data.returnTo || "/"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "連線中斷，請再試一次。"); setBusy(false); }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const values = Object.fromEntries(new FormData(formElement).entries());
    if (values.password !== values.confirmPassword) { setError("兩次輸入的新密碼不同，請確認。"); return; }
    setBusy(true); setError(""); setMessage("");
    try { const data = await request("password", values); setMessage(data.message || "密碼已更新。"); formElement.reset(); setChangePassword(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "連線中斷，請再試一次。"); }
    finally { setBusy(false); }
  }

  async function logout() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await request("logout", {}); setUser(null); setMode("login"); setChangePassword(false); setMessage("已登出。下次見，小屋會在這裡等你。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "連線中斷，請再試一次。"); }
    finally { setBusy(false); }
  }

  if (!ready) return <div className="auth-loading" role="status">正在為你打開小屋…</div>;
  return <>
    <h1>{user ? `嗨，${user.name}。` : mode === "register" ? "留一個名字給小屋。" : "歡迎回到小屋。"}</h1>
    <p className="auth-intro">{user ? "你的小屋帳號已登入。" : "登入後，就能用認領碼設定自己的小卡。"}</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {message && <p className="auth-message" role="status">{message}</p>}
    {user ? <>
      <div className="auth-account"><span>{user.email}</span><small>{user.role === "admin" ? "工作人員帳號" : "小屋會員"}</small></div>
      <a className="auth-button auth-primary" href={returnTo}>{returnTo.startsWith("/admin") ? "回到工作人員準備室" : "回到我的小屋"}<span aria-hidden="true">↗</span></a>
      {changePassword ? <form className="auth-form auth-password" onSubmit={updatePassword}>
        <label>目前密碼<input name="currentPassword" type="password" required maxLength={128} autoComplete="current-password" /></label>
        <label>新密碼<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="auth-password-help" /></label>
        <label>再輸入一次新密碼<input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
        <p className="auth-help" id="auth-password-help">使用 12～128 個字元。更新後，其他裝置需要重新登入。</p>
        <button className="auth-button auth-primary" disabled={busy}>{busy ? "正在儲存…" : "儲存新密碼"}</button>
      </form> : null}
      <div className="auth-account-actions"><button onClick={() => { setChangePassword(!changePassword); setError(""); }} disabled={busy}>{changePassword ? "取消修改" : "修改密碼"}</button><button onClick={() => void logout()} disabled={busy}>{busy ? "請稍候…" : "登出帳號"}</button></div>
    </> : <>
      {registrationOpen && <div className="auth-tabs" role="group" aria-label="帳號操作"><button aria-pressed={mode === "login"} onClick={() => { setMode("login"); setError(""); }} disabled={busy}>登入</button><button aria-pressed={mode === "register"} onClick={() => { setMode("register"); setError(""); }} disabled={busy}>建立帳號</button></div>}
      <form className="auth-form" onSubmit={submit} key={mode}>
        {mode === "register" && <label>怎麼稱呼你<input name="name" required maxLength={60} autoComplete="nickname" placeholder="你在小屋裡的名字" /></label>}
        <label>電子郵件<input name="email" type="email" required maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false} inputMode="email" placeholder="you@example.com" /></label>
        <label>密碼<input name="password" type="password" required minLength={mode === "register" ? 12 : undefined} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} aria-describedby="auth-help" /></label>
        <p className="auth-help" id="auth-help">{mode === "register" ? "密碼請使用 12～128 個字元。建立帳號後，仍需使用工作人員提供的認領碼認領小卡。" : "忘記密碼時，請聯絡主辦單位協助重設。"}</p>
        <button className="auth-button auth-primary" disabled={busy}>{busy ? "請稍候…" : mode === "register" ? "建立帳號，回到小屋" : "登入，回到小屋"}<span aria-hidden="true">→</span></button>
      </form>
      <a className="auth-back" href={returnTo}>先回小屋逛逛</a>
    </>}
  </>;
}

"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { ApiError, MeData, Profile } from "@/lib/contracts";
import "./profile-wizard.css";

const EMPTY_PROFILE: Profile = { displayName: "", bio: "", url: "", mode: "page" };
const STEPS = ["名字", "一句話", "連結與開啟方式"];
type FieldName = "displayName" | "bio" | "url" | "code";
type ValidationIssue = { field: FieldName; message: string; step: number };
type ProfileEditorProps = { token: string; onSaved: () => void };

function Symbol({ kind }: { kind: "arrow" | "back" | "check" | "key" | "link" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "arrow" ? <path d="M4 12h15m-6-6 6 6-6 6" /> : kind === "back" ? <path d="M20 12H5m6-6-6 6 6 6" /> : kind === "check" ? <path d="m5 12 4 4L19 6" /> : kind === "link" ? <><path d="m10 14 4-4" /><path d="m9 7 2-2a5 5 0 0 1 7 7l-2 2M15 17l-2 2a5 5 0 0 1-7-7l2-2" /></> : <><circle cx="8" cy="8" r="4" /><path d="m11 11 9 9m-4-4 3-3m-6 0 3-3" /></>}
  </svg>;
}

function validateProfile(form: Profile, through: number): ValidationIssue | null {
  if (!form.displayName.trim()) return { field: "displayName", message: "先留下想讓朋友稱呼你的名字。", step: 0 };
  if (form.displayName.trim().length > 40) return { field: "displayName", message: "名字請保持在 40 字以內。", step: 0 };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(form.displayName)) return { field: "displayName", message: "名字裡有無法使用的字元，請重新輸入。", step: 0 };
  if (through < 1) return null;
  if (form.bio.trim().length > 240) return { field: "bio", message: "這句話請保持在 240 字以內。", step: 1 };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(form.bio)) return { field: "bio", message: "文字裡有無法使用的字元，請重新輸入。", step: 1 };
  if (through < 2) return null;
  const raw = form.url.trim();
  if (!raw) return form.mode === "redirect" ? { field: "url", message: "直接開啟模式需要先填寫連結。", step: 2 } : null;
  if (raw.length > 2048) return { field: "url", message: "連結太長了，請使用 2048 字以內的網址。", step: 2 };
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    if (url.origin === window.location.origin) return { field: "url", message: "請填寫本站以外的社群或個人網址。", step: 2 };
  } catch { return { field: "url", message: "請貼上 https:// 開頭的完整連結。", step: 2 }; }
  return null;
}

export default function ProfileEditor(props: ProfileEditorProps) {
  return <ProfileEditorSession key={props.token} {...props} />;
}

function ProfileEditorSession({ token, onSaved }: ProfileEditorProps) {
  const id = useId();
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invalidField, setInvalidField] = useState<FieldName | null>(null);
  const [busy, setBusy] = useState<"claim" | "save" | null>(null);
  const [code, setCode] = useState("");
  const [form, setForm] = useState<Profile>({ ...EMPTY_PROFILE });
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [claimedNow, setClaimedNow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const dirty = useRef(false);
  const requestSequence = useRef(0);
  const pending = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const focusAfterStep = useRef(false);
  const mutationPending = useRef(false);

  const stopRequest = useCallback(() => {
    requestSequence.current += 1;
    if (pending.current) { clearTimeout(pending.current.timer); pending.current.controller.abort(); pending.current = null; }
  }, []);

  const load = useCallback(() => {
    stopRequest();
    const sequence = requestSequence.current, controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    pending.current = { controller, timer };
    return fetch(`/api/me?token=${encodeURIComponent(token)}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json() as MeData & Partial<ApiError>;
      if (!response.ok) throw new Error(body.error || "暫時無法讀取小卡。");
      if (!mounted.current || sequence !== requestSequence.current) return;
      setMe(body);
      if (body.isOwner) setCode("");
      if (!dirty.current) setForm(body.profile ? { ...body.profile } : { ...EMPTY_PROFILE });
    }).catch(reason => {
      if (!mounted.current || sequence !== requestSequence.current) return;
      if (timedOut) setError("連線有點慢，請再讀取一次。");
      else if (!(reason instanceof Error && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "連線中斷，請再試一次。");
    }).finally(() => {
      clearTimeout(timer);
      if (mounted.current && sequence === requestSequence.current) { pending.current = null; setLoading(false); }
    });
  }, [stopRequest, token]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; mutationPending.current = false; stopRequest(); };
  }, [load, stopRequest]);

  function retryLoad() {
    setLoading(true); setError(""); setInvalidField(null);
    void load();
  }

  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setViewportHeight(Math.round(viewport?.height ?? window.innerHeight))); };
    update(); viewport?.addEventListener("resize", update); window.addEventListener("resize", update);
    return () => { cancelAnimationFrame(frame); viewport?.removeEventListener("resize", update); window.removeEventListener("resize", update); };
  }, []);

  useEffect(() => {
    stageRef.current?.scrollTo({ top: 0, behavior: "instant" });
    if (!focusAfterStep.current) return;
    focusAfterStep.current = false;
    const frame = requestAnimationFrame(() => { stageRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not([type=radio]),textarea")?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [step]);

  function updateForm<K extends keyof Profile>(key: K, value: Profile[K]) {
    dirty.current = true; setForm(current => ({ ...current, [key]: value }));
    setError(""); setInvalidField(null); setClaimedNow(false);
  }
  function showValidation(issue: ValidationIssue) {
    setInvalidField(issue.field); setError(issue.message);
    if (step !== issue.step) { focusAfterStep.current = true; setDirection("back"); setStep(issue.step); }
    else requestAnimationFrame(() => rootRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${issue.field}"]`)?.focus({ preventScroll: true }));
  }
  function moveStep(next: number) {
    if (busy) return;
    if (next > step) { const issue = validateProfile(form, step); if (issue) { showValidation(issue); return; } }
    setDirection(next > step ? "forward" : "back"); focusAfterStep.current = true; setStep(next); setError(""); setInvalidField(null); setClaimedNow(false);
  }

  async function submit(kind: "claim" | "save") {
    if (mutationPending.current) return;
    let payload: object;
    if (kind === "claim") {
      const normalized = code.trim().toLowerCase().replace(/[\s-]/g, "");
      if (!/^[a-f0-9]{32}$/.test(normalized)) {
        setInvalidField("code"); setError("認領碼不完整，請重新貼上主辦單位提供的認領碼。");
        rootRef.current?.querySelector<HTMLInputElement>('[name="code"]')?.focus({ preventScroll: true }); return;
      }
      payload = { token, code: normalized };
    } else {
      const issue = validateProfile(form, 2); if (issue) { showValidation(issue); return; }
      payload = { token, ...form, displayName: form.displayName.trim(), bio: form.bio.trim(), url: form.url.trim() ? new URL(form.url.trim()).href : "" };
    }
    stopRequest(); mutationPending.current = true;
    const sequence = requestSequence.current, controller = new AbortController();
    let timedOut = false, claimCommitted = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    pending.current = { controller, timer }; setBusy(kind); setError(""); setInvalidField(null);
    try {
      const response = await fetch(kind === "claim" ? "/api/claim" : "/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || (kind === "claim" ? "暫時無法認領小卡。" : "儲存失敗，請再試一次。"));
      if (!mounted.current || sequence !== requestSequence.current) return;
      if (kind === "claim") {
        claimCommitted = true;
        setCode(""); setClaimedNow(true);
        // Reclaiming a reset account preserves its profile. Read it before showing editable fields.
        const profileResponse = await fetch(`/api/me?token=${encodeURIComponent(token)}`, { cache: "no-store", signal: controller.signal });
        const ownerData = await profileResponse.json() as MeData & Partial<ApiError>;
        if (!profileResponse.ok || !ownerData.isOwner) throw new Error(ownerData.error || "尚未取得小卡的個人內容。");
        if (!mounted.current || sequence !== requestSequence.current) return;
        setMe(ownerData);
        if (!dirty.current) setForm(ownerData.profile ? { ...ownerData.profile } : { ...EMPTY_PROFILE });
        setStep(0);
      }
      else { dirty.current = false; setSaved(true); }
      onSaved();
    } catch (reason) {
      if (!mounted.current || sequence !== requestSequence.current) return;
      if (claimCommitted) {
        setError("小卡已認領成功，但既有內容尚未載入。請按「重新確認狀態」，再繼續編輯。");
        onSaved();
      }
      else if (timedOut) setError(kind === "claim" ? "連線較慢，認領可能已完成。請重新確認小卡狀態。" : "連線較慢，請再儲存一次確認。你的填寫內容仍保留著。");
      else if (!(reason instanceof Error && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "連線中斷，請再試一次。");
    } finally {
      clearTimeout(timer);
      if (mounted.current && sequence === requestSequence.current) { pending.current = null; mutationPending.current = false; setBusy(null); }
    }
  }

  function submitStep(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (step < 2) moveStep(step + 1); else void submit("save"); }
  const returnTo = `/t/${encodeURIComponent(token)}?edit=1`, errorId = `${id}-error`;
  const isWizard = !!me?.isOwner && !saved && !loading;
  const style = viewportHeight ? { "--pw-viewport-height": `${viewportHeight}px` } as CSSProperties : undefined;
  const fieldAccessibility = (name: FieldName) => ({ "aria-invalid": invalidField === name || undefined, "aria-describedby": invalidField === name ? errorId : undefined });

  return <div ref={rootRef} className={`pw-root ${isWizard ? "pw-root-wizard" : "pw-root-state"}`} style={style} aria-busy={!!busy || loading}>
    <div className="pw-topline"><span className="pw-mark"><Symbol kind="link" /></span><span>你的小小名片</span>{me?.user && <a className="pw-text-button" href={`/login?return_to=${encodeURIComponent(returnTo)}`} aria-label="帳號設定與登出">帳號</a>}{isWizard && <span className="pw-step-count">{String(step + 1).padStart(2, "0")} / 03</span>}</div>
    {isWizard && <div className="pw-progress" aria-label={`第 ${step + 1} 步，共 3 步：${STEPS[step]}`}><ol>{STEPS.map((label, index) => <li key={label} className={index <= step ? "pw-progress-done" : ""} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Symbol kind="check" /> : index + 1}</span><small>{label}</small></li>)}</ol><div className="pw-progress-track"><i style={{ transform: `scaleX(${(step + 1) / 3})` }} /></div></div>}
    {loading ? <div className="pw-state-body pw-loading" role="status"><div className="pw-loading-piece" /><h3>正在找到你的小卡…</h3><p>稍等一下，我們就開始。</p></div> : !me ? <><div className="pw-state-body"><span className="pw-state-stamp"><Symbol kind="link" /></span><h3>小卡暫時沒連上</h3><p id={errorId} role="alert">{error || "請確認連線後，再試一次。"}</p></div><div className="pw-footer"><button type="button" className="pw-button pw-button-primary pw-button-full" onClick={retryLoad}>重新讀取小卡<Symbol kind="arrow" /></button></div></> : !me.user ? <><div className="pw-state-body"><span className="pw-state-stamp"><Symbol kind="key" /></span><h3>先讓小卡認得你。</h3><p>登入後，用主辦單位給你的認領碼，<br />把這一小片回憶留在自己身邊。</p><p className="pw-state-hint">認領碼與小卡網址、卡套流水號不同。</p></div><div className="pw-footer"><a className="pw-button pw-button-primary pw-button-full" href={`/login?return_to=${encodeURIComponent(returnTo)}`} target="_top">登入並認領小卡<Symbol kind="arrow" /></a></div></> : !me.isOwner ? <form className="pw-form" onSubmit={event => { event.preventDefault(); void submit("claim"); }} noValidate>
      <div className="pw-stage pw-claim-stage" ref={stageRef}><div className="pw-step-heading"><h3>接住屬於你的那一片。</h3><p>貼上主辦單位私下提供的認領碼。</p></div><label className="pw-field"><span>小卡認領碼</span><input name="code" value={code} onChange={event => { setCode(event.target.value); setError(""); setInvalidField(null); }} maxLength={80} autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="done" placeholder="貼上收到的認領碼" disabled={!!busy} {...fieldAccessibility("code")} /></label><p className="pw-hint">沒有收到認領碼？請找主辦單位協助。<br />認領後才能修改這張卡的個人連結。</p>{error && <p className="pw-feedback pw-feedback-error" id={errorId} role="alert">{error}</p>}</div>
      <div className="pw-footer pw-claim-footer"><button type="button" className="pw-text-button" disabled={!!busy} onClick={retryLoad}>重新確認狀態</button><button className="pw-button pw-button-primary" disabled={!!busy}>{busy ? "認領中…" : "認領我的小卡"}<Symbol kind="arrow" /></button></div>
    </form> : saved ? <><div className="pw-state-body pw-saved"><span className="pw-state-stamp"><Symbol kind="check" /></span><h3>你的小卡，收好了。</h3><p>名字、一句話和連結都已儲存。<br />活動後，朋友感應小卡就能找到你。</p><div className="pw-saved-name">{form.displayName.trim()}</div></div><div className="pw-footer"><button type="button" className="pw-button pw-button-primary pw-button-full" onClick={() => { setSaved(false); setStep(0); setError(""); }}>繼續編輯我的小卡<Symbol kind="arrow" /></button></div></> : <form className="pw-form" onSubmit={submitStep} noValidate>
      <div className="pw-stage" ref={stageRef}>
        {claimedNow && <p className="pw-feedback pw-feedback-success" role="status"><Symbol kind="check" />認領成功，這張小卡是你的了。</p>}
        <div key={step} className={`pw-step pw-step-${direction}`}>
          {step === 0 && <><div className="pw-step-heading"><h3>朋友該怎麼稱呼你？</h3><p>留下會出現在紀念頁上的名字。</p></div><label className="pw-field"><span>你的名字<small>{form.displayName.length} / 40</small></span><input name="displayName" value={form.displayName} onChange={event => updateForm("displayName", event.target.value)} maxLength={40} autoComplete="nickname" enterKeyHint="next" placeholder="想讓大家記得的名字" disabled={!!busy} {...fieldAccessibility("displayName")} /></label><div className="pw-name-preview" aria-hidden="true"><span>THIS LITTLE PASS BELONGS TO</span><strong>{form.displayName.trim() || "你的名字"}</strong><small>很高興，在載耶遇見你。</small></div></>}
          {step === 1 && <><div className="pw-step-heading"><h3>有一句話，想留下來。</h3><p>關於這一晚，也可以是關於你。</p></div><label className="pw-field"><span>一句話<small>{form.bio.length} / 240</small></span><textarea name="bio" rows={3} value={form.bio} onChange={event => updateForm("bio", event.target.value)} maxLength={240} placeholder="想說的話，就放在這裡。" disabled={!!busy} {...fieldAccessibility("bio")} /></label><p className="pw-hint">還沒想到也沒關係，留白後按「下一步」即可。</p></>}
          {step === 2 && <><div className="pw-step-heading pw-step-heading-compact"><h3>讓朋友，在這裡找到你。</h3></div><label className="pw-field"><span>你的連結<small>選填</small></span><input name="url" type="url" inputMode="url" value={form.url} onChange={event => updateForm("url", event.target.value)} maxLength={2048} autoComplete="url" autoCapitalize="none" spellCheck={false} enterKeyHint="done" placeholder="https://www.instagram.com/…" disabled={!!busy} {...fieldAccessibility("url")} /></label><fieldset className="pw-mode"><legend>活動後，感應小卡時</legend><label className={form.mode === "page" ? "pw-mode-selected" : ""}><input type="radio" name="mode" value="page" checked={form.mode === "page"} onChange={() => updateForm("mode", "page")} disabled={!!busy} /><span>先看紀念頁，再開啟連結</span></label><label className={form.mode === "redirect" ? "pw-mode-selected" : ""}><input type="radio" name="mode" value="redirect" checked={form.mode === "redirect"} onChange={() => updateForm("mode", "redirect")} disabled={!!busy} /><span>直接開啟我的連結</span></label></fieldset><p className="pw-privacy">這些內容會公開給拿到小卡網址的人。</p></>}
        </div>
        {error && <p className="pw-feedback pw-feedback-error" id={errorId} role="alert">{error}</p>}
      </div>
      <div className="pw-footer"><button type="button" className="pw-button pw-button-back" disabled={step === 0 || !!busy} onClick={() => moveStep(step - 1)}><Symbol kind="back" />上一步</button><button className="pw-button pw-button-primary" disabled={!!busy}>{busy === "save" ? "正在收好…" : step === 2 ? "儲存我的小卡" : "下一步"}<Symbol kind={step === 2 ? "check" : "arrow"} /></button></div>
    </form>}
  </div>;
}

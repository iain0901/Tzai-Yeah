"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AdminAction, AdminData, ActionResult, ApiError, EventConfig, EventPhase, Group, Participant } from "@/lib/contracts";
import { prepareImport, type ImportPreview } from "./csv";
import NfcWriter from "./NfcWriter";

type Tab = "participants" | "groups";
type ModalState =
  | { type: "participant"; value?: Participant }
  | { type: "profile"; id: string }
  | { type: "nfc"; id: string }
  | { type: "group"; value?: Group }
  | { type: "deleteGroup"; value: Group }
  | { type: "publish" }
  | { type: "import" }
  | { type: "settings" }
  | { type: "copy"; url: string; name: string }
  | null;
const phases: { value: EventPhase; title: string; text: string }[] = [
  { value: "before", title: "活動前", text: "活動介紹、預告影片與資訊動畫" },
  { value: "live", title: "活動中", text: "自己的組別與集合地點" },
  { value: "after", title: "活動後", text: "紀念畫面與活動相簿" },
];

function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return <label className="ad-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}
function Dialog({ title, children, onClose, busy, wide = false }: { title: string; children: ReactNode; onClose: () => void; busy: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={ref} className={"ad-dialog" + (wide ? " ad-dialog-wide" : "")} aria-labelledby="ad-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="ad-dialog-heading"><h2 id="ad-dialog-title">{title}</h2><button type="button" className="ad-icon-button" aria-label="關閉對話框" onClick={onClose} disabled={busy}>×</button></div>
    {children}
  </dialog>;
}
function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="ad-empty"><span className="ad-empty-mark" aria-hidden="true">＋</span><h3>{title}</h3><p>{text}</p>{children}</div>;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function dateTime(value: string | null) {
  if (!value) return "尚未發布";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function auditSummary(action: string, detail: string) {
  const fields = Object.fromEntries(detail.split(";").map(part => {
    const split = part.indexOf("="); return split < 0 ? [part, ""] : [part.slice(0, split), part.slice(split + 1)];
  }));
  const count = (key: string) => /^\d{1,6}$/.test(fields[key] ?? "") ? Number(fields[key]) : null;
  switch (action) {
    case "saveParticipant": return "已儲存人員資料";
    case "ensureParticipantLink": return "已建立人員專屬連結";
    case "importParticipants": return count("count") === null ? "已匯入人員名單" : "已匯入 " + count("count") + " 位人員";
    case "saveEvent": return ["已更新活動設定", phases.find(item => item.value === fields.phase)?.title].filter(Boolean).join("・");
    case "saveGroup": return "已儲存組別草稿";
    case "deleteGroup": return "已移除組別草稿";
    case "publishGroups": return count("participants") === null ? "已發布正式分組" : "已發布 " + count("participants") + " 位人員的分組";
    case "saveProfile": return "已更新個人檔案";
    case "setCardActive": return fields.active === "true" ? "已啟用專屬連結" : "已停用專屬連結";
    default: return "已完成管理操作";
  }
}
function sameSiteLink(value: string): string {
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || !/^https?:$/.test(url.protocol) || !/^\/t\/[a-f0-9]{48}$/.test(url.pathname) || url.search || url.hash) throw new Error("專屬連結格式不正確，請重新整理後再試。");
  return url.href;
}
function externalProfileLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export default function AdminConsole() {
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>("participants");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPhase, setPendingPhase] = useState<EventPhase | null>(null);
  const [savedPhase, setSavedPhase] = useState<EventPhase | null>(null);
  const [linkPending, setLinkPending] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [modalError, setModalError] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importFile, setImportFile] = useState("");
  const busyRef = useRef(false);

  const load = useCallback(() => fetch("/api/admin", { cache: "no-store" }).then(async response => {
    const result = await response.json() as AdminData | ApiError;
    if (!response.ok) {
      setAuthStatus(response.status);
      if (response.status === 401 || response.status === 403) setData(null);
      throw new Error((result as ApiError).error ?? "無法載入後台，請稍後再試。");
    }
    setData(result as AdminData); setAuthStatus(null); setError("");
  }).catch(reason => setError(reason instanceof Error ? reason.message : "連線暫時中斷，請重新整理。")).finally(() => setLoading(false)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); }, [toast]);

  function selectTab(value: Tab) { setTab(value); setSearch(""); setGroupFilter(""); }
  function openModal(value: ModalState) { setModal(value); setModalError(""); setPreview(null); setImportFile(""); }
  function closeModal() { if (busyRef.current) return; setModal(null); setModalError(""); }

  async function action(payload: AdminAction, close = true): Promise<ActionResult | null> {
    if (busyRef.current) return null;
    busyRef.current = true; setBusy(true); setModalError(""); setError("");
    try {
      const response = await fetch("/api/admin/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as ActionResult | ApiError;
      if (!response.ok) throw new Error((result as ApiError).error ?? "儲存失敗，請再試一次。");
      await load();
      if (close) setModal(null);
      setToast((result as ActionResult).message ?? "已儲存");
      return result as ActionResult;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "連線中斷，請稍後再試。";
      if (modal) setModalError(message); else setError(message);
      return null;
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function switchPhase(phase: EventPhase) {
    if (!data || busyRef.current || data.event.phase === phase) return;
    setPendingPhase(phase); setSavedPhase(null);
    try {
      if (await action({ action: "saveEvent", event: { phase } }, false)) {
        setSavedPhase(phase); setToast("已切換為「" + phases.find(item => item.value === phase)?.title + "」。");
      }
    } finally { setPendingPhase(null); }
  }
  async function copyLinkText(url: string, name: string, inCopyDialog = false) {
    let safe: string;
    try { safe = sameSiteLink(url); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : "專屬連結格式不正確。";
      if (modal) setModalError(message); else setError(message);
      return;
    }
    try {
      if (!window.isSecureContext || !navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(safe);
      setToast("已複製 " + name + " 的專屬連結");
      if (inCopyDialog) setModal(null);
    } catch {
      if (inCopyDialog) setModalError("瀏覽器未允許自動複製。請選取下方完整連結，使用複製指令或長按複製。");
      else openModal({ type: "copy", url: safe, name });
    }
  }
  async function copyPersonLink(person: Participant) {
    if (busyRef.current || linkPending) return;
    if (person.url) {
      if (!person.linkActive) { setError("這位人員的專屬連結已停用，請先確認連結狀態。"); return; }
      void copyLinkText(person.url, person.name);
      return;
    }
    setLinkPending(person.id);
    try {
      const result = await action({ action: "ensureParticipantLink", participantId: person.id }, false);
      if (result?.url) await copyLinkText(result.url, person.name);
      else if (result) setError("連結建立完成，但尚未取得網址。請重新整理後再複製。");
    } finally { setLinkPending(null); }
  }
  async function exportCSV(kind: "participants" | "offline") {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/export?kind=" + kind, { cache: "no-store" });
      if (!response.ok) { const result = await response.json() as ApiError; throw new Error(result.error ?? "匯出失敗。"); }
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      downloadBlob(await response.blob(), "載耶-" + kind + "-" + date + ".csv");
      setToast("已下載 CSV 檔案");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "匯出失敗。"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function readImport(file: File | undefined) {
    if (!file || !data) return;
    setModalError(""); setPreview(null); setImportFile(file.name);
    try {
      if (file.size > 1024 * 1024) throw new Error("檔案請小於 1 MB。");
      const source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      setPreview(prepareImport(source, data.groups, data.cards));
    } catch (reason) { setModalError(reason instanceof TypeError ? "請將檔案另存為 CSV UTF-8，再重新上傳。" : reason instanceof Error ? reason.message : "無法讀取檔案。"); }
  }

  const currentPhase = phases.find(item => item.value === data?.event.phase) ?? phases[0];
  const query = search.trim().toLocaleLowerCase();
  const groupName = (id: string | null) => data?.groups.find(group => group.id === id)?.name ?? "尚未分組";
  const participants = data?.participants.filter(person => [person.name, person.house, String(person.householdNumber ?? ""), groupName(person.groupId)].some(value => value.toLocaleLowerCase().includes(query))
    && (!groupFilter || (groupFilter === "unassigned" ? !person.groupId : person.groupId === groupFilter))) ?? [];
  const viewedPerson = modal?.type === "profile" || modal?.type === "nfc"
    ? data?.participants.find(person => person.id === modal.id)
    : null;
  const dialogTitle = modal?.type === "participant" ? modal.value ? "編輯人員" : "新增人員"
    : modal?.type === "profile" ? "個人檔案"
    : modal?.type === "nfc" ? "寫入 NFC 小卡"
    : modal?.type === "group" ? modal.value ? "編輯組別" : "新增組別"
    : modal?.type === "deleteGroup" ? "移除組別草稿"
    : modal?.type === "publish" ? "發布這一版分組"
    : modal?.type === "settings" ? "頁面設定"
    : modal?.type === "copy" ? "複製專屬連結" : "匯入人員名單";

  return <div className="ad-app ad-simple">
    <a href="#ad-main" className="ad-skip">跳至主要內容</a>
    <header className="ad-header">
      <a className="ad-brand" href="/"><span className="ad-brand-mark">載</span><span><strong>載耶 2026</strong><small>工作人員後台</small></span></a>
      <div className="ad-header-right"><a href="/" target="_blank" rel="noreferrer" className="ad-button ad-button-small ad-button-quiet">開啟活動頁 ↗</a>{data && <span className="ad-user">{data.user.name || data.user.email}</span>}</div>
    </header>
    {!loading && data && <nav className="ad-nav ad-simple-nav" aria-label="後台功能">
      <button type="button" onClick={() => selectTab("participants")} aria-current={tab === "participants" ? "page" : undefined}>人員名單 <span>{data.participants.length}</span></button>
      <button type="button" onClick={() => selectTab("groups")} aria-current={tab === "groups" ? "page" : undefined}>分組名單 <span>{data.groups.length}</span></button>
    </nav>}
    <main id="ad-main" className="ad-main">
      {loading ? <div className="ad-loading" aria-label="正在載入後台"><div /><div /><div /></div> : !data ? <section className="ad-access">
        <p className="ad-eyebrow">TZAI YEAH / STAFF</p>
        <h1>{authStatus === 401 ? "先登入，再一起準備載耶。" : authStatus === 403 ? "這裡是工作人員的準備室。" : "暫時無法開啟後台"}</h1>
        <p>{error}</p><div className="ad-actions">{(authStatus === 401 || authStatus === 403) && <a className="ad-button ad-button-primary" href="/login?return_to=%2Fadmin" target="_top">使用本站帳號登入</a>}
          <button className="ad-button" onClick={() => { setLoading(true); void load(); }}>重新載入</button><a className="ad-button ad-button-quiet" href="/">回到活動頁</a>
        </div>
      </section> : <>
        {error && <div className="ad-message ad-message-error" role="alert">{error}<button type="button" aria-label="關閉錯誤訊息" onClick={() => setError("")}>×</button></div>}
        <section className="ad-phase-strip" aria-label="活動階段與頁面設定">
          <div className="ad-phase-strip-label"><small>目前對外顯示</small><strong>{currentPhase.title}</strong></div>
          <div className="ad-phase-segments" aria-label="切換活動階段">{phases.map(phase => <button type="button" key={phase.value} className={data.event.phase === phase.value ? "is-selected" : ""} aria-pressed={data.event.phase === phase.value} aria-busy={pendingPhase === phase.value} onClick={() => void switchPhase(phase.value)} disabled={busy || data.event.phase === phase.value}>{pendingPhase === phase.value ? "儲存中…" : phase.title}</button>)}</div>
          <button type="button" className="ad-button ad-button-small" onClick={() => openModal({ type: "settings" })} disabled={busy}>頁面設定</button>
          <p className="ad-phase-strip-status" role="status" aria-live="polite">{pendingPhase ? "正在切換活動階段…" : savedPhase === data.event.phase ? "已儲存，參加者頁面會自動更新。" : "切換後，開啟中的頁面約 15 秒內更新。"}</p>
        </section>
        <div className="ad-page-heading">
          <div><p className="ad-eyebrow">TZAI YEAH / PEOPLE</p><h1>{tab === "participants" ? "人員名單" : "分組名單"}</h1><p>{tab === "participants" ? "找到一個名字，就能複製專屬連結、查看個人檔案。" : "把大家安排在一起，確認後再發布正式分組。"}</p></div>
          <button type="button" className="ad-button ad-button-quiet" onClick={() => void load()} disabled={busy}>重新整理</button>
        </div>

        {tab === "participants" ? <>
          <div className="ad-toolbar ad-roster-toolbar">
            <div className="ad-roster-filters">
              <label className="ad-search"><span className="ad-sr-only">搜尋人員</span><input type="search" placeholder="搜尋姓名、家別、家內編號或組別" value={search} onChange={event => setSearch(event.target.value)} /></label>
              <label className="ad-filter"><span className="ad-sr-only">依組別篩選人員</span><select value={groupFilter} onChange={event => setGroupFilter(event.target.value)}><option value="">所有組別</option><option value="unassigned">尚未分組</option>{data.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
            </div>
            <div className="ad-actions"><button type="button" className="ad-button" disabled={busy} onClick={() => openModal({ type: "import" })}>匯入名單</button><button type="button" className="ad-button ad-button-primary" disabled={busy} onClick={() => openModal({ type: "participant" })}>新增人員</button></div>
          </div>
          <div className="ad-list-caption"><span>共 {data.participants.length} 人 · {data.stats.grouped} 人已分組</span><button type="button" className="ad-button ad-button-small ad-button-quiet" disabled={busy || !data.participants.length} onClick={() => void exportCSV("participants")}>匯出人員名單 ↓</button></div>
          {!data.participants.length ? <Empty title="把大家的名字放進來" text="新增一位或匯入整份名單，專屬連結會在需要時自動準備好。"><button type="button" className="ad-button" onClick={() => openModal({ type: "import" })}>匯入人員名單</button></Empty>
            : !participants.length ? <Empty title="沒有符合的人員" text="試試其他姓名，或改為顯示所有組別。"><button type="button" className="ad-button" onClick={() => { setSearch(""); setGroupFilter(""); }}>清除篩選</button></Empty>
            : <div className="ad-table-wrap ad-roster-wrap"><table className="ad-table ad-roster-table"><thead><tr><th scope="col">人員</th><th scope="col">分組</th><th scope="col">專屬連結與檔案</th></tr></thead><tbody>{participants.map(person => <tr key={person.id}>
              <td><div className="ad-person-cell"><span className="ad-person-initial" aria-hidden="true">{person.name.slice(0, 1)}</span><div><strong>{person.name}</strong><small>{person.house || "未填家別"}{person.householdNumber != null ? ` · 家內 ${person.householdNumber} 號` : ""}</small></div></div></td>
              <td><label className="ad-inline-group"><span className="ad-sr-only">{person.name} 的組別</span><select value={person.groupId || ""} disabled={busy} onChange={event => void action({ action: "saveParticipant", id: person.id, name: person.name, house: person.house, groupId: event.target.value || null }, false)}><option value="">尚未分組</option>{data.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></td>
              <td><div className="ad-person-actions">
                <button type="button" className="ad-button ad-button-small ad-copy-person" disabled={busy || !!linkPending || (!!person.url && !person.linkActive)} onClick={() => void copyPersonLink(person)}>{linkPending === person.id ? "正在準備連結…" : "複製專屬連結"}</button>
                <button type="button" className="ad-button ad-button-small" disabled={busy} onClick={() => openModal({ type: "profile", id: person.id })}>查看個人檔案</button>
              </div>{person.url && !person.linkActive && <small className="ad-link-inactive">專屬連結已停用</small>}</td>
            </tr>)}</tbody></table><p className="ad-table-note">顯示 {participants.length} 位。調整組別會先儲存為草稿，請到「分組名單」確認並發布。</p></div>}
        </> : <>
          <section className="ad-publication ad-group-publication">
            <div><strong>{data.event.publishedVersion ? "正式分組・第 " + data.event.publishedVersion + " 版" : "正式分組尚未發布"}</strong><p>{dateTime(data.event.publishedAt)} · {data.stats.grouped} 人已安排 · {Math.max(0, data.participants.length - data.stats.grouped)} 人待安排</p></div>
            <button type="button" className="ad-button ad-button-primary" disabled={busy || !data.participants.length} onClick={() => openModal({ type: "publish" })}>確認並發布分組</button>
            <div className="ad-group-reveal"><div><strong>開放分組揭曉</strong><p>正式分組已發布、階段為活動中時，開啟這個開關即可公布。</p></div><button type="button" className={"ad-toggle " + (data.event.revealOpen ? "is-on" : "")} role="switch" aria-checked={data.event.revealOpen} aria-label="開放分組揭曉" onClick={() => void action({ action: "saveEvent", event: { revealOpen: !data.event.revealOpen } }, false)} disabled={busy}><span /></button></div>
          </section>
          <div className="ad-toolbar"><p className="ad-muted">{data.groups.length} 個組別 · 以下為編輯中的名單</p><div className="ad-actions"><button type="button" className="ad-button" disabled={busy || !data.participants.length} onClick={() => void exportCSV("offline")}>匯出已發布分組</button><button type="button" className="ad-button ad-button-primary" disabled={busy} onClick={() => openModal({ type: "group" })}>新增組別</button></div></div>
          {!data.groups.length ? <Empty title="從第一組開始安排" text="取一個組名、寫下集合地點，再到人員名單指定組別。"><button type="button" className="ad-button" onClick={() => openModal({ type: "group" })}>新增第一組</button></Empty>
            : <div className="ad-group-grid">{data.groups.map(group => { const members = data.participants.filter(person => person.groupId === group.id); return <section className="ad-group" key={group.id}>
              <div className="ad-group-heading"><span className="ad-group-dot" style={{ backgroundColor: group.color || "#bb715c" }} /><h2>{group.name}</h2><span className="ad-member-count">{members.length} 人</span><button type="button" className="ad-button ad-button-small ad-button-quiet" disabled={busy} onClick={() => openModal({ type: "group", value: group })}>編輯組別</button></div>
              <p className="ad-muted">{group.location || "尚未設定集合位置"}</p>{group.note && <p className="ad-group-note">{group.note}</p>}
              {members.length ? <ul className="ad-members">{members.map(person => <li key={person.id}><button type="button" disabled={busy} onClick={() => openModal({ type: "profile", id: person.id })}><span>{person.name}</span><small>{person.house}</small></button></li>)}</ul> : <p className="ad-group-empty">這組還沒有成員。</p>}
              <button type="button" className="ad-button ad-button-small ad-button-quiet ad-arrange-members" onClick={() => { setTab("participants"); setSearch(""); setGroupFilter(members.length ? group.id : "unassigned"); }}>前往人員名單調整 ↗</button>
            </section>; })}</div>}
        </>}

        <details className="ad-secondary-tools">
          <summary>畫面預覽與操作紀錄</summary>
          <div className="ad-secondary-content"><div className="ad-preview-links">{phases.map(phase => <a key={phase.value} href={"/demo?phase=" + phase.value} target="_blank" rel="noreferrer"><span>{phase.title}<small>{phase.text}</small></span><span aria-hidden="true">↗</span></a>)}</div>
            <div><h3>最近的操作</h3>{data.audit.length ? <ul className="ad-audit">{data.audit.slice(0, 6).map(item => <li key={item.id}><time>{dateTime(item.createdAt)}</time><span>{auditSummary(item.action, item.detail)}</span><small>{item.actor}</small></li>)}</ul> : <p className="ad-muted">操作紀錄會留在這裡。</p>}</div></div>
        </details>
      </>}
    </main>
    <footer className="ad-footer"><span>載物書院・2026 載耶</span><span>What is Love? 我們一起拼出答案。</span>{data && <a href="/login?return_to=%2Fadmin" target="_top">帳號與登出</a>}</footer>
    {toast && <div className="ad-toast" role="status">{toast}<button type="button" aria-label="關閉通知" onClick={() => setToast("")}>×</button></div>}

    {modal && data && <Dialog title={dialogTitle} onClose={closeModal} busy={busy} wide={modal.type === "settings"}>
      {modalError && <p className="ad-message ad-message-error" role="alert">{modalError}</p>}
      {modal.type === "participant" && <ParticipantEditor person={modal.value} data={data} busy={busy} onSave={payload => action(payload)} onClose={closeModal} />}
      {modal.type === "profile" && (viewedPerson ? <ProfileView person={viewedPerson} groupName={groupName(viewedPerson.groupId)} busy={busy || !!linkPending} onCopy={() => void copyPersonLink(viewedPerson)} onEdit={() => openModal({ type: "participant", value: viewedPerson })} onWriteNfc={() => openModal({ type: "nfc", id: viewedPerson.id })} /> : <p className="ad-muted">找不到這位人員，請關閉視窗並重新整理名單。</p>)}
      {modal.type === "nfc" && (viewedPerson ? <>
        <p className="ad-callout">
          <strong>{viewedPerson.name}</strong> · {viewedPerson.house || "未填家別"}
          {viewedPerson.householdNumber != null ? ` · 家內 ${viewedPerson.householdNumber} 號` : ""}
        </p>
        {viewedPerson.url && viewedPerson.linkActive
          ? <NfcWriter url={viewedPerson.url} />
          : viewedPerson.url
            ? <p className="ad-inline-warning">這位人員的專屬連結已停用。</p>
            : <>
              <p className="ad-dialog-copy">先建立專屬連結。Android Chrome 可直接寫卡，iPhone 可複製網址到 NFC 寫卡 App。</p>
              <button type="button" className="ad-button ad-button-primary" disabled={busy} onClick={() => void action({ action: "ensureParticipantLink", participantId: viewedPerson.id }, false)}>
                {busy ? "正在建立…" : "建立專屬連結"}
              </button>
            </>}
        <div className="ad-dialog-actions">
          <button type="button" className="ad-button" disabled={busy} onClick={() => openModal({ type: "profile", id: viewedPerson.id })}>返回個人檔案</button>
        </div>
      </> : <p className="ad-muted">找不到這位人員，請關閉視窗並重新整理名單。</p>)}
      {modal.type === "group" && <><GroupEditor group={modal.value} busy={busy} onSave={payload => action(payload)} onClose={closeModal} />{modal.value && <button type="button" className="ad-button ad-button-small ad-button-quiet" disabled={busy} onClick={() => openModal({ type: "deleteGroup", value: modal.value! })}>移除這個組別</button>}</>}
      {modal.type === "deleteGroup" && <><p className="ad-dialog-copy">將移除「{modal.value.name}」的草稿。原組員會變成尚未分組，請重新安排後再發布。已發布的正式分組會保留到下次發布。</p><div className="ad-dialog-actions"><button type="button" className="ad-button" onClick={closeModal} disabled={busy}>保留組別</button><button type="button" className="ad-button ad-button-danger" disabled={busy} onClick={() => void action({ action: "deleteGroup", id: modal.value.id })}>{busy ? "正在移除…" : "確認移除組別"}</button></div></>}
      {modal.type === "publish" && <><p className="ad-dialog-copy">將目前的組別名稱、集合位置與成員安排，發布為正式版本。</p><div className="ad-summary-lines"><p><span>組別</span><strong>{data.groups.length} 組</strong></p><p><span>已安排</span><strong>{data.stats.grouped} 人</strong></p><p><span>尚未分組</span><strong>{data.participants.length - data.stats.grouped} 人</strong></p></div>{data.participants.length > data.stats.grouped && <p className="ad-inline-warning">請先完成人員分組，再發布。</p>}<p className="ad-muted">發布後，在上方切換為「活動中」，並開放分組揭曉。</p><div className="ad-dialog-actions"><button type="button" className="ad-button" onClick={closeModal} disabled={busy}>再檢查一下</button><button type="button" className="ad-button ad-button-primary" onClick={() => void action({ action: "publishGroups" })} disabled={busy || !data.participants.length || data.stats.grouped < data.participants.length}>{busy ? "正在發布…" : "確認發布"}</button></div></>}
      {modal.type === "import" && <><p className="ad-dialog-copy">使用 UTF-8 CSV。姓名必填；家別、家內編號和組別可以留空。同一家不可重複使用家內編號。匯入會新增人員，不會覆蓋既有名單。</p><button type="button" className="ad-button ad-button-small" onClick={() => downloadBlob(new Blob(["\uFEFF姓名,家別,家內編號,組別\r\n"], { type: "text/csv;charset=utf-8" }), "載耶-人員匯入範本.csv")}>下載空白範本</button>
        <Field label="選擇 CSV 檔案" help="組別請填既有組名。專屬連結會在第一次複製時自動建立。"><input type="file" accept=".csv,text/csv" onChange={event => void readImport(event.target.files?.[0])} disabled={busy} /></Field>
        {preview && <div className="ad-import-preview"><strong>{importFile} · {preview.rows.length} 位人員</strong>{preview.errors.length ? <ul className="ad-import-errors" role="alert">{preview.errors.slice(0, 12).map((issue, index) => <li key={index}>{issue}</li>)}{preview.errors.length > 12 && <li>另有 {preview.errors.length - 12} 個問題，請修正後重新選擇檔案。</li>}</ul> : <><p className="ad-success-text">格式檢查完成，以下為前 5 筆資料。</p><div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>姓名</th><th>家別</th><th>家內編號</th><th>組別</th></tr></thead><tbody>{preview.rows.slice(0, 5).map((row, index) => <tr key={index}><td>{row.name}</td><td>{row.house || "—"}</td><td>{row.householdNumber ?? "—"}</td><td>{groupName(row.groupId ?? null)}</td></tr>)}</tbody></table></div></>}</div>}
        <div className="ad-dialog-actions"><button type="button" className="ad-button" onClick={closeModal} disabled={busy}>取消</button><button type="button" className="ad-button ad-button-primary" disabled={busy || !preview?.rows.length || !!preview.errors.length} onClick={() => preview && void action({ action: "importParticipants", rows: preview.rows })}>{busy ? "正在匯入…" : "確認匯入" + (preview && !preview.errors.length ? " " + preview.rows.length + " 人" : "")}</button></div>
      </>}
      {modal.type === "settings" && <ContentEditor key={JSON.stringify(data.event)} event={data.event} busy={busy} onSave={event => action({ action: "saveEvent", event }, false)} />}
      {modal.type === "copy" && <><p className="ad-dialog-copy">瀏覽器未允許自動複製。請選取「{modal.name}」的完整連結，再使用複製指令或長按複製。</p><ManualCopyField value={modal.url} /><div className="ad-dialog-actions"><button type="button" className="ad-button" onClick={closeModal}>關閉</button><button type="button" className="ad-button ad-button-primary" onClick={() => void copyLinkText(modal.url, modal.name, true)}>再試一次複製</button></div></>}
    </Dialog>}
  </div>;
}

function ManualCopyField({ value }: { value: string }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <label className="ad-field"><span>完整專屬連結</span><textarea ref={input} className="ad-copy-fallback" readOnly value={value} rows={3} onFocus={event => event.target.select()} /></label>;
}
function ProfileView({ person, groupName, busy, onCopy, onEdit, onWriteNfc }: {
  person: Participant; groupName: string; busy: boolean; onCopy: () => void; onEdit: () => void; onWriteNfc: () => void;
}) {
  const profile = person.profile;
  const externalUrl = profile?.url ? externalProfileLink(profile.url) : null;
  return <div className="ad-profile-view">
    <div className="ad-profile-person"><span className="ad-person-initial" aria-hidden="true">{person.name.slice(0, 1)}</span><div><h3>{person.name}</h3><p>{person.house || "未填家別"}{person.householdNumber != null ? ` · 家內 ${person.householdNumber} 號` : ""} · {groupName}</p></div><button type="button" className="ad-button ad-button-small" disabled={busy} onClick={onEdit}>編輯人員</button></div>
    {profile ? <dl className="ad-profile-fields">
      <div><dt>公開顯示的名字</dt><dd>{profile.displayName || "尚未填寫"}</dd></div>
      <div><dt>留給朋友的一句話</dt><dd className="ad-profile-bio">{profile.bio || "尚未填寫"}</dd></div>
      <div><dt>個人連結</dt><dd>{externalUrl ? <a href={externalUrl} target="_blank" rel="noopener noreferrer">{profile.url} ↗</a> : profile.url ? "連結格式不正確，請本人重新設定。" : "尚未填寫"}</dd></div>
    </dl> : <p className="ad-inline-warning">目前無法讀取個人檔案，請稍後重新整理再試。</p>}
    {person.url && !person.linkActive && <p className="ad-inline-warning">這位人員的專屬連結已停用。</p>}
    <div className="ad-dialog-actions">
      <button type="button" className="ad-button" disabled={busy || (!!person.url && !person.linkActive)} onClick={onWriteNfc}>寫入 NFC</button>
      <button type="button" className="ad-button ad-button-primary" disabled={busy || (!!person.url && !person.linkActive)} onClick={onCopy}>複製專屬連結</button>
    </div>
    <p className="ad-profile-footnote">此處顯示本人已儲存的個人檔案。人員資料與分組可由工作人員編輯。</p>
  </div>;
}
function ParticipantEditor({ person, data, busy, onSave, onClose }: { person?: Participant; data: AdminData; busy: boolean; onSave: (payload: AdminAction) => Promise<ActionResult | null>; onClose: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void onSave({ action: "saveParticipant", ...(person ? { id: person.id } : {}), name: String(form.get("name")).trim(), house: String(form.get("house")).trim(), householdNumber: form.get("householdNumber") ? Number(form.get("householdNumber")) : null, groupId: String(form.get("groupId")) || null });
  }
  return <form onSubmit={submit}><div className="ad-form-grid"><Field label="姓名"><input name="name" autoComplete="off" maxLength={80} defaultValue={person?.name} required /></Field><Field label="家別"><input name="house" autoComplete="off" maxLength={80} defaultValue={person?.house} /></Field><Field label="家內編號" help="選填正整數；有填時也需填寫家別，同一家不可重複。"><input name="householdNumber" type="number" min="1" step="1" defaultValue={person?.householdNumber ?? ""} /></Field></div><Field label="指定組別"><select name="groupId" defaultValue={person?.groupId ?? ""}><option value="">稍後安排</option>{data.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field><p className="ad-muted">專屬連結保持不變。分組調整會先儲存為草稿，發布後才會更新正式結果。</p><div className="ad-dialog-actions"><button className="ad-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="ad-button ad-button-primary" disabled={busy}>{busy ? "正在儲存…" : "儲存人員資料"}</button></div></form>;
}
function GroupEditor({ group, busy, onSave, onClose }: { group?: Group; busy: boolean; onSave: (payload: AdminAction) => Promise<ActionResult | null>; onClose: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void onSave({ action: "saveGroup", ...(group ? { id: group.id } : {}), name: String(form.get("name")).trim(), location: String(form.get("location")).trim(), note: String(form.get("note")).trim(), color: String(form.get("color")) });
  }
  return <form onSubmit={submit}><Field label="組別名稱"><input name="name" maxLength={60} defaultValue={group?.name} placeholder="例如：第一組" required /></Field><Field label="集合位置"><input name="location" maxLength={120} defaultValue={group?.location} placeholder="請填實際集合區域或樓層" /></Field><Field label="給這組的小提示"><textarea name="note" rows={3} maxLength={500} defaultValue={group?.note} placeholder="選填：集合方式、任務提醒" /></Field><Field label="組別代表色"><input name="color" type="color" defaultValue={group?.color || "#bb715c"} /></Field><div className="ad-dialog-actions"><button className="ad-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="ad-button ad-button-primary" disabled={busy}>{busy ? "正在儲存…" : "儲存組別草稿"}</button></div></form>;
}
function ContentEditor({ event, busy, onSave }: { event: EventConfig; busy: boolean; onSave: (event: Partial<EventConfig>) => Promise<ActionResult | null> }) {
  const [gallery, setGallery] = useState(event.gallery);
  const [validation, setValidation] = useState("");
  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); setValidation(""); const form = new FormData(formEvent.currentTarget);
    const get = (key: string) => String(form.get(key) ?? "").trim();
    const selectedGallery = gallery.filter(photo => photo.url.trim()).map(photo => ({ url: photo.url.trim(), caption: photo.caption.trim() }));
    if (selectedGallery.some(photo => !photo.url.startsWith("https://"))) { setValidation("照片網址請使用 https:// 開頭的完整網址。"); return; }
    void onSave({ title: get("title"), subtitle: get("subtitle"), theme: get("theme"), date: get("date"), doors: get("doors"), start: get("start"), end: get("end"), venue: get("venue"), address: get("address"), welcome: get("welcome"), videoUrl: get("videoUrl"), albumUrl: get("albumUrl"), afterMessage: get("afterMessage"), gallery: selectedGallery });
  }
  return <form onSubmit={submit} className="ad-content-form"><section className="ad-section"><div className="ad-section-heading"><div><h2>活動資訊</h2><p>資訊會出現在手機開場與活動詳情，時間皆為台灣時間。</p></div></div><div className="ad-form-grid"><Field label="活動名稱"><input name="title" defaultValue={event.title} maxLength={160} required /></Field><Field label="副標題"><input name="subtitle" defaultValue={event.subtitle} maxLength={160} /></Field><Field label="今年的主題"><input name="theme" defaultValue={event.theme} maxLength={80} required /></Field><Field label="活動日期"><input name="date" type="date" defaultValue={event.date} required /></Field><Field label="開始入場"><input name="doors" type="time" defaultValue={event.doors} required /></Field><Field label="活動開始"><input name="start" type="time" defaultValue={event.start} required /></Field><Field label="活動結束"><input name="end" type="time" defaultValue={event.end} required /></Field><Field label="場地名稱"><input name="venue" defaultValue={event.venue} maxLength={160} required /></Field></div><Field label="地址或集合補充"><input name="address" defaultValue={event.address} maxLength={240} /></Field><Field label="開場邀請文字"><textarea name="welcome" rows={3} defaultValue={event.welcome} maxLength={240} /></Field></section>
    <section className="ad-section"><div className="ad-section-heading"><div><h2>劇情預告</h2><p>影片尚未上架時，頁面會保留完整活動資訊動畫。</p></div></div><Field label="YouTube 影片網址" help="可貼一般影片、youtu.be 或 Shorts 網址。填入並儲存後，活動頁會出現播放入口。"><input name="videoUrl" type="url" defaultValue={event.videoUrl} placeholder="https://www.youtube.com/watch?v=…" /></Field></section>
    <section className="ad-section">
      <div className="ad-section-heading"><div><h2>活動後，把回憶留在這裡</h2><p>切到「活動後」，個人專屬頁就會打開紀念畫面，再由參加者點進你的照片服務。</p></div></div>
      <Field label="活動相簿連結" help="貼上你使用的照片服務分享網址即可，不必逐張加入照片。請先確認參加者可以開啟相簿。"><input name="albumUrl" type="url" defaultValue={event.albumUrl} placeholder="https://…" /></Field>
      <Field label="留給大家的回顧文字"><textarea name="afterMessage" rows={3} defaultValue={event.afterMessage} maxLength={240} /></Field>
      <p className="ad-muted">只填相簿連結，就能使用完整的耶誕回顧畫面。相簿尚未準備好時，頁面會顯示整理中的訊息。</p>
      <details className="ad-cover-options">
        <summary>選填：回顧封面照片</summary>
        <p className="ad-muted">未設定時使用聖誕插畫。若有照片，第一張作為回顧封面；既有的其他照片設定會保留，前台不做輪播。</p>
        {gallery.length ? <div className="ad-gallery-rows">{gallery.map((photo, index) => <div className="ad-gallery-row" key={index}>
          <span className="ad-mono">{String(index + 1).padStart(2, "0")}</span>
          <Field label={index === 0 ? "回顧封面網址" : "保留的照片網址"}><input type="url" value={photo.url} placeholder="https://…/photo.jpg" onChange={change => setGallery(gallery.map((item, i) => i === index ? { ...item, url: change.target.value } : item))} /></Field>
          <Field label="照片說明"><input value={photo.caption} maxLength={120} onChange={change => setGallery(gallery.map((item, i) => i === index ? { ...item, caption: change.target.value } : item))} /></Field>
          <button className="ad-button ad-button-small ad-button-quiet" type="button" aria-label={`移除第 ${index + 1} 張照片`} onClick={() => setGallery(gallery.filter((_, i) => i !== index))}>移除</button>
        </div>)}</div> : <button className="ad-button ad-button-small" type="button" onClick={() => setGallery([{ url: "", caption: "" }])}>選用一張封面照片</button>}
      </details>
    </section>
    {validation && <p className="ad-message ad-message-error" role="alert">{validation}</p>}<div className="ad-save-bar"><p>儲存後，開啟中的頁面約 15 秒內更新，不必更換專屬連結。</p><button className="ad-button ad-button-primary" disabled={busy}>{busy ? "正在儲存…" : "儲存頁面內容"}</button></div>
  </form>;
}

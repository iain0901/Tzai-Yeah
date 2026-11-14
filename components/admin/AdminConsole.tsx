"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AdminAction, AdminData, ActionResult, ApiError, Card, EventConfig, EventPhase, Group, Participant } from "@/lib/contracts";
import { prepareImport, type ImportPreview } from "./csv";

type Tab = "overview" | "participants" | "groups" | "cards" | "content";
type ModalState = { type: "participant"; value?: Participant } | { type: "group"; value?: Group } | { type: "deleteGroup"; value: Group } | { type: "publish" } | { type: "generate" } | { type: "card"; value: Card } | { type: "claim"; value: Participant } | { type: "import" } | null;
const tabs: { id: Tab; label: string; short: string }[] = [
  { id: "overview", label: "活動總覽", short: "總覽" }, { id: "participants", label: "參加者名單", short: "名單" },
  { id: "groups", label: "人工分組", short: "分組" }, { id: "cards", label: "NFC 小卡", short: "小卡" }, { id: "content", label: "頁面內容", short: "內容" },
];
const phases: { value: EventPhase; title: string; text: string }[] = [
  { value: "before", title: "活動前", text: "活動介紹、預告影片與資訊動畫" },
  { value: "live", title: "活動中", text: "公布自己的組別與集合地點" },
  { value: "after", title: "活動後", text: "紀念畫面與活動相簿入口" },
];

function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return <label className="ad-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}

function Dialog({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={ref} className="ad-dialog" aria-labelledby="ad-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
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
    const separator = part.indexOf("=");
    return separator < 0 ? [part, ""] : [part.slice(0, separator), part.slice(separator + 1)];
  }));
  const count = (key: string) => /^\d{1,6}$/.test(fields[key] ?? "") ? Number(fields[key]) : null;
  switch (action) {
    case "saveParticipant": return "已儲存參加者資料";
    case "importParticipants": return count("count") === null ? "已匯入參加者名單" : `已匯入 ${count("count")} 位參加者`;
    case "saveEvent": {
      const phase = phases.find(item => item.value === fields.phase)?.title;
      const reveal = fields.reveal === "true" ? "分組揭曉已開放" : fields.reveal === "false" ? "分組揭曉已關閉" : "";
      return ["已更新活動設定", phase, reveal].filter(Boolean).join("・");
    }
    case "generateCards": return count("added") === null ? "已建立小卡網址" : `已新增 ${count("added")} 張小卡`;
    case "saveGroup": return "已儲存組別草稿";
    case "deleteGroup": return "已移除組別草稿";
    case "publishGroups": return count("participants") === null ? "已發布正式分組" : `已發布 ${count("participants")} 位參加者的分組`;
    case "setCardActive": return fields.active === "true" ? "已重新啟用小卡" : "已停用小卡";
    case "checkIn": return fields.checkedIn === "false" ? "已取消一位參加者的報到" : "已完成一位參加者的報到";
    case "issueClaimCode": return fields.reset === "true" ? "已重設個人頁擁有者並產生認領碼" : "已產生個人頁認領碼";
    case "claim": return "參加者已認領自己的小卡";
    case "saveProfile": return "參加者已更新個人頁設定";
    default: return "已完成管理操作";
  }
}

export default function AdminConsole() {
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPhase, setPendingPhase] = useState<EventPhase | null>(null);
  const [savedPhase, setSavedPhase] = useState<EventPhase | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [modalError, setModalError] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importFile, setImportFile] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin", { cache: "no-store" });
      const result = await response.json() as AdminData | ApiError;
      if (!response.ok) { setAuthStatus(response.status); if (response.status === 401 || response.status === 403) setData(null); throw new Error((result as ApiError).error ?? "無法載入後台，請稍後再試。"); }
      setData(result as AdminData); setAuthStatus(null); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "連線暫時中斷，請重新整理。"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); }, [toast]);

  function selectTab(value: Tab) { setTab(value); setSearch(""); }
  function openModal(value: ModalState) { setModal(value); setModalError(""); setClaimCode(""); setPreview(null); setImportFile(""); }
  function closeModal() { if (busy) return; setModal(null); setModalError(""); setClaimCode(""); }

  async function action(payload: AdminAction, close = true): Promise<ActionResult | null> {
    setBusy(true); setModalError(""); setError("");
    try {
      const response = await fetch("/api/admin/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as ActionResult | ApiError;
      if (!response.ok) throw new Error((result as ApiError).error ?? "儲存失敗，請再試一次。");
      await load();
      if (close) setModal(null);
      setToast((result as ActionResult).message ?? "已儲存");
      return result as ActionResult;
    } catch (reason) { const message = reason instanceof Error ? reason.message : "連線中斷，請稍後再試。"; if (modal) setModalError(message); else setError(message); return null; }
    finally { setBusy(false); }
  }


  async function switchPhase(phase: EventPhase) {
    if (!data || busy || pendingPhase || data.event.phase === phase) return;
    setPendingPhase(phase);
    setSavedPhase(null);
    try {
      const result = await action({ action: "saveEvent", event: { phase } });
      if (result) {
        setSavedPhase(phase);
        setToast("已儲存：活動已切換為「" + phases.find(item => item.value === phase)?.title + "」。");
      }
    } finally {
      setPendingPhase(null);
    }
  }

  async function copy(text: string, label = "已複製") {
    try { await navigator.clipboard.writeText(text); setToast(label); }
    catch { setError("無法自動複製，請選取文字後手動複製。"); }
  }

  async function exportCSV(kind: "cards" | "participants" | "offline") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/export?kind=${kind}`, { cache: "no-store" });
      if (!response.ok) { const result = await response.json() as ApiError; throw new Error(result.error ?? "匯出失敗。"); }
      downloadBlob(await response.blob(), `載耶-${kind}-${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}.csv`);
      setToast("已下載 CSV 檔案");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "匯出失敗。"); }
    finally { setBusy(false); }
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
  const participants = data?.participants.filter(person => [person.name, person.house, String(person.householdNumber ?? ""), data.groups.find(group => group.id === person.groupId)?.name, data.cards.find(card => card.id === person.cardId)?.serial].some(value => value?.toLocaleLowerCase().includes(query))) ?? [];
  const cards = data?.cards.filter(card => [card.serial, data.participants.find(person => person.id === card.participantId)?.name].some(value => value?.toLocaleLowerCase().includes(query))) ?? [];
  const groupName = (id: string | null) => data?.groups.find(group => group.id === id)?.name ?? "尚未分組";
  const cardSerial = (id: string | null) => data?.cards.find(card => card.id === id)?.serial ?? "—";

  return <div className="ad-app">
    <a href="#ad-main" className="ad-skip">跳至主要內容</a>
    <header className="ad-header">
      <a className="ad-brand" href="/"><span className="ad-brand-mark">載</span><span><strong>載耶 2026</strong><small>工作人員後台</small></span></a>
      <div className="ad-header-right"><a href="/" target="_blank" rel="noreferrer" className="ad-button ad-button-small ad-button-quiet">開啟活動頁 ↗</a>{data && <span className="ad-user">{data.user.name || data.user.email}</span>}</div>
    </header>
    {!loading && data && <nav className="ad-nav" aria-label="後台功能">{tabs.map(item => <button type="button" key={item.id} onClick={() => selectTab(item.id)} aria-current={tab === item.id ? "page" : undefined}><span className="ad-nav-long">{item.label}</span><span className="ad-nav-short">{item.short}</span></button>)}</nav>}
    <main id="ad-main" className="ad-main">
      {loading ? <div className="ad-loading" aria-label="正在載入後台"><div /><div /><div /></div> : !data ? <section className="ad-access"><p className="ad-eyebrow">TZAI YEAH / STAFF</p><h1>{authStatus === 401 ? "先登入，再一起準備載耶。" : authStatus === 403 ? "這裡是工作人員的準備室。" : "暫時無法開啟後台"}</h1><p>{error}</p><div className="ad-actions">{(authStatus === 401 || authStatus === 403) && <a className="ad-button ad-button-primary" href="/login?return_to=%2Fadmin" target="_top">使用本站帳號登入</a>}<button className="ad-button" onClick={() => { setLoading(true); void load(); }}>重新載入</button><a className="ad-button ad-button-quiet" href="/">回到活動頁</a></div></section> : <>
        {error && <div className="ad-message ad-message-error" role="alert">{error}<button type="button" aria-label="關閉錯誤訊息" onClick={() => setError("")}>×</button></div>}
        <div className="ad-page-heading"><div><p className="ad-eyebrow">TZAI YEAH / 2026</p><h1>{tabs.find(item => item.id === tab)?.label}</h1><p>{tab === "overview" ? "把準備的每一小步，拼成溫暖的一晚。" : tab === "participants" ? "依姓名發卡；每位參加者的分組，由你們親手安排。" : tab === "groups" ? "先編輯草稿，確認後再發布給參加者。" : tab === "cards" ? "同樣的卡面，各自獨立的網址。卡套流水號請與這裡一致。" : "預告還沒完成也沒關係，活動資訊會先好好迎接每個人。"}</p></div><button className="ad-button ad-button-quiet" onClick={() => void load()} disabled={busy}>重新整理</button></div>

        {tab === "overview" && <>
          <section className="ad-section ad-phase-control" aria-labelledby="ad-phase-title">
            <div className="ad-section-heading">
              <div><h2 id="ad-phase-title">活動階段</h2><p>在這裡切換所有小卡的主畫面。連線正常且頁面開啟時，約 15 秒內更新；回到頁面也會重新確認。</p></div>
              <div className="ad-phase-current"><small>目前對外顯示</small><strong>{currentPhase.title}</strong></div>
            </div>
            <div className="ad-phase-options" aria-label="選擇活動階段">
              {phases.map(phase => <button type="button" key={phase.value} className={data.event.phase === phase.value ? "is-selected" : ""} aria-pressed={data.event.phase === phase.value} aria-busy={pendingPhase === phase.value} onClick={() => void switchPhase(phase.value)} disabled={busy || data.event.phase === phase.value}>
                <span>{phase.title}</span><small>{phase.text}</small>
                <em>{pendingPhase === phase.value ? "正在儲存…" : data.event.phase === phase.value ? "目前顯示" : "切換至此階段 →"}</em>
                {data.event.phase === phase.value && <b aria-hidden="true">✓</b>}
              </button>)}
            </div>
            <p className={"ad-phase-feedback " + (savedPhase === data.event.phase && !pendingPhase ? "is-saved" : "")} role="status" aria-live="polite" aria-atomic="true">
              {pendingPhase ? "正在切換至「" + phases.find(phase => phase.value === pendingPhase)?.title + "」…" : savedPhase === data.event.phase ? "已儲存，目前對外顯示「" + currentPhase.title + "」。" : "點選階段即會儲存，同一個小卡網址會顯示對應內容。"}
            </p>
            <div className="ad-setting-line"><div><strong>開放分組揭曉</strong><p>先發布分組，再切到「活動中」並開放揭曉。持卡者會在原本的頁面看到自己的組別，不必再次感應。</p></div><button className={"ad-toggle " + (data.event.revealOpen ? "is-on" : "")} role="switch" aria-checked={data.event.revealOpen} aria-label="開放分組揭曉" onClick={() => void action({ action: "saveEvent", event: { revealOpen: !data.event.revealOpen } })} disabled={busy}><span /></button></div>
            {data.event.revealOpen && !data.event.publishedVersion && <p className="ad-inline-warning">尚未發布分組。請先到「人工分組」確認並發布。</p>}
          </section>
          <div className="ad-metrics">{[{ label: "參加者", value: data.stats.participants }, { label: "已配對卡片", value: data.stats.bound }, { label: "已安排分組", value: data.stats.grouped }, { label: "已報到", value: data.stats.checkedIn }].map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value}<small>人</small></strong></div>)}</div>
          <div className="ad-two-column"><section className="ad-section"><h2>發卡前的三件事</h2><ol className="ad-checklist"><li><span className={data.cards.length ? "is-done" : ""}>1</span><div><strong>建立卡片網址</strong><p>{data.cards.length ? `已建立 ${data.cards.length} 張，寫入 NFC 後逐張感應核對。` : "先建立 150 張卡片，匯出專屬網址供 NFC 寫入。"}</p></div></li><li><span className={data.participants.length ? "is-done" : ""}>2</span><div><strong>匯入名單並配對</strong><p>將卡片放入同號卡套，指定領卡者。</p></div></li><li><span className={data.event.publishedVersion ? "is-done" : ""}>3</span><div><strong>人工分組，確認發布</strong><p>發布後仍須切到活動中並開放揭曉。</p></div></li></ol><button className="ad-button ad-button-primary" onClick={() => data.cards.length ? selectTab("participants") : openModal({ type: "generate" })}>{data.cards.length ? "準備參加者名單" : "建立 150 張小卡"}</button></section><section className="ad-section"><h2>上場前，先走一次</h2><p className="ad-muted">示範頁只用來檢查畫面，不會變更正式資料。</p><div className="ad-preview-links">{phases.map(phase => <a key={phase.value} href={`/demo?phase=${phase.value}`} target="_blank" rel="noreferrer"><span>{phase.title}<small>{phase.text}</small></span><span aria-hidden="true">↗</span></a>)}</div><button className="ad-button" disabled={busy || !data.participants.length} onClick={() => void exportCSV("offline")}>下載現場備用名單</button></section></div>
          <section className="ad-section"><div className="ad-section-heading"><h2>最近的操作</h2><small className="ad-muted">時間以台灣時間顯示</small></div>{data.audit.length ? <ul className="ad-audit">{data.audit.slice(0, 8).map(item => <li key={item.id}><time>{dateTime(item.createdAt)}</time><span>{auditSummary(item.action, item.detail)}</span><small>{item.actor}</small></li>)}</ul> : <p className="ad-muted">完成設定後，操作紀錄會留在這裡。</p>}</section>
        </>}

        {tab === "participants" && <>
          <div className="ad-toolbar"><label className="ad-search"><span className="ad-sr-only">搜尋參加者</span><input type="search" placeholder="搜尋姓名、家別、組別或卡號" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="ad-actions"><button className="ad-button" onClick={() => openModal({ type: "import" })}>匯入 CSV</button><button className="ad-button" disabled={busy || !data.participants.length} onClick={() => void exportCSV("participants")}>匯出名單</button><button className="ad-button ad-button-primary" onClick={() => openModal({ type: "participant" })}>新增參加者</button></div></div>
          {!data.participants.length ? <Empty title="把大家的名字放進來" text="可先新增一位，或一次匯入報名名單；分組與卡片都能之後再安排。"><button className="ad-button" onClick={() => openModal({ type: "import" })}>匯入報名名單</button></Empty> : !participants.length ? <Empty title="沒有符合的參加者" text="試試其他姓名、家別或卡號。" /> : <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>參加者</th><th>分組草稿</th><th>卡套號碼</th><th>報到</th><th>操作</th></tr></thead><tbody>{participants.map(person => <tr key={person.id}><td><strong>{person.name}</strong><small>{person.house || "未填家別"}{person.householdNumber != null ? ` · 家內編號 ${person.householdNumber}` : ""}</small></td><td><span className={!person.groupId ? "ad-muted" : ""}>{groupName(person.groupId)}</span></td><td><span className="ad-mono">{cardSerial(person.cardId)}</span></td><td><button className={`ad-button ad-button-small ${person.checkedInAt ? "ad-button-success" : ""}`} disabled={busy} onClick={() => void action({ action: "checkIn", participantId: person.id, checkedIn: !person.checkedInAt })}>{person.checkedInAt ? "已報到" : "辦理報到"}</button></td><td><div className="ad-row-actions"><button className="ad-button ad-button-small ad-button-quiet" onClick={() => openModal({ type: "participant", value: person })}>編輯</button><button className="ad-button ad-button-small ad-button-quiet" onClick={() => openModal({ type: "claim", value: person })} disabled={!person.cardId}>個人頁管理</button></div></td></tr>)}</tbody></table><p className="ad-table-note">共 {participants.length} 位。這裡顯示編輯中的分組，修改後請到「人工分組」重新發布。</p></div>}
        </>}

        {tab === "groups" && <>
          <div className="ad-publication"><div><strong>已發布版本 {data.event.publishedVersion || "—"}</strong><p>{dateTime(data.event.publishedAt)} · 已發布 {data.stats.published} 位參加者的分組</p></div><button className="ad-button ad-button-primary" disabled={busy || !data.groups.length} onClick={() => openModal({ type: "publish" })}>確認並發布分組</button></div>
          <div className="ad-toolbar"><p className="ad-muted">{data.groups.length} 組 · {data.stats.grouped} 人已安排 · {Math.max(0, data.stats.participants - data.stats.grouped)} 人待分組</p><button className="ad-button" onClick={() => openModal({ type: "group" })}>新增組別</button></div>
          {!data.groups.length ? <Empty title="從第一組開始拼起" text="為每組取名字，寫下集合位置，再把參加者安排進來。"><button className="ad-button" onClick={() => openModal({ type: "group" })}>新增第一組</button></Empty> : <div className="ad-group-grid">{data.groups.map(group => { const members = data.participants.filter(person => person.groupId === group.id); return <section className="ad-group" key={group.id}><div className="ad-group-heading"><span className="ad-group-dot" style={{ backgroundColor: group.color || "#9c533f" }} /><h2>{group.name}</h2><span className="ad-member-count">{members.length} 人</span><button className="ad-button ad-button-small ad-button-quiet" onClick={() => openModal({ type: "group", value: group })}>編輯</button></div><p className="ad-muted">{group.location || "尚未設定集合位置"}</p>{group.note && <p className="ad-group-note">{group.note}</p>}{members.length ? <ul className="ad-members">{members.map(person => <li key={person.id}><button onClick={() => openModal({ type: "participant", value: person })}><span>{person.name}</span><small>{person.house}</small></button></li>)}</ul> : <p className="ad-group-empty">到參加者名單中，將成員安排進這一組。</p>}</section>; })}</div>}
        </>}

        {tab === "cards" && <>
          <div className="ad-toolbar"><label className="ad-search"><span className="ad-sr-only">搜尋卡片</span><input type="search" placeholder="搜尋卡套流水號或領卡者" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="ad-actions"><button className="ad-button" disabled={busy || !data.cards.length} onClick={() => void exportCSV("cards")}>匯出 NFC 網址清單</button><button className="ad-button ad-button-primary" onClick={() => openModal({ type: "generate" })}>{data.cards.length ? "補充備用卡" : "建立小卡"}</button></div></div>
          <p className="ad-callout">每張卡的專屬網址只需寫入一次，活動前、中、後都沿用它。發卡前由工作人員逐張感應核對流水號；持卡者進入網站後不必再感應一次。</p>
          {!data.cards.length ? <Empty title="150 張小卡，準備各自的故事" text="建立後會產生獨立網址；卡面的 030 代表 30 級，卡套請另外標註流水號。"><button className="ad-button ad-button-primary" onClick={() => openModal({ type: "generate" })}>建立 150 張小卡</button></Empty> : !cards.length ? <Empty title="找不到這張小卡" text="請確認卡套號碼，或改用領卡者姓名搜尋。" /> : <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>卡套流水號</th><th>領卡者</th><th>狀態</th><th>專屬網址</th><th>管理</th></tr></thead><tbody>{cards.map(card => <tr key={card.id}><td><strong className="ad-mono">#{card.serial}</strong></td><td>{data.participants.find(person => person.id === card.participantId)?.name || <span className="ad-muted">尚未配對</span>}</td><td><span className={`ad-badge ${card.active ? "" : "is-inactive"}`}>{card.active ? "啟用中" : "已停用"}</span></td><td><div className="ad-row-actions"><button className="ad-button ad-button-small" onClick={() => void copy(card.url, `已複製 #${card.serial} 網址`)}>複製網址</button><a className="ad-button ad-button-small ad-button-quiet" href={card.url} target="_blank" rel="noreferrer">開啟 ↗</a></div></td><td><button className="ad-button ad-button-small ad-button-quiet" onClick={() => openModal({ type: "card", value: card })}>{card.active ? "停用" : "重新啟用"}</button></td></tr>)}</tbody></table><p className="ad-table-note">共 {cards.length} 張。卡片遺失時先停用，再於參加者資料中配對另一張卡。</p></div>}
        </>}

        {tab === "content" && <ContentEditor key={JSON.stringify(data.event)} event={data.event} busy={busy} onSave={event => action({ action: "saveEvent", event })} />}
      </>}
    </main>
    <footer className="ad-footer"><span>載物書院・2026 載耶</span><span>What is Love? 我們一起拼出答案。</span>{data && <a href="/login?return_to=%2Fadmin" target="_top">帳號與登出</a>}</footer>
    {toast && <div className="ad-toast" role="status">{toast}<button type="button" aria-label="關閉通知" onClick={() => setToast("")}>×</button></div>}

    {modal && data && <Dialog title={modal.type === "participant" ? modal.value ? "編輯參加者" : "新增參加者" : modal.type === "group" ? modal.value ? "編輯組別" : "新增組別" : modal.type === "deleteGroup" ? "移除組別草稿" : modal.type === "publish" ? "發布這一版分組" : modal.type === "generate" ? "建立 NFC 小卡" : modal.type === "card" ? `管理小卡 #${modal.value.serial}` : modal.type === "claim" ? `${modal.value.name} 的個人頁管理` : "匯入參加者名單"} onClose={closeModal} busy={busy}>
      {modalError && <p className="ad-message ad-message-error" role="alert">{modalError}</p>}
      {modal.type === "participant" && <ParticipantEditor person={modal.value} data={data} busy={busy} onSave={payload => action(payload)} onClose={closeModal} />}
      {modal.type === "group" && <><GroupEditor group={modal.value} busy={busy} onSave={payload => action(payload)} onClose={closeModal} />{modal.value && <button type="button" className="ad-button ad-button-small ad-button-quiet" disabled={busy} onClick={() => openModal({ type: "deleteGroup", value: modal.value! })}>移除這個組別</button>}</>}
      {modal.type === "deleteGroup" && <><p className="ad-dialog-copy">將移除「{modal.value.name}」的草稿。原組員會變成尚未分組，請重新安排後再發布。已發布的分組會保留到下一次發布。</p><div className="ad-dialog-actions"><button type="button" className="ad-button" onClick={closeModal} disabled={busy}>保留組別</button><button type="button" className="ad-button ad-button-danger" disabled={busy} onClick={() => void action({ action: "deleteGroup", id: modal.value.id })}>{busy ? "正在移除…" : "確認移除組別"}</button></div></>}
      {modal.type === "publish" && <><p className="ad-dialog-copy">將目前的組別名稱、集合位置、提示與成員安排，一起發布為新的正式版本。</p><div className="ad-summary-lines"><p><span>組別</span><strong>{data.groups.length} 組</strong></p><p><span>已安排</span><strong>{data.stats.grouped} 人</strong></p><p><span>尚未分組</span><strong>{data.stats.participants - data.stats.grouped} 人</strong></p></div>{data.stats.participants > data.stats.grouped && <p className="ad-inline-warning">仍有參加者尚未分組，請先完成所有人的安排，再發布。</p>}<p className="ad-muted">發布只更新正式分組。請在活動總覽切到「活動中」並開啟「分組揭曉」，開啟中的持卡者頁面便會自動更新。</p><div className="ad-dialog-actions"><button className="ad-button" onClick={closeModal} disabled={busy}>再檢查一下</button><button className="ad-button ad-button-primary" onClick={() => void action({ action: "publishGroups" })} disabled={busy || !data.participants.length || data.stats.grouped < data.stats.participants}>{busy ? "正在發布…" : "確認發布"}</button></div></>}
      {modal.type === "generate" && <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void action({ action: "generateCards", count: Number(form.get("count")) }); }}><p className="ad-dialog-copy">設定卡片總數。已有的小卡與網址會保留，系統只補足不足的張數。</p><Field label="卡片總數" help={`目前有 ${data.cards.length} 張。首次建議 150 張；備用卡可另加。`}><input name="count" type="number" min={Math.max(1, data.cards.length)} max="500" defaultValue={Math.min(500, Math.max(150, data.cards.length + (data.cards.length ? 10 : 0)))} required /></Field><div className="ad-dialog-actions"><button className="ad-button" type="button" onClick={closeModal} disabled={busy}>取消</button><button className="ad-button ad-button-primary" disabled={busy}>{busy ? "正在建立…" : "建立專屬網址"}</button></div></form>}
      {modal.type === "card" && <><p className="ad-dialog-copy">{modal.value.active ? "停用後，這張卡原本的網址將無法查看分組與個人頁。適用於卡片遺失或損壞。" : "重新啟用後，這張卡的網址將可再次開啟。"}</p><label className="ad-field"><span>這張卡的網址</span><input readOnly value={modal.value.url} onFocus={event => event.target.select()} /></label><div className="ad-dialog-actions"><button className="ad-button" onClick={closeModal} disabled={busy}>取消</button><button className={`ad-button ${modal.value.active ? "ad-button-danger" : "ad-button-primary"}`} onClick={() => void action({ action: "setCardActive", cardId: modal.value.id, active: !modal.value.active })} disabled={busy}>{busy ? "正在儲存…" : modal.value.active ? "確認停用" : "重新啟用"}</button></div></>}
      {modal.type === "claim" && <>{claimCode ? <><p className="ad-dialog-copy">請私下交給本人。這組認領碼只顯示這一次，有效期限為 30 天，使用後即失效。</p><label className="ad-field"><span>個人頁認領碼</span><input className="ad-secret" readOnly value={claimCode} onFocus={event => event.target.select()} /></label><p className="ad-muted">本人開啟小卡的個人頁設定、登入本站帳號，再輸入認領碼，即可編輯自己的連結。</p><div className="ad-dialog-actions"><button className="ad-button" onClick={() => void copy(claimCode, "已複製認領碼，請私下交給本人")}>複製認領碼</button><button className="ad-button ad-button-primary" onClick={closeModal}>已妥善保存</button></div></> : <form onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await action({ action: "issueClaimCode", participantId: modal.value.id, resetOwner: form.get("resetOwner") === "on" }, false); if (result?.code) setClaimCode(result.code); }}><p className="ad-dialog-copy">持有卡片網址只能查看內容。使用獨立認領碼，讓本人取得編輯個人連結的權限。</p><p className="ad-callout">{modal.value.claimed ? "這位參加者已認領個人頁。只有本人需要更換管理帳號時，才解除既有綁定。" : modal.value.hasClaimCode ? "先前已發過認領碼。重新產生後，舊碼會立即失效。" : "尚未發出認領碼。產生後請私下交給本人。"}</p>{modal.value.claimed && <label className="ad-checkbox"><input name="resetOwner" type="checkbox" required /><span>已確認本人需求，解除既有帳號綁定並重新認領。</span></label>}<div className="ad-dialog-actions"><button className="ad-button" type="button" onClick={closeModal} disabled={busy}>取消</button><button className="ad-button ad-button-primary" disabled={busy}>{busy ? "正在產生…" : "產生一次性認領碼"}</button></div></form>}</>}
      {modal.type === "import" && <><p className="ad-dialog-copy">以 UTF-8 CSV 匯入。姓名必填；家別、家內編號、組別、卡號可留空。家內編號從 1 開始，同一家不可重複。匯入會新增參加者，不會覆蓋既有名單。</p><button className="ad-button ad-button-small" onClick={() => downloadBlob(new Blob(["\uFEFF姓名,家別,家內編號,組別,卡號\r\n"], { type: "text/csv;charset=utf-8" }), "載耶-參加者匯入範本.csv")}>下載空白範本</button><Field label="選擇 CSV 檔案" help="組別請填既有組名，卡號請填卡套流水號。"><input type="file" accept=".csv,text/csv" onChange={event => void readImport(event.target.files?.[0])} disabled={busy} /></Field>{preview && <div className="ad-import-preview"><strong>{importFile} · {preview.rows.length} 位參加者</strong>{preview.errors.length ? <ul className="ad-import-errors" role="alert">{preview.errors.slice(0, 12).map((issue, index) => <li key={index}>{issue}</li>)}{preview.errors.length > 12 && <li>另有 {preview.errors.length - 12} 個問題，請修正後重新選擇檔案。</li>}</ul> : <><p className="ad-success-text">格式檢查完成，確認下列前 5 筆資料後即可匯入。</p><div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>姓名</th><th>家別</th><th>家內編號</th><th>組別</th><th>卡號</th></tr></thead><tbody>{preview.rows.slice(0, 5).map((row, index) => <tr key={index}><td>{row.name}</td><td>{row.house || "—"}</td><td>{row.householdNumber ?? "—"}</td><td>{groupName(row.groupId ?? null)}</td><td>{row.cardSerial || "—"}</td></tr>)}</tbody></table></div></>}</div>}<div className="ad-dialog-actions"><button className="ad-button" onClick={closeModal} disabled={busy}>取消</button><button className="ad-button ad-button-primary" disabled={busy || !preview?.rows.length || !!preview.errors.length} onClick={() => preview && void action({ action: "importParticipants", rows: preview.rows })}>{busy ? "正在匯入…" : `確認匯入${preview && !preview.errors.length ? ` ${preview.rows.length} 人` : ""}`}</button></div></>}
    </Dialog>}
  </div>;
}

function ParticipantEditor({ person, data, busy, onSave, onClose }: { person?: Participant; data: AdminData; busy: boolean; onSave: (payload: AdminAction) => Promise<ActionResult | null>; onClose: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void onSave({ action: "saveParticipant", ...(person ? { id: person.id } : {}), name: String(form.get("name")).trim(), house: String(form.get("house")).trim(), householdNumber: form.get("householdNumber") ? Number(form.get("householdNumber")) : null, groupId: String(form.get("groupId")) || null, cardId: String(form.get("cardId")) || null });
  }
  return <form onSubmit={submit}><div className="ad-form-grid"><Field label="姓名"><input name="name" autoComplete="off" maxLength={80} defaultValue={person?.name} required /></Field><Field label="家別"><input name="house" autoComplete="off" maxLength={80} defaultValue={person?.house} /></Field><Field label="家內編號" help="選填；每家從 1 開始，同一家不可重複。"><input name="householdNumber" type="number" min="1" step="1" defaultValue={person?.householdNumber ?? ""} /></Field><Field label="人工指定組別"><select name="groupId" defaultValue={person?.groupId ?? ""}><option value="">稍後安排</option>{data.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field><Field label="配對小卡" help="配對新卡後，原卡會自動停用。請核對新卡套的流水號。"><select name="cardId" defaultValue={person?.cardId ?? ""}><option value="">尚未配對</option>{data.cards.filter(card => card.id === person?.cardId || (!card.participantId && card.active)).map(card => <option key={card.id} value={card.id}>#{card.serial}{!card.active ? "（已停用）" : ""}</option>)}</select></Field></div><p className="ad-muted">分組調整會先儲存為草稿，發布後才會更新參加者看到的結果。</p><div className="ad-dialog-actions"><button className="ad-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="ad-button ad-button-primary" disabled={busy}>{busy ? "正在儲存…" : "儲存參加者"}</button></div></form>;
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
    <section className="ad-section"><div className="ad-section-heading"><div><h2>直式劇情預告</h2><p>影片尚未上架時，頁面會保留完整活動資訊動畫。</p></div></div><Field label="YouTube 影片網址" help="可貼一般影片、youtu.be 或 Shorts 網址。填入並儲存後，活動頁會出現播放入口。"><input name="videoUrl" type="url" defaultValue={event.videoUrl} placeholder="https://www.youtube.com/watch?v=…" /></Field></section>
    <section className="ad-section">
      <div className="ad-section-heading"><div><h2>活動後，把回憶留在這裡</h2><p>切到「活動後」，同一張小卡就會打開紀念畫面，再由參加者點進你的照片服務。</p></div></div>
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
    {validation && <p className="ad-message ad-message-error" role="alert">{validation}</p>}<div className="ad-save-bar"><p>儲存後，開啟中的前台約 15 秒內更新；無須重新寫卡。</p><button className="ad-button ad-button-primary" disabled={busy}>{busy ? "正在儲存…" : "儲存頁面內容"}</button></div>
  </form>;
}

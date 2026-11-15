"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type NfcRecord = { recordType: string; data?: DataView | null };
type NfcReadingEvent = Event & { message: { records: NfcRecord[] } };
export interface NfcReader extends EventTarget {
  write(message: { records: { recordType: "url"; data: string }[] }, options: { overwrite: false; signal: AbortSignal }): Promise<void>;
  scan(options: { signal: AbortSignal }): Promise<void>;
}
type ReaderConstructor = new () => NfcReader;
type Capability = "ready" | "insecure" | "embedded" | "unsupported" | "checking";
export type NfcEnvironment = { secure: boolean; topLevel: boolean; Reader?: ReaderConstructor };
export type NfcWriterState = {
  status: "idle" | "writing" | "written" | "verifying" | "verified" | "error" | "cancelled" | "timeout";
  message: string;
  written?: boolean;
};
export type NfcWriterProps = {
  url: string;
  /** Read-back readiness for this exact URL; writing alone never grants readiness. */
  onVerificationChange?: (verified: boolean, url: string) => void;
};
type Operation = {
  kind: "write" | "verify";
  reader: NfcReader;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  reading?: EventListener;
  readingError?: EventListener;
};

const INITIAL: NfcWriterState = { status: "idle", message: "選好這位參加者的空白卡，寫入後再驗證一次。" };
const CAPABILITY_MESSAGES: Record<Capability, string> = {
  ready: "",
  checking: "正在確認此瀏覽器能否寫卡…",
  insecure: "請以 HTTPS 開啟正式後台，再使用 Android 手機的 Chrome 寫卡。",
  embedded: "請在 Android Chrome 的獨立分頁開啟後台，內嵌預覽無法寫卡。",
  unsupported: "這個瀏覽器無法直接寫卡。請改用支援 NFC 的 Android 手機 Chrome；iPhone、iPad 或電腦可複製專屬連結，交由寫卡 App 或讀寫器處理。",
};

export function validateNfcUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("專屬連結格式不正確，請關閉視窗後重新開啟這位參加者的資料。"); }
  if (url.protocol === "http:") throw new Error("NFC 寫卡需要 HTTPS 專屬連結。請先以 HTTPS 開啟正式後台，再重新取得連結。");
  if (value !== value.trim() || url.protocol !== "https:" || url.username || url.password ||
    !/^\/t\/[a-f0-9]{48}$/.test(url.pathname) || url.search || url.hash || url.href !== value) {
    throw new Error("專屬連結格式不正確，請關閉視窗後重新開啟這位參加者的資料。");
  }
  return value;
}

function browserEnvironment(): NfcEnvironment {
  if (typeof window === "undefined") return { secure: false, topLevel: false };
  let topLevel = false;
  try { topLevel = window.self === window.top; } catch { /* Cross-origin frame. */ }
  return { secure: window.isSecureContext, topLevel, Reader: (window as Window & { NDEFReader?: ReaderConstructor }).NDEFReader };
}
function capability(environment: NfcEnvironment): Capability {
  if (!environment.secure) return "insecure";
  if (!environment.topLevel) return "embedded";
  return environment.Reader ? "ready" : "unsupported";
}
const subscribeCapability = () => () => {};
const getCapability = () => capability(browserEnvironment());
const serverCapability = (): Capability => "checking";
export function useNfcSupport(): { capability: Capability; ready: boolean; message: string } {
  const current = useSyncExternalStore(subscribeCapability, getCapability, serverCapability);
  return { capability: current, ready: current === "ready", message: CAPABILITY_MESSAGES[current] };
}

function failureMessage(error: unknown, kind: Operation["kind"]): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError") return kind === "write"
    ? "未獲得 NFC 權限，或卡片已有內容。請檢查權限並使用空白卡；已有內容的卡片可先驗證。"
    : "未獲得 NFC 權限，請允許後再按一次驗證。";
  if (name === "NotSupportedError") return "這個裝置或卡片不支援這次 NFC 操作。請確認手機已開啟 NFC，並使用可寫入 NDEF 的卡片。";
  if (name === "NotReadableError") return "手機暫時無法使用 NFC。請開啟 NFC、解鎖手機，再試一次。";
  if (name === "AbortError") return "NFC 操作已停止。若剛才已貼近卡片，請重新驗證內容。";
  return kind === "write" ? "寫入未能確認完成。請保持卡片靠近手機，先驗證內容，再決定是否重試。" : "暫時無法讀取卡片，請移開後再按一次驗證。";
}

/** One user-initiated operation at a time; late browser callbacks never change a newer session. */
export class NfcWriterSession {
  private active = false;
  private written = false;
  private verified = false;
  private operation: Operation | null = null;
  constructor(
    private readonly url: string,
    private readonly publish: (state: NfcWriterState) => void,
    private readonly environment: () => NfcEnvironment = browserEnvironment,
    private readonly timeoutMs = 30000,
    private onVerificationChange?: NfcWriterProps["onVerificationChange"],
  ) {}
  setVerificationListener(listener: NfcWriterProps["onVerificationChange"]) { this.onVerificationChange = listener; }
  activate() { this.active = true; this.setVerified(false); }
  dispose() { this.active = false; this.clear(); this.setVerified(false); }
  private setVerified(verified: boolean) {
    this.verified = verified;
    this.onVerificationChange?.(verified, this.url);
  }
  private emit(state: NfcWriterState) {
    this.setVerified(state.status === "verified");
    this.publish({ ...state, written: this.written });
  }
  private clear() {
    const operation = this.operation;
    this.operation = null;
    if (!operation) return;
    clearTimeout(operation.timer);
    if (operation.reading) operation.reader.removeEventListener("reading", operation.reading);
    if (operation.readingError) operation.reader.removeEventListener("readingerror", operation.readingError);
    operation.controller.abort();
  }
  private finish(operation: Operation, state: NfcWriterState) {
    if (!this.active || this.operation !== operation) return;
    if (state.status === "written") this.written = true;
    this.clear(); this.emit(state);
  }
  cancel(message = "已停止等待。若剛才已貼近卡片，請按「驗證卡片」確認內容。") {
    if (!this.active || (!this.operation && !this.verified)) return;
    this.clear(); this.emit({ status: "cancelled", message });
  }
  start(kind: Operation["kind"]) {
    if (!this.active || this.operation || (kind === "write" && this.written)) return;
    const environment = this.environment(), support = capability(environment);
    if (support !== "ready" || !environment.Reader) { this.emit({ status: "error", message: CAPABILITY_MESSAGES[support] }); return; }
    let url: string;
    try { url = validateNfcUrl(this.url); }
    catch (error) { this.emit({ status: "error", message: error instanceof Error ? error.message : "專屬連結格式不正確，請關閉視窗後重新開啟這位參加者的資料。" }); return; }
    let reader: NfcReader;
    try { reader = new environment.Reader(); }
    catch (error) { this.emit({ status: "error", message: failureMessage(error, kind) }); return; }
    const controller = new AbortController();
    const operation: Operation = {
      kind, reader, controller,
      timer: setTimeout(() => this.finish(operation, { status: "timeout", message: "等候已超過 30 秒。請重新按下操作；若剛才已貼近卡片，可先驗證內容。" }), this.timeoutMs),
    };
    this.operation = operation;
    this.emit({ status: kind === "write" ? "writing" : "verifying", message: kind === "write"
      ? "請允許 NFC，將一張空白卡貼近手機背面的感應區，保持不動。"
      : "請允許 NFC，將要確認的卡片移開後重新貼近手機。" });
    try {
      if (kind === "write") {
        // Keep the hardware call in the original click turn (required for browser permission).
        void reader.write({ records: [{ recordType: "url", data: url }] }, { overwrite: false, signal: controller.signal }).then(() => {
          this.finish(operation, { status: "written", message: "已完成寫入。請先移開卡片，再按「驗證卡片」重新感應。" });
        }, error => this.finish(operation, { status: "error", message: failureMessage(error, kind) }));
      } else {
        operation.reading = event => {
          let matches = false;
          try {
            const records = (event as NfcReadingEvent).message.records;
            matches = records.length === 1 && records[0].recordType === "url" && !!records[0].data &&
              new TextDecoder("utf-8", { fatal: true }).decode(records[0].data) === url;
          } catch { /* Malformed records are not a successful verification. */ }
          this.finish(operation, matches
            ? { status: "verified", message: "驗證成功，卡片內的專屬連結完全一致，可以交給這位參加者。" }
            : { status: "error", message: "這張卡的內容與本人的專屬連結不一致。請確認拿對卡片；這次只讀取，沒有改寫。" });
        };
        operation.readingError = () => this.finish(operation, { status: "error", message: "感應到卡片，但讀不到 NDEF 內容。請移開卡片後重新驗證。" });
        reader.addEventListener("reading", operation.reading);
        reader.addEventListener("readingerror", operation.readingError);
        void reader.scan({ signal: controller.signal }).catch(error => this.finish(operation, { status: "error", message: failureMessage(error, kind) }));
      }
    } catch (error) { this.finish(operation, { status: "error", message: failureMessage(error, kind) }); }
  }
}

export default function NfcWriter({ url, onVerificationChange }: NfcWriterProps) {
  return <NfcWriterControls key={url} url={url} onVerificationChange={onVerificationChange} />;
}

function NfcWriterControls({ url, onVerificationChange }: NfcWriterProps) {
  const { capability: support } = useNfcSupport();
  const [state, setState] = useState<NfcWriterState>(INITIAL);
  const [session] = useState(() => new NfcWriterSession(url, setState));
  // Updating the parent callback must never restart a scan or clear verification.
  useEffect(() => { session.setVerificationListener(onVerificationChange); }, [session, onVerificationChange]);
  useEffect(() => {
    session.activate();
    const pause = () => { if (document.visibilityState === "hidden") session.cancel("已離開畫面，NFC 等候已停止。回來後請重新驗證卡片。"); };
    const leave = () => session.cancel();
    document.addEventListener("visibilitychange", pause); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", pause); window.removeEventListener("pagehide", leave); session.dispose(); };
  }, [session]);
  let urlError = "";
  try { validateNfcUrl(url); } catch (error) { urlError = error instanceof Error ? error.message : "專屬連結格式不正確，請重新開啟這位參加者的資料。"; }
  const valid = !urlError;
  const busy = state.status === "writing" || state.status === "verifying";
  const ready = support === "ready" && valid;
  const message = support !== "ready" ? CAPABILITY_MESSAGES[support] : urlError || state.message;
  return <section className="ad-section" aria-label="寫入與驗證 NFC 卡片">
    <h3>寫入這位參加者的空白卡</h3>
    <p className="ad-muted">一次只靠近一張卡。寫入會保留卡片可再次寫入的狀態；已有內容的卡片不會被覆寫。</p>
    <div className="ad-actions">
      <button type="button" className="ad-button ad-button-primary" disabled={!ready || busy || state.written} onClick={() => session.start("write")}>{state.written ? "已寫入這張卡" : state.status === "writing" ? "等待空白卡…" : "寫入空白卡"}</button>
      <button type="button" className="ad-button" disabled={!ready || busy} onClick={() => session.start("verify")}>{state.status === "verifying" ? "等待驗證…" : "驗證卡片"}</button>
      {busy && <button type="button" className="ad-button" onClick={() => session.cancel()}>取消等候</button>}
    </div>
    <p className={state.status === "error" || (support === "ready" && !valid) ? "ad-inline-warning" : state.status === "verified" ? "ad-success-text" : "ad-muted"} role="status" aria-live="polite" aria-atomic="true">{message}</p>
  </section>;
}

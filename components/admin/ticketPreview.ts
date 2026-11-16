import qrcode from "@/vendor/qrcode-generator/qrcode.mjs";
import type { Ticket } from "./tickets.mjs";

// The preview is an in-memory same-origin blank window, never a public URL or print queue.
export function renderTicketPreview(popup: Window, tickets: Ticket[]) {
  const doc = popup.document;
  doc.title = "載耶票券列印預覽";
  const style = doc.createElement("style");
  style.textContent = `@page{size:57mm 110mm;margin:0}*{box-sizing:border-box}body{margin:0;background:#ddd;color:#000;font-family:Arial,"Noto Sans TC",sans-serif}.controls{position:sticky;top:0;background:white;padding:12px;text-align:center}.controls button{padding:10px 20px}.ticket{width:57mm;height:110mm;background:#fff;padding:3mm;break-after:page;page-break-after:always}.ticket:last-child{break-after:auto;page-break-after:auto}.frame{height:100%;border:1px solid #000;border-radius:3mm;text-align:center;padding:4mm 3mm}.brand{font-size:14pt;font-weight:800;letter-spacing:2px}.subtitle{font-size:9pt;margin:2mm 0 3mm}.divider{border-top:1px solid #000;margin:2mm 0}.label{font-size:8pt;letter-spacing:2px;margin:2mm 0 1mm}.name{font-size:17pt;font-weight:bold;overflow-wrap:anywhere;line-height:1.15}.number{font-size:17pt;font-weight:bold}.qr{width:32mm;height:32mm;margin:2mm auto}.qr svg{width:100%;height:100%;display:block}.footer{font-size:7pt;letter-spacing:1px}@media print{body{background:#fff}.controls{display:none}}`;
  doc.head.append(style);
  const controls = doc.createElement("div"); controls.className = "controls";
  const hint = doc.createElement("p"); hint.textContent = `共 ${tickets.length} 張。請選 57mm 紙張、黑白、100% 比例並關閉頁首頁尾；先預覽確認。此頁含私人連結，請妥善保管或關閉。`;
  const button = doc.createElement("button"); button.type = "button"; button.textContent = "開啟列印對話框"; button.onclick = () => popup.print();
  controls.append(hint, button); doc.body.append(controls);
  function text(parent: Element, className: string, value: string) { const el = doc.createElement("div"); el.className = className; el.textContent = value; parent.append(el); }
  for (const ticket of tickets) {
    const page = doc.createElement("section"); page.className = "ticket";
    const frame = doc.createElement("div"); frame.className = "frame"; page.append(frame);
    text(frame,"brand","TZAI YEAH"); text(frame,"subtitle","載耶・聖誕聚會"); text(frame,"divider","");
    text(frame,"label","參加者"); text(frame,"name",ticket.name); text(frame,"divider","");
    text(frame,"label","卡號"); text(frame,"number",`# ${ticket.number}`);
    const qr = qrcode(0, "M"); qr.addData(ticket.url); qr.make();
    const qrEl = doc.createElement("div"); qrEl.className = "qr"; qrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true }); frame.append(qrEl);
    text(frame,"footer","MERRY CHRISTMAS"); doc.body.append(page);
  }
}

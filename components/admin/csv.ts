import type { Card, Group } from "@/lib/contracts";

export interface ImportRow { name: string; house?: string; groupId?: string | null; cardSerial?: string }
export interface ImportPreview { rows: ImportRow[]; errors: string[] }

export function parseCSV(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else cell += c;
    } else if (c === '"') {
      if (cell.length || afterQuote) throw new Error("CSV 引號格式不正確，請重新匯出 UTF-8 CSV。");
      quoted = true;
    } else if (c === ",") { row.push(cell); cell = ""; afterQuote = false; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = []; cell = ""; afterQuote = false;
    } else {
      if (afterQuote && c.trim()) throw new Error("CSV 引號後有多餘文字，請檢查檔案格式。");
      if (!afterQuote) cell += c;
    }
  }
  if (quoted) throw new Error("CSV 有尚未關閉的引號。");
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export function prepareImport(source: string, groups: Pick<Group, "id" | "name">[], cards: (Pick<Card, "serial"> & Partial<Pick<Card, "active" | "participantId">>)[]): ImportPreview {
  const matrix = parseCSV(source);
  if (matrix.length < 2) return { rows: [], errors: ["檔案需要標題列，以及至少一位參加者。"] };
  if (matrix.length > 501) return { rows: [], errors: ["每次最多匯入 500 位參加者。"] };
  const header = matrix[0].map(value => value.trim().toLowerCase());
  const find = (names: string[]) => header.findIndex(value => names.includes(value));
  const nameColumn = find(["姓名", "name", "參加者"]);
  const houseColumn = find(["家別", "house"]);
  const groupColumn = find(["組別", "group", "groupid", "組別名稱"]);
  const cardColumn = find(["卡號", "cardserial", "流水號"]);
  if (nameColumn < 0) return { rows: [], errors: ["找不到「姓名」欄位，請下載範本後填寫。"] };
  if (new Set(header).size !== header.length) return { rows: [], errors: ["標題列有重複欄位，請確認每個欄位名稱不同。"] };
  const rows: ImportRow[] = [], errors: string[] = [], usedCards = new Set<string>();
  matrix.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const value = (column: number) => column < 0 ? "" : (cells[column] ?? "").trim();
    const name = value(nameColumn), house = value(houseColumn), group = value(groupColumn), serial = value(cardColumn);
    if (cells.length !== header.length) errors.push(`第 ${line} 列：欄位數與標題列不同。`);
    if (!name) errors.push(`第 ${line} 列：請填寫姓名。`);
    if (name.length > 80 || house.length > 80) errors.push(`第 ${line} 列：姓名或家別超過 80 字。`);
    const matchedGroups = groups.filter(item => item.id === group || item.name === group);
    if (group && matchedGroups.length !== 1) errors.push(`第 ${line} 列：組別「${group}」不存在或名稱重複，請先整理組別。`);
    const card = cards.find(item => item.serial === serial) ?? cards.find(item => item.serial === serial.padStart(3, "0"));
    if (serial && !card) errors.push(`第 ${line} 列：找不到卡號「${serial}」。`);
    if (card?.active === false) errors.push(`第 ${line} 列：卡號 ${card.serial} 已停用，請改用有效小卡。`);
    if (card?.participantId) errors.push(`第 ${line} 列：卡號 ${card.serial} 已配對給其他參加者。`);
    if (card && usedCards.has(card.serial)) errors.push(`第 ${line} 列：卡號 ${card.serial} 在這份檔案中重複。`);
    if (card) usedCards.add(card.serial);
    rows.push({ name, house, groupId: matchedGroups[0]?.id ?? null, ...(card ? { cardSerial: card.serial } : {}) });
  });
  return { rows, errors };
}

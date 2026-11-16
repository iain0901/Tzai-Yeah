// Ticket preparation is deliberately read-only: never provision links while printing.
function houseNumber(house) {
  const match = String(house).trim().match(/^(?:第)?([0-9一二三四五六七八九十兩]+)(?:家)?$/);
  if (!match) return null;
  const text = match[1];
  if (/^\d+$/.test(text)) return Number(text);
  const digit = { 一:1, 二:2, 兩:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
  if (text === '十') return 10;
  if (text.length === 1) return digit[text] ?? null;
  const m = text.match(/^([一二兩三四五六七八九])?十([一二兩三四五六七八九])?$/);
  return m ? (m[1] ? digit[m[1]] : 1) * 10 + (m[2] ? digit[m[2]] : 0) : null;
}
export function prepareTickets(people, origin) {
  if (!people.length) throw new Error('名單為空，沒有可列印的票券。');
  const numbers = new Set();
  return people.map(person => {
    const h = houseNumber(person.house), n = person.householdNumber;
    if (!person.name?.trim() || !Number.isInteger(h) || h < 1 || h > 99 || !Number.isInteger(n) || n < 1 || n > 99) throw new Error(`${person.name || '未具名人員'}：家別或家內編號無法轉為兩位數（1–99），請先修正。`);
    const number = `1${String(h).padStart(2,'0')}${String(n).padStart(2,'0')}`;
    if (numbers.has(number)) throw new Error(`票券編號 ${number} 重複，請先修正名單。`);
    numbers.add(number);
    let url;
    try { url = new URL(person.url, origin); } catch { throw new Error(`${person.name}：缺少或無效的專屬連結。`); }
    if (!person.url || !person.linkActive || url.origin !== origin || !/^https?:$/.test(url.protocol) || !/^\/t\/[a-f0-9]{48}$/.test(url.pathname) || url.search || url.hash || url.username || url.password) throw new Error(`${person.name}：專屬連結缺少、停用或格式不正確，請先確認；未產生任何票券。`);
    return { name: person.name, number, url: url.href };
  }).sort((a,b) => a.number.localeCompare(b.number));
}

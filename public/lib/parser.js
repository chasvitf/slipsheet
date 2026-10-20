// Turns OCR lines of a Thai transfer slip or receipt into fields.
// Pure functions, shared by the browser page and the Node tests/eval.

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const MONTHS = {
  มค: 1, กพ: 2, มีค: 3, เมย: 4, พค: 5, มิย: 6, กค: 7, สค: 8, กย: 9, ตค: 10, พย: 11, ธค: 12,
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6,
  กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export const CATEGORIES = [
  ["ค่าน้ำค่าไฟ", /ไฟฟ้า|ค่าไฟ|คำไฟ|ค่าน้ำ|ประปา|พลังงาน|อินเทอร์เน็ต|โทรศัพท์/],
  ["ค่าเช่า", /เช่า/],
  ["ค่าแรง", /ค่าแรง|เงินเดือน|ค่าจ้าง/],
  ["ค่าส่ง", /ขนส่ง|ค่าส่ง|พัสดุ|ไปรษณีย์|express/i],
  ["บรรจุภัณฑ์", /กล่อง|ถุง|แพ็ค|บรรจุ/],
  ["วัตถุดิบ", /ผัก|หมู|ไก่|ข้าวสาร|วัตถุดิบ|ตลาด|เนื้อ|ปลา|ไข่|ผลไม้/],
  ["อุปกรณ์", /เครื่องเขียน|อุปกรณ์|ปากกา|กระดาษ|สมุด/],
];

const KEY = {
  amount: /จำนวนเงิน|จำนวน|ยอดเงิน|ยอดโอน|ยอดสุทธิ|รวมทั้งสิ้น|ยอดรวม|รวมเงิน|amount|total/i,
  fee: /ค่าธรรมเนียม|fee/i,
  sender: /^(จาก|ผู้โอน|from)/i,
  recipient: /^(ไป[ก-๛]{1,3}ง|ผู้รับเงิน|ผู้รับ|ถึง|to)(?![a-z])/i,
  ref: /เลขที่รายการ|รหัสอ้างอิง|เลขที่อ้างอิง|เลขอ้างอิง|รายการ:|ref|เลขที่/i,
  memo: /บันทึกช่วยจำ|หมายเหตุ|memo|note/i,
  banner: /ไม่ใช่เอกสารจริง|ร้านสมมติ/,
};

const MONEY = /(\d{1,3}(?:,\s?\d{3})+|\d+)\.\d{2}(?!\d)/g;

export function normalize(s) {
  return s.normalize("NFC")
    .replace(/ํา/g, "ำ")      // ํ + า -> ำ
    .replace(/ํ\s*า/g, "ำ")
    .replace(/้้า/g, "้ำ")  // น้้า -> น้ำ
    .replace(/\s+/g, " ")
    .trim();
}

const toArabic = (s) => s.replace(/[๐-๙]/g, (d) => THAI_DIGITS.indexOf(d));
const hasThai = (s) => /[ก-๛]/.test(s);
const isMask = (s) => /^[xX×%\d๐-๙\s*-]{6,}$/.test(s) || /[xX]{3}-/.test(s);
const clean = (s) => s.replace(/^[\s:.\-–|]+|[\s:\-–|]+$/g, "");
// Thai-name tidy: OCR often splits Thai words with stray spaces/punctuation.
const tidy = (s) => clean(s.replace(/[|_"“”'`~^]/g, "").replace(/\s{2,}/g, " "));

export function parseAmount(s) {
  const m = [...toArabic(s).matchAll(MONEY)].map((x) => Number(x[0].replace(/[,\s]/g, "")));
  return m.length ? m[m.length - 1] : null;
}

export function parseDate(raw) {
  // OCR reads ต as ๓ inside month names ("๓ต.ค.", "ต๓.ค."): fix before digits become Arabic
  const s = toArabic(raw.replace(/๓(?=[ก-ฮ.])|(?<=[ก-ฮ])๓/g, "ต"));
  const named = s.match(/(\d{1,2})\s*([ก-๛A-Za-z][ก-๛A-Za-z.\s]{0,12}?)\s*\.?\s*(\d{4}|\d{2})(?!\d)/);
  if (named) {
    const key = named[2].replace(/[.\s]/g, "").replace(/([ก-ฮ])\1+/g, "$1").toLowerCase();
    // a stray mark before the month ("ดต.ค.") still ends with the real short name
    const month = MONTHS[key] ?? MONTHS[key.slice(0, 3)] ??
      MONTHS[Object.keys(MONTHS).find((k) => k.length <= 3 && key.length === k.length + 1 && key.endsWith(k))];
    if (month) return ymd(+named[1], month, named[3]);
  }
  const num = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?!\d)/);
  if (num) return ymd(+num[1], +num[2], num[3]);
  return null;
}

function ymd(d, m, y) {
  let year = +y;
  if (y.length === 2) year = year >= 50 ? 2500 + year : 2000 + year; // 2-digit years on Thai slips are BE
  if (year > 2400) year -= 543;
  if (d < 1 || d > 31 || m < 1 || m > 12 || year < 2000 || year > 2100) return null;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseTime(raw) {
  const m = toArabic(raw).match(/(?:^|[^\d.,])([01]?\d|2[0-3])[:.]([0-5]\d)(?=\s*(น|น\.|$|[^\d]))/);
  if (!m) return null;
  if (/\d\.\d{2}\s*บาท/.test(raw) && !/:/.test(raw)) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// Text after the label on the same line, or the next useful line.
function valueAfter(lines, i, label) {
  const rest = tidy(lines[i].replace(label, ""));
  if (rest && hasThai(rest) && !isMask(rest)) return [rest, i];
  for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
    const v = tidy(lines[j]);
    if (v && hasThai(v) && !isMask(v)) return [v, j];
  }
  return [null, -1];
}

export function categorize(...texts) {
  const t = texts.filter(Boolean).join(" ");
  for (const [name, re] of CATEGORIES) if (re.test(t)) return name;
  return "อื่นๆ";
}

export function parseSlip(rawLines, qr = null) {
  const lines = rawLines.map((l) => normalize(typeof l === "string" ? l : l.text));
  const all = lines.join("\n");
  const at = {};
  const out = { kind: /ใบเสร็จ|ใบแสร็จ|ใบกำกับภาษี|receipt/i.test(all) && !/โอนเงิน|ผู้รับเงิน|ไปยัง/.test(all) ? "receipt" : "slip",
    date: null, time: null, amount: null, sender: null, recipient: null, ref: null, memo: null, category: null, qr: null };

  lines.forEach((l, i) => {
    if (KEY.banner.test(l)) return;
    if (!out.date) { const d = parseDate(l); if (d) { out.date = d; at.date = i; } }
    if (!out.time) { const t = parseTime(l); if (t && !/บาท/.test(l)) { out.time = t; at.time ??= i; } }
  });

  // amount: labelled line (same or next line) beats any loose number
  for (let i = 0; i < lines.length && out.amount == null; i++) {
    if (!KEY.amount.test(lines[i]) || KEY.fee.test(lines[i])) continue;
    for (const j of [i, i + 1]) {
      const v = j < lines.length && !KEY.fee.test(lines[j]) ? parseAmount(lines[j]) : null;
      if (v != null) { out.amount = v; at.amount = j; break; }
    }
  }
  if (out.amount == null) {
    let best = -1;
    lines.forEach((l, i) => {
      if (KEY.fee.test(l) || KEY.banner.test(l)) return;
      const v = parseAmount(l.replace(/^[8฿B]\s+(?=\d)/, ""));
      if (v != null && v > best) { best = v; at.amount = i; }
    });
    if (best >= 0) out.amount = best;
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const lead = l.split(" ")[0];
    if (!out.sender && KEY.sender.test(lead)) [out.sender, at.sender] = valueAfter(lines, i, KEY.sender);
    else if (!out.recipient && KEY.recipient.test(lead)) [out.recipient, at.recipient] = valueAfter(lines, i, KEY.recipient);
    if (!out.memo && KEY.memo.test(l)) {
      const m = tidy(l.split(/[:：]/).slice(1).join(":") || l.replace(KEY.memo, ""));
      if (m) { out.memo = m; at.memo = i; }
    }
  }

  if (out.kind === "receipt" && !out.recipient) {
    const i = lines.findIndex((l) => !KEY.banner.test(l) && /^(ร้าน|บจก|บริษัท|หจก)/.test(l));
    const j = i >= 0 ? i : lines.findIndex((l) => !KEY.banner.test(l) && hasThai(l) && l.length > 4);
    if (j >= 0) { out.recipient = tidy(lines[j]); at.recipient = j; }
  }

  for (let i = 0; i < lines.length && !out.ref; i++) {
    if (!KEY.ref.test(lines[i])) continue;
    for (const j of [i, i + 1]) {
      if (j >= lines.length) break;
      const src = j === i ? lines[j].replace(/.*?(เลขที่รายการ|รหัสอ้างอิง|เลขที่อ้างอิง|เลขอ้างอิง|รายการ|ref|เลขที่)\s*[:.]?/i, "") : lines[j];
      const tok = toArabic(src).match(/[A-Z0-9][A-Z0-9-]{5,}/i);
      if (tok && /\d{4}/.test(tok[0])) { out.ref = tok[0]; at.ref = j; break; }
    }
  }
  if (!out.ref) {
    const i = lines.findIndex((l) => /\d{12,}/.test(toArabic(l)));
    if (i >= 0) { out.ref = toArabic(lines[i]).match(/\d{12,}/)[0]; at.ref = i; }
  }

  if (qr) {
    out.qr = { ...qr, matchesText: out.ref ? out.ref === qr.ref : null };
    if (!out.ref || out.ref !== qr.ref) out.ref = qr.ref; // QR is machine-readable, trust it over OCR
  }

  out.category = categorize(out.memo, out.recipient, out.kind === "receipt" ? all : "");
  out.at = at;
  return out;
}

// Same transfer twice (resent screenshot): same ref, or same amount + date + time.
export function findDuplicate(rows, r) {
  return rows.find((x) => (r.ref && x.ref === r.ref) ||
    (r.amount != null && x.amount === r.amount && x.date === r.date && r.time && x.time === r.time)) || null;
}

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const COLUMNS = ["date", "time", "kind", "amount", "category", "recipient", "sender", "memo", "ref"];
export const HEADERS = ["วันที่", "เวลา", "ประเภท", "จำนวนเงิน", "หมวด", "ผู้รับ/ร้าน", "ผู้โอน", "บันทึก", "เลขอ้างอิง"];
export function toCSV(rows) {
  return [HEADERS, ...rows.map((r) => COLUMNS.map((c) => r[c]))].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
export function toTSV(rows) {
  const cell = (v) => (v == null ? "" : String(v).replace(/[\t\n]/g, " "));
  return [HEADERS, ...rows.map((r) => COLUMNS.map((c) => r[c]))].map((r) => r.map(cell).join("\t")).join("\n");
}

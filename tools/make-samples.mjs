// Builds the fictional sample slips/receipts in public/samples + truth.json.
// Banks, shops and people are made up; every image carries a "ตัวอย่าง" mark.
import { chromium } from "playwright";
import QRCode from "qrcode";
import { writeFileSync, mkdirSync } from "node:fs";
import { buildSlipQR } from "../public/lib/qr.js";

const OUT = new URL("../public/samples/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let seed = 20261021;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const BANKS = [
  { name: "ธนาคารหินอ่อน", code: "991", color: "#334155", layout: "rows" },
  { name: "ธนาคารชมพู่", code: "992", color: "#be185d", layout: "stack" },
  { name: "ธนาคารกาแฟ", code: "993", color: "#78350f", layout: "big" },
];
const SENDERS = ["นางสาว ใจดี มีสุข", "นาย ก้อง ตัวอย่าง", "นาง พรทิพย์ ทดลอง"];
const PAYEES = [
  { name: "ร้าน ผักสดบ้านสวน", memo: "ค่าผัก", cat: "วัตถุดิบ", lo: 300, hi: 2500 },
  { name: "แม่ศรีหมูสด", memo: "ค่าหมู", cat: "วัตถุดิบ", lo: 500, hi: 4000 },
  { name: "ร้าน ข้าวสารทองคำ", memo: "ข้าวสาร 2 กระสอบ", cat: "วัตถุดิบ", lo: 1200, hi: 3000 },
  { name: "บจก. ตัวอย่างพลังงาน", memo: "ค่าไฟ ต.ค.", cat: "ค่าน้ำค่าไฟ", lo: 1500, hi: 6000 },
  { name: "สำนักงานน้ำประปาตัวอย่าง", memo: "ค่าน้ำ", cat: "ค่าน้ำค่าไฟ", lo: 150, hi: 900 },
  { name: "บจก. ส่งไวขนส่ง", memo: "ค่าส่งพัสดุ", cat: "ค่าส่ง", lo: 60, hi: 800 },
  { name: "นาง มาลี เช่าดี", memo: "ค่าเช่าร้าน ต.ค.", cat: "ค่าเช่า", lo: 6000, hi: 15000 },
  { name: "นาย สมชาย ขยันยิ่ง", memo: "ค่าแรงรายสัปดาห์", cat: "ค่าแรง", lo: 2000, hi: 4500 },
  { name: "ร้าน กล่องดีแพ็ค", memo: "กล่อง+ถุง", cat: "บรรจุภัณฑ์", lo: 250, hi: 1800 },
];
const SHOPS = [
  { name: "ร้าน ผักสดบ้านสวน", cat: "วัตถุดิบ", items: [["ผักบุ้ง", 25], ["คะน้า", 35], ["พริก", 60], ["กระเทียม", 80]] },
  { name: "ร้าน กล่องดีแพ็ค", cat: "บรรจุภัณฑ์", items: [["กล่องกระดาษ", 120], ["ถุงหูหิ้ว", 45], ["เทปกาว", 35]] },
  { name: "ร้าน เครื่องเขียนตัวอย่าง", cat: "อุปกรณ์", items: [["ปากกา", 15], ["สมุด", 30], ["กระดาษ A4", 125]] },
];

const money = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const iso = (d) => d.toISOString().slice(0, 10);
const mask = () => `xxx-x-x${int(1000, 9999)}-x`;

const CSS = `
*{box-sizing:border-box;margin:0}
body{font-family:"Sukhumvit Set","Thonburi",sans-serif;background:#d4d4d8}
.shot{display:inline-block;padding:24px}
.shot.photo{background:#6b6f76;padding:30px 26px}
.card{width:380px;background:#fff;border-radius:18px;overflow:hidden;position:relative;color:#111827}
.mark{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.mark span{transform:rotate(-28deg);font-size:64px;font-weight:700;color:rgba(220,38,38,.07);white-space:nowrap}
.top{padding:18px 20px;color:#fff;font-weight:700;font-size:18px;display:flex;justify-content:space-between;align-items:center}
.top small{font-weight:400;font-size:12px;opacity:.85}
.ok{font-size:20px;font-weight:700;padding:16px 20px 2px}
.when{padding:0 20px 12px;color:#4b5563;font-size:15px}
.sec{padding:10px 20px;border-top:1px solid #eef0f3}
.lab{font-size:13px;color:#6b7280}
.val{font-size:17px;font-weight:600}
.acc{font-size:13px;color:#6b7280}
.row{display:flex;justify-content:space-between;gap:12px;padding:9px 20px;border-top:1px solid #eef0f3;font-size:15px}
.row b{text-align:right}
.amt{font-size:30px;font-weight:700;padding:6px 20px 14px}
.foot{display:flex;gap:14px;align-items:center;padding:14px 20px 18px;border-top:1px solid #eef0f3}
.foot img{width:92px;height:92px}
.foot p{font-size:13px;color:#4b5563;line-height:1.5;word-break:break-all}
.banner{background:#fef2f2;color:#b91c1c;font-size:12px;text-align:center;padding:4px}
.rc{width:340px;background:#fffdf7;color:#1f2937;padding:22px 22px 26px;position:relative;font-size:15px;border-radius:4px}
.rc h1{font-size:20px;text-align:center}
.rc .sub{text-align:center;color:#6b7280;font-size:13px;margin-bottom:10px}
.rc h2{font-size:17px;text-align:center;margin:8px 0 10px;letter-spacing:1px}
.rc .ln{display:flex;justify-content:space-between;padding:3px 0}
.rc hr{border:0;border-top:1px dashed #9ca3af;margin:8px 0}
.rc .tot{font-weight:700;font-size:18px}
.rc .thx{text-align:center;color:#6b7280;margin-top:12px;font-size:13px}
`;

async function qr(text) {
  return QRCode.toDataURL(text, { margin: 1, width: 184, errorCorrectionLevel: "M" });
}

function slipHTML(t, bank, qrData) {
  const head = `<div class="banner">สลิปตัวอย่าง · ไม่ใช่เอกสารจริง</div>
    <div class="top" style="background:${bank.color}">${bank.name}<small>ตัวอย่าง</small></div>`;
  const foot = `<div class="foot"><img src="${qrData}" alt=""><p>เลขที่รายการ:<br>${t.ref}</p></div>`;
  const memo = t.memo ? `บันทึกช่วยจำ: ${esc(t.memo)}` : "";
  if (bank.layout === "rows") {
    return `${head}<div class="ok">โอนเงินสำเร็จ</div><div class="when">${t.whenText}</div>
      <div class="row"><span>จาก</span><b>${esc(t.sender)}<br><span class="acc">${t.accFrom}</span></b></div>
      <div class="row"><span>ไปยัง</span><b>${esc(t.recipient)}<br><span class="acc">${t.accTo}</span></b></div>
      <div class="row"><span>จำนวนเงิน</span><b>${money(t.amount)} บาท</b></div>
      <div class="row"><span>ค่าธรรมเนียม</span><b>0.00 บาท</b></div>
      ${memo ? `<div class="row"><span>${memo}</span></div>` : ""}${foot}`;
  }
  if (bank.layout === "stack") {
    return `${head}<div class="ok">ทำรายการสำเร็จ</div><div class="when">${t.whenText}</div>
      <div class="sec"><div class="lab">จาก</div><div class="val">${esc(t.sender)}</div><div class="acc">${t.accFrom}</div></div>
      <div class="sec"><div class="lab">ไปยัง</div><div class="val">${esc(t.recipient)}</div><div class="acc">${t.accTo}</div></div>
      <div class="sec"><div class="lab">จำนวน</div><div class="val">${money(t.amount)} บาท</div></div>
      ${memo ? `<div class="sec"><div class="lab">${memo}</div></div>` : ""}${foot}`;
  }
  return `${head}<div class="ok">โอนเงินสำเร็จ</div><div class="amt">฿ ${money(t.amount)}</div>
    <div class="when">${t.whenText}</div>
    <div class="sec"><div class="lab">ผู้โอน</div><div class="val">${esc(t.sender)}</div></div>
    <div class="sec"><div class="lab">ผู้รับเงิน</div><div class="val">${esc(t.recipient)}</div></div>
    ${memo ? `<div class="sec"><div class="lab">${memo}</div></div>` : ""}${foot}`;
}

function receiptHTML(t, shop, lines) {
  return `<div class="banner">ใบเสร็จตัวอย่าง · ร้านสมมติ</div>
    <h1>${esc(shop.name)}</h1><div class="sub">99/9 ถนนตัวอย่าง อ.เมือง</div>
    <h2>ใบเสร็จรับเงิน</h2>
    <div class="ln"><span>เลขที่ ${t.ref}</span><span>วันที่ ${t.whenText}</span></div><hr>
    ${lines.map(([n, q, p]) => `<div class="ln"><span>${esc(n)} x${q}</span><span>${money(q * p)}</span></div>`).join("")}
    <hr><div class="ln tot"><span>รวมทั้งสิ้น</span><span>${money(t.amount)}</span></div>
    <div class="thx">ขอบคุณที่ใช้บริการ</div>`;
}

const truth = [];
const browser = await chromium.launch();

async function shoot(file, inner, cls, photo) {
  const page = await browser.newPage({ deviceScaleFactor: photo ? 1.4 : 2 });
  const tilt = photo ? `transform:rotate(${(rnd() * 4 - 2).toFixed(2)}deg);filter:blur(.45px) brightness(.93) contrast(.92);` : "";
  await page.setContent(`<style>${CSS}</style><body><div class="shot ${photo ? "photo" : ""}">
    <div class="${cls}" style="${tilt}"><div class="mark"><span>ตัวอย่าง</span></div>${inner}</div></div></body>`);
  await page.waitForLoadState("networkidle");
  const el = photo ? page.locator(".shot") : page.locator(`.${cls}`);
  await el.screenshot({ path: OUT + file, type: "jpeg", quality: photo ? 62 : 88 });
  await page.close();
}

for (let i = 1; i <= 30; i++) {
  const bank = BANKS[i % 3];
  const p = pick(PAYEES);
  const d = new Date(Date.UTC(2026, 9, int(1, 20), int(7, 21), int(0, 59)));
  const amount = int(p.lo, p.hi) + (rnd() < 0.3 ? int(1, 99) / 100 : 0);
  const be = d.getUTCFullYear() + 543;
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  const whenText = i % 2 ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(be).slice(2)} ${hh}:${mm} น.`
                         : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${be} - ${hh}:${mm}`;
  const ref = `${iso(d).replace(/-/g, "")}${hh}${mm}${bank.code}${String(int(100000, 999999))}`;
  const t = {
    file: `slip-${String(i).padStart(2, "0")}.jpg`, kind: "slip", date: iso(d), time: `${hh}:${mm}`, amount,
    sender: pick(SENDERS), recipient: p.name, ref, memo: rnd() < 0.8 ? p.memo : "", category: p.cat,
    condition: i % 4 === 0 ? "photo" : "screenshot", whenText, accFrom: mask(), accTo: mask(),
  };
  await shoot(t.file, slipHTML(t, bank, await qr(buildSlipQR(bank.code, ref))), "card", t.condition === "photo");
  truth.push(t);
}

for (let i = 1; i <= 10; i++) {
  const shop = SHOPS[i % 3];
  const d = new Date(Date.UTC(2026, 9, int(1, 20)));
  const lines = shop.items.filter(() => rnd() < 0.8).map(([n, p]) => [n, int(1, 5), p]);
  if (!lines.length) lines.push([...shop.items[0].slice(0, 1), 2, shop.items[0][1]]);
  const amount = lines.reduce((s, [, q, p]) => s + q * p, 0);
  const t = {
    file: `receipt-${String(i).padStart(2, "0")}.jpg`, kind: "receipt", date: iso(d), time: "", amount,
    sender: "", recipient: shop.name, ref: `R2569-${String(int(1, 9999)).padStart(4, "0")}`, memo: "", category: shop.cat,
    condition: "photo",
    whenText: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear() + 543}`,
  };
  await shoot(t.file, receiptHTML(t, shop, lines), "rc", true);
  truth.push(t);
}

await browser.close();
writeFileSync(OUT + "truth.json",
  JSON.stringify(truth.map(({ whenText, accFrom, accTo, ...t }) => t), null, 1) + "\n");
console.log(`wrote ${truth.length} samples`);

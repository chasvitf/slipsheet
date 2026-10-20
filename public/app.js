import { parseSlip, findDuplicate, toCSV, toTSV, CATEGORIES, COLUMNS } from "./lib/parser.js";
import { readSlipQR } from "./lib/qr.js";

const $ = (id) => document.getElementById(id);
const STORE = "slipsheet.rows.v1";
const FIELD_LABEL = { amount: "ยอด", date: "วันที่", time: "เวลา", recipient: "ผู้รับ", sender: "ผู้โอน", memo: "บันทึก", ref: "เลขอ้างอิง" };
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thaiDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${+m[3]} ${TH_MONTHS[m[2] - 1]} ${String(+m[1] + 543).slice(2)}` : "-";
};
const baht = (n) => Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let rows = load();
let queue = [];
let current = null;
let worker = null;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(rows)); } catch { /* private mode: keep in memory */ }
}

// ---------- OCR ----------
async function getWorker(onProgress) {
  if (worker) return worker;
  while (!window.Tesseract) await new Promise((r) => setTimeout(r, 50));
  worker = await Tesseract.createWorker(["tha", "eng"], 1, {
    logger: (m) => m.status && onProgress?.(m),
  });
  return worker;
}

function loadImage(src) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error("เปิดรูปนี้ไม่ได้ ลองใช้ไฟล์ JPG หรือ PNG"));
    img.src = src;
  });
}

// Big phone photos are slow to OCR; 1800 px on the long side keeps Thai text readable.
function toCanvas(img) {
  const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function readQR(canvas) {
  if (!window.jsQR) return null;
  const { data, width, height } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  const hit = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
  return hit ? readSlipQR(hit.data) : null;
}

async function analyse(src, name) {
  const status = $("status");
  status.textContent = "กำลังเตรียมตัวอ่านภาษาไทย (ครั้งแรกโหลดประมาณ 5 MB)…";
  const img = await loadImage(src);
  const canvas = toCanvas(img);
  const w = await getWorker((m) => {
    if (m.status === "recognizing text") status.textContent = `กำลังอ่าน ${Math.round(m.progress * 100)}%`;
  });
  const t0 = performance.now();
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
  const lines = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines)
    if (l.text.trim()) lines.push({ text: l.text.trim(), bbox: l.bbox });
  const qr = readQR(canvas);
  const parsed = parseSlip(lines, qr);
  return { name, src, canvas, lines, parsed, ms: Math.round(performance.now() - t0) };
}

// ---------- review ----------
function showMarks(res) {
  const svg = $("marks");
  const W = res.canvas.width;
  svg.setAttribute("viewBox", `0 0 ${W} ${res.canvas.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const byLine = {};
  for (const [f, i] of Object.entries(res.parsed.at)) if (i >= 0 && FIELD_LABEL[f]) (byLine[i] ||= []).push(FIELD_LABEL[f]);
  const pad = 4;
  const fs = Math.max(14, Math.round(W / 30));
  svg.innerHTML = Object.entries(byLine).map(([i, labels]) => {
    const { x0, y0, x1, y1 } = res.lines[i].bbox;
    return `<rect class="hl" x="${x0 - pad}" y="${y0 - pad}" width="${x1 - x0 + pad * 2}" height="${y1 - y0 + pad * 2}" rx="3"/>
      <g class="tag" data-x1="${x1 + pad}" data-x0="${x0 - pad}" data-y0="${y0 - pad}" data-cy="${(y0 + y1) / 2}">
        <rect rx="${fs / 2}"/><text font-size="${fs}">${labels.join(" · ")}</text></g>`;
  }).join("");
  // tag goes right of the line when it fits, otherwise just above its left edge
  for (const g of svg.querySelectorAll(".tag")) {
    const t = g.querySelector("text");
    const w = t.getComputedTextLength() + fs;
    const h = fs * 1.5;
    const right = +g.dataset.x1 + 8;
    const [x, y] = right + w <= W ? [right, +g.dataset.cy - h / 2] : [+g.dataset.x0, Math.max(0, +g.dataset.y0 - h - 2)];
    g.querySelector("rect").setAttribute("x", x); g.querySelector("rect").setAttribute("y", y);
    g.querySelector("rect").setAttribute("width", w); g.querySelector("rect").setAttribute("height", h);
    t.setAttribute("x", x + fs / 2); t.setAttribute("y", y + h / 2); t.setAttribute("dominant-baseline", "central");
  }
}

function fill(res) {
  const p = res.parsed;
  const form = $("fields");
  for (const el of form.querySelectorAll("[data-f]")) {
    const f = el.dataset.f;
    const v = p[f];
    el.value = v == null ? "" : f === "amount" ? v.toFixed(2) : v;
    el.classList.toggle("found", v != null && v !== "");
    el.classList.toggle("missing", v == null || v === "");
  }
  $("fields-title").textContent = p.kind === "receipt" ? "ใบเสร็จ: ข้อมูลที่อ่านได้" : "สลิปโอนเงิน: ข้อมูลที่อ่านได้";
  const chips = [];
  if (p.qr) chips.push(p.qr.crcOk === false ? ["bad", "QR เสียหาย"] : ["good", "อ่าน QR ได้"]);
  else if (p.kind === "slip") chips.push(["", "ไม่พบ QR"]);
  chips.push(["", `${(res.ms / 1000).toFixed(1)} วินาที`]);
  $("chips").innerHTML = chips.map(([c, t]) => `<span class="chip ${c}">${t}</span>`).join("");
  checkDuplicate();
  $("add").disabled = false;
  $("skip").disabled = false;
}

function formRow() {
  const fd = new FormData($("fields"));
  const r = Object.fromEntries(COLUMNS.map((c) => [c, (fd.get(c) ?? "").toString().trim() || null]));
  r.amount = r.amount == null ? null : Number(r.amount.replace(/[,\s]/g, ""));
  r.kind = current?.parsed.kind || "slip";
  return r;
}

function checkDuplicate() {
  const dup = findDuplicate(rows, formRow());
  const el = $("dup");
  el.hidden = !dup;
  $("add").textContent = dup ? "ลงซ้ำอยู่ดี" : "ลงบัญชี";
  $("add").classList.toggle("primary", !dup);
  if (dup) el.textContent = `สลิปนี้อาจซ้ำกับรายการวันที่ ${thaiDate(dup.date)} ยอด ${baht(dup.amount)} บาท ที่ลงไว้แล้ว`;
  return dup;
}

function reset() {
  current = null;
  $("add").disabled = $("skip").disabled = true;
  $("fields").reset();
  $("chips").innerHTML = "";
  $("dup").hidden = true;
  for (const el of document.querySelectorAll("[data-f]")) el.classList.remove("found", "missing");
}

async function next() {
  if (!queue.length) {
    if (!current) { $("scan").hidden = true; $("drop").hidden = false; }
    return;
  }
  const item = queue.shift();
  $("drop").hidden = true;
  $("scan").hidden = false;
  $("img").src = item.src;
  $("marks").innerHTML = "";
  reset();
  try {
    current = await analyse(item.src, item.name);
    showMarks(current);
    fill(current);
    const left = queue.length ? ` เหลืออีก ${queue.length} ใบ` : "";
    $("status").innerHTML = `ไฮไลต์เหลืองคือจุดที่อ่านได้ ตรวจแล้วกดลงบัญชี${left} <button type="button" id="another">เปลี่ยนรูป</button>`;
    $("another").onclick = () => { queue = []; reset(); $("scan").hidden = true; $("drop").hidden = false; $("file").click(); };
  } catch (e) {
    $("status").textContent = e.message || "อ่านรูปนี้ไม่สำเร็จ ลองรูปที่ชัดขึ้น";
    current = null;
  }
}

function enqueue(items) {
  const wasIdle = !queue.length && !current;
  queue.push(...items);
  if (wasIdle || !current) next();
  else $("status").textContent = `รอคิวอีก ${queue.length} ใบ`;
}

// ---------- ledger ----------
function render(newIndex = -1) {
  const tbody = $("rows");
  const sorted = rows.map((r, i) => [r, i]).sort((a, b) => (b[0].date || "").localeCompare(a[0].date || "") || (b[0].time || "").localeCompare(a[0].time || ""));
  tbody.innerHTML = sorted.map(([r, i]) => `<tr class="${i === newIndex ? "new" : ""}">
    <td>${thaiDate(r.date)}<span class="sub">${esc(r.time || (r.kind === "receipt" ? "ใบเสร็จ" : ""))}</span></td>
    <td>${esc(r.recipient || "-")}${r.memo ? `<span class="sub">${esc(r.memo)}</span>` : ""}</td>
    <td>${esc(r.category || "อื่นๆ")}</td>
    <td class="num">${r.amount == null ? "-" : baht(r.amount)}</td>
    <td><button type="button" data-del="${i}" aria-label="ลบรายการ ${esc(r.recipient || "")}">ลบ</button></td></tr>`).join("");
  $("empty").hidden = rows.length > 0;
  for (const id of ["copy", "csv", "clear"]) $(id).disabled = !rows.length;

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const byCat = {};
  for (const r of rows) byCat[r.category || "อื่นๆ"] = (byCat[r.category || "อื่นๆ"] || 0) + (r.amount || 0);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  $("summary").innerHTML = rows.length ? `<div class="total"><span>รวม ${rows.length} รายการ</span><b>฿${baht(total)}</b></div>
    <div class="bars">${cats.map(([c, v]) => `<div class="bar"><span>${esc(c)}</span><i style="width:${(v / max) * 100}%"></i><em>${baht(v)}</em></div>`).join("")}</div>` : "";
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function stamp() {
  const s = $("stamp");
  s.classList.remove("on");
  void s.offsetWidth;
  s.classList.add("on");
  setTimeout(() => s.classList.remove("on"), 1500);
}

// ---------- wiring ----------
const sel = document.querySelector("[data-f=category]");
sel.innerHTML = [...CATEGORIES.map(([c]) => c), "อื่นๆ"].map((c) => `<option>${c}</option>`).join("");

$("fields").addEventListener("input", checkDuplicate);
$("fields").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!current) return;
  const r = formRow();
  if (r.amount == null || Number.isNaN(r.amount)) { $("dup").hidden = false; $("dup").textContent = "ใส่จำนวนเงินก่อนลงบัญชี"; return; }
  rows.push(r);
  save();
  render(rows.length - 1);
  stamp();
  current = null;
  setTimeout(() => { if (!current) next(); }, queue.length ? 700 : 0);
  if (!queue.length) {
    $("add").disabled = $("skip").disabled = true;
    $("status").textContent = "ลงบัญชีแล้ว เลือกรูปถัดไปได้เลย";
    setTimeout(() => { if (!current && !queue.length) { $("scan").hidden = true; $("drop").hidden = false; reset(); } }, 1600);
  }
});
$("skip").addEventListener("click", () => { current = null; reset(); next(); });

$("file").addEventListener("change", (e) => {
  const files = [...e.target.files].filter((f) => f.type.startsWith("image/"));
  enqueue(files.map((f) => ({ src: URL.createObjectURL(f), name: f.name })));
  e.target.value = "";
});
const drop = $("drop");
for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
  enqueue(files.map((f) => ({ src: URL.createObjectURL(f), name: f.name })));
});
document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) enqueue(files.map((f) => ({ src: URL.createObjectURL(f), name: "วางจากคลิปบอร์ด" })));
});

$("rows").addEventListener("click", (e) => {
  const i = e.target.dataset?.del;
  if (i == null) return;
  rows.splice(Number(i), 1);
  save();
  render();
});
$("clear").addEventListener("click", () => {
  if (!$("clear").dataset.armed) {
    $("clear").dataset.armed = "1";
    $("clear").textContent = "กดอีกครั้งเพื่อล้าง";
    setTimeout(() => { delete $("clear").dataset.armed; $("clear").textContent = "ล้างทั้งหมด"; }, 3000);
    return;
  }
  rows = []; save(); render();
  delete $("clear").dataset.armed; $("clear").textContent = "ล้างทั้งหมด";
});
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(toTSV(rows));
    $("copy").textContent = "ก๊อปแล้ว เปิด Google Sheets แล้วกดวาง";
  } catch {
    $("copy").textContent = "ก๊อปไม่ได้ ใช้ปุ่ม CSV แทน";
  }
  setTimeout(() => ($("copy").textContent = "ก๊อปไปวางใน Google Sheets"), 3500);
});
$("csv").addEventListener("click", () => {
  const blob = new Blob(["﻿" + toCSV(rows)], { type: "text/csv;charset=utf-8" }); // BOM so Excel shows Thai
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `slipsheet-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// samples + accuracy
fetch("samples/truth.json").then((r) => r.json()).then((truth) => {
  const pickFiles = ["slip-01.jpg", "slip-02.jpg", "slip-03.jpg", "slip-04.jpg", "receipt-02.jpg", "slip-10.jpg", "receipt-01.jpg", "slip-12.jpg"];
  const items = pickFiles.map((f) => truth.find((t) => t.file === f)).filter(Boolean);
  $("strip").innerHTML = items.map((t) => `<button type="button" data-s="${t.file}">
      <img src="samples/${t.file}" alt="${t.kind === "receipt" ? "ใบเสร็จ" : "สลิป"}ตัวอย่าง ${esc(t.recipient)}" loading="lazy" width="104" height="150">
      ${t.kind === "receipt" ? "ใบเสร็จ" : t.condition === "photo" ? "ภาพถ่าย" : "แคปหน้าจอ"}</button>`).join("")
    + `<button type="button" class="more" id="all8">ลงทั้ง ${items.length} ใบ</button>`;
  $("strip").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "all8") enqueue(items.map((t) => ({ src: `samples/${t.file}`, name: t.file })));
    else enqueue([{ src: `samples/${b.dataset.s}`, name: b.dataset.s }]);
    $("viewer").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });
}).catch(() => {});

fetch("eval.json").then((r) => r.json()).then((ev) => {
  const names = { amount: "จำนวนเงิน", date: "วันที่", time: "เวลา", ref: "เลขอ้างอิง", recipient: "ผู้รับ / ร้าน", sender: "ผู้โอน", memo: "บันทึกช่วยจำ", category: "หมวด" };
  const g = ev.groups;
  const cell = (x) => x ? `<td class="num"><b>${x.ok}/${x.n}</b><span class="meter"><i style="width:${(x.ok / x.n) * 100}%"></i></span>${x.near > x.ok ? `<span class="sub">ต่างไม่เกิน 1–2 ตัวอักษร: ${x.near}/${x.n}</span>` : ""}</td>` : `<td class="num">ไม่มีในเอกสาร</td>`;
  $("acc-lead").textContent = `ทดสอบกับเอกสารตัวอย่าง ${ev.n} ใบ (สลิป ${g.slip.n} ใบ ใบเสร็จ ${g.receipt.n} ใบ) ด้วยโค้ดเดียวกับที่หน้านี้ใช้ อ่านใบละประมาณ ${(ev.msMedian / 1000).toFixed(1)} วินาที วัดเมื่อ ${thaiDate(ev.generated)}`;
  $("acc").innerHTML = `<table><thead><tr><th>ข้อมูล</th><th class="num">แคปหน้าจอ (${g.screenshot.n})</th><th class="num">ภาพถ่าย (${g.photo.n})</th><th class="num">รวม (${g.all.n})</th></tr></thead><tbody>
    ${Object.keys(names).map((f) => `<tr><td>${names[f]}</td>${cell(g.screenshot.fields[f])}${cell(g.photo.fields[f])}${cell(g.all.fields[f])}</tr>`).join("")}
    </tbody></table>`;
}).catch(() => { $("acc").textContent = "โหลดผลทดสอบไม่ได้"; });

render();

// read-only hook for debugging and the end-to-end check
window.slipsheet = { get current() { return current; }, get rows() { return rows; } };

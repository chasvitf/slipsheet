// Runs the same OCR + QR + parser as the page over every sample and scores it
// against truth.json. Writes public/eval.json (shown on the page).
import { readFileSync, writeFileSync } from "node:fs";
import { makeWorker, ocrLines, decodeQR } from "./ocr.mjs";
import { parseSlip, normalize } from "../public/lib/parser.js";
import { readSlipQR } from "../public/lib/qr.js";

const DIR = new URL("../public/samples/", import.meta.url).pathname;
const truth = JSON.parse(readFileSync(DIR + "truth.json", "utf8"));
const FIELDS = ["amount", "date", "time", "recipient", "sender", "ref", "memo", "category"];
const same = (f, a, b) => f === "amount" ? a === b : normalize(String(a ?? "")).replace(/\s/g, "") === normalize(String(b ?? "")).replace(/\s/g, "");

// character-level similarity (1 - edit distance / length), for "close but not exact" names
function sim(a, b) {
  a = normalize(String(a ?? "")).replace(/\s/g, ""); b = normalize(String(b ?? "")).replace(/\s/g, "");
  if (!a || !b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}

const worker = await makeWorker();
const results = [];
const t0 = Date.now();
for (const t of truth) {
  const s = Date.now();
  const lines = await ocrLines(worker, DIR + t.file);
  const qr = readSlipQR(decodeQR(DIR + t.file));
  const got = parseSlip(lines, qr);
  const fields = {};
  for (const f of FIELDS) {
    if (t[f] === "" || t[f] == null) continue; // field not on this document
    fields[f] = { ok: same(f, got[f], t[f]), near: ["recipient", "sender", "memo", "ref"].includes(f) && sim(got[f], t[f]) >= 0.9, got: got[f], want: t[f] };
  }
  results.push({ file: t.file, kind: t.kind, condition: t.condition, ms: Date.now() - s, qr: !!qr, fields });
}
await worker.terminate();

const groups = { all: results, screenshot: results.filter((r) => r.condition === "screenshot"),
  photo: results.filter((r) => r.condition === "photo"), slip: results.filter((r) => r.kind === "slip"),
  receipt: results.filter((r) => r.kind === "receipt") };
const score = (rs) => Object.fromEntries(FIELDS.map((f) => {
  const xs = rs.map((r) => r.fields[f]).filter(Boolean);
  return [f, xs.length ? { ok: xs.filter((x) => x.ok).length, near: xs.filter((x) => x.ok || x.near).length, n: xs.length } : null];
}));
const allOk = (rs) => rs.filter((r) => ["amount", "date"].every((f) => !r.fields[f] || r.fields[f].ok)).length;
const report = {
  generated: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" }),
  engine: "tesseract.js 7 (tha+eng) + jsQR + rules",
  n: results.length,
  msMedian: results.map((r) => r.ms).sort((a, b) => a - b)[results.length >> 1],
  groups: Object.fromEntries(Object.entries(groups).map(([k, rs]) => [k, { n: rs.length, amountDate: allOk(rs), fields: score(rs) }])),
  misses: results.flatMap((r) => Object.entries(r.fields).filter(([, v]) => !v.ok).map(([f, v]) => ({ file: r.file, field: f, got: v.got, want: v.want }))),
};
writeFileSync(new URL("../public/eval.json", import.meta.url), JSON.stringify(report, null, 1) + "\n");
const pct = (x) => x ? `${x.ok}/${x.n}` : "-";
for (const [k, g] of Object.entries(report.groups))
  console.log(k.padEnd(10), `n=${g.n}`, FIELDS.map((f) => `${f}:${pct(g.fields[f])}`).join(" "));
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s, median ${report.msMedian}ms`);

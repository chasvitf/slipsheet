import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSlip, parseDate, parseAmount, parseTime, findDuplicate, toCSV, toTSV, categorize } from "../public/lib/parser.js";
import { buildSlipQR, readSlipQR, parseTLV, crc16 } from "../public/lib/qr.js";

test("dates: Thai short/full months, BE 2/4-digit years, numeric, OCR ๓ for ต", () => {
  assert.equal(parseDate("19 ต.ค. 69 08:25 น."), "2026-10-19");
  assert.equal(parseDate("19 ๓.ค. 2569 - 07:16"), "2026-10-19");
  assert.equal(parseDate("14 ๓ต.ค. 69 08:04 น."), "2026-10-14");
  assert.equal(parseDate("17 ต๓ต.ค. 2569 - 07:50"), "2026-10-17");
  assert.equal(parseDate("9 ดต.ค. 69 12:36 U."), "2026-10-09");
  assert.equal(parseDate("๕ มกราคม ๒๕๖๙"), "2026-01-05");
  assert.equal(parseDate("วันที่ 08/10/2569"), "2026-10-08");
  assert.equal(parseDate("3 Oct 2026"), "2026-10-03");
  assert.equal(parseDate("32/13/2569"), null);
  assert.equal(parseDate("99/9 ถนนตัวอย่าง อ.เมือง"), null);
});

test("amounts: commas, OCR space after comma, Thai digits, last number on the line", () => {
  assert.equal(parseAmount("จำนวนเงิน 1,250.00 บาท"), 1250);
  assert.equal(parseAmount("4, 255.00 บาท"), 4255);
  assert.equal(parseAmount("๑,๐๐๐.๕๐"), 1000.5);
  assert.equal(parseAmount("ปากกา x5   75.00"), 75);
  assert.equal(parseAmount("ไม่มีตัวเลข"), null);
});

test("time: HH:MM with or without น., not money", () => {
  assert.equal(parseTime("19 ต.ค. 69 08:25 น."), "08:25");
  assert.equal(parseTime("19 ต.ค. 2569 - 7:16"), "07:16");
  assert.equal(parseTime("374.00 บาท"), null);
});

test("stacked slip layout", () => {
  const r = parseSlip([
    "ธนาคารตัวอย่าง", "ทํารายการสําเร็จ", "19 ต.ค. 69 08:25 น.", "จาก", "นางสาว ใจดี มีสุข", "XXX-X-X1628-x",
    "ไปยัง", "ร้าน กล่องดีแพ็ค", "XXX-X-X7790-x", "จํานวน", "374.00 บาท", "ค่าธรรมเนียม 0.00 บาท",
    "บันทึกช่วยจํา: กล่อง+ถุง", "เลขที่รายการ:", "202610190825992729678",
  ]);
  assert.equal(r.kind, "slip");
  assert.equal(r.date, "2026-10-19");
  assert.equal(r.time, "08:25");
  assert.equal(r.amount, 374);
  assert.equal(r.sender, "นางสาว ใจดี มีสุข");
  assert.equal(r.recipient, "ร้าน กล่องดีแพ็ค");
  assert.equal(r.memo, "กล่อง+ถุง");
  assert.equal(r.ref, "202610190825992729678");
  assert.equal(r.category, "บรรจุภัณฑ์");
  assert.equal(r.at.amount, 10);
});

test("row layout: label and value on one line, fee ignored", () => {
  const r = parseSlip([
    "โอนเงินสําเร็จ", "9 ต.ค. 69 12:36 น.", "จาก      นาง พรทิพย์ ทดลอง", "ไปยขัง     สํานักงานน้้าประปาตัวอย่าง",
    "จํานวนเงิน        734.00 บาท", "ค่าธรรมเนียม     10.00 บาท",
  ]);
  assert.equal(r.sender, "นาง พรทิพย์ ทดลอง");
  assert.equal(r.recipient, "สำนักงานน้ำประปาตัวอย่าง");
  assert.equal(r.amount, 734);
  assert.equal(r.category, "ค่าน้ำค่าไฟ");
});

test("big-amount layout: ฿ read as 8 still gives the amount", () => {
  const r = parseSlip(["โอนเงินสําเร็จ", "8 100.76", "19 ๓.ค. 2569 - 07:16", "ผู้โอน", "นาย ก้อง ตัวอย่าง", "ผู้รับเงิน", "บจก. ส่งไวขนส่ง"]);
  assert.equal(r.amount, 100.76);
  assert.equal(r.recipient, "บจก. ส่งไวขนส่ง");
  assert.equal(r.category, "ค่าส่ง");
});

test("receipt: shop name, total line, numeric date", () => {
  const r = parseSlip([
    "ร้าน เครื่องเขียนตัวอย่าง", "99/9 ถนนตัวอย่าง อ.เมือง", "ใบเสร็จรับเงิน", "เลขที่ R2569-7589   วันที่ 08/10/2569",
    "ปากกา x5   75.00", "กระดาษ A4 x3   375.00", "รวมทั้งสิ้น    450.00",
  ]);
  assert.equal(r.kind, "receipt");
  assert.equal(r.recipient, "ร้าน เครื่องเขียนตัวอย่าง");
  assert.equal(r.amount, 450);
  assert.equal(r.date, "2026-10-08");
  assert.equal(r.ref, "R2569-7589");
  assert.equal(r.category, "อุปกรณ์");
});

test("QR: TLV round trip, CRC, and QR ref overrides a misread OCR ref", () => {
  const p = buildSlipQR("991", "202610190825992729678");
  assert.deepEqual(readSlipQR(p), { bank: "991", ref: "202610190825992729678", crcOk: true });
  assert.equal(readSlipQR(p.slice(0, -1) + "0").crcOk, false);
  assert.equal(readSlipQR("hello"), null);
  assert.equal(parseTLV("0005ab"), null);
  assert.equal(crc16("123456789"), "29B1"); // CRC-16/CCITT-FALSE check value
  const r = parseSlip(["เลขที่รายการ:", "2026101908259927296"], readSlipQR(p));
  assert.equal(r.ref, "202610190825992729678");
  assert.equal(r.qr.matchesText, false);
});

test("duplicates and export", () => {
  const rows = [{ ref: "A1", amount: 10, date: "2026-10-01", time: "09:00", recipient: 'ร้าน "ดี", จำกัด' }];
  assert.ok(findDuplicate(rows, { ref: "A1" }));
  assert.ok(findDuplicate(rows, { ref: null, amount: 10, date: "2026-10-01", time: "09:00" }));
  assert.equal(findDuplicate(rows, { ref: "B2", amount: 10, date: "2026-10-02", time: "09:00" }), null);
  assert.match(toCSV(rows), /"ร้าน ""ดี"", จำกัด"/);
  assert.equal(toTSV(rows).split("\n").length, 2);
  assert.equal(categorize(null, "นาย ก"), "อื่นๆ");
});

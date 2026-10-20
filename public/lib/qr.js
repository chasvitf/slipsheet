// Thai bank slip mini-QR: EMVCo-style TLV (tag, 2-digit length, value).
// Tag 00 holds 00 = API id, 01 = bank code, 02 = transaction ref; 51 = country; 91 = CRC.

export function parseTLV(s) {
  const out = {};
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!Number.isInteger(len) || i + 4 + len > s.length) return null;
    out[tag] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return i === s.length ? out : null;
}

export function crc16(str) {
  let crc = 0xffff;
  for (const ch of str) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const tlv = (tag, v) => tag + String(v.length).padStart(2, "0") + v;

export function buildSlipQR(bank, ref) {
  const body = tlv("00", tlv("00", "000001") + tlv("01", bank) + tlv("02", ref)) + tlv("51", "TH") + "9104";
  return body + crc16(body);
}

export function readSlipQR(payload) {
  if (!payload) return null;
  const top = parseTLV(payload);
  if (!top || !top["00"]) return null;
  const inner = parseTLV(top["00"]);
  if (!inner || !inner["02"]) return null;
  const crcOk = top["91"] ? crc16(payload.slice(0, -4)) === top["91"] : null;
  return { bank: inner["01"] || null, ref: inner["02"], crcOk };
}

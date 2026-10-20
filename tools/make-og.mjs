// og.png = the real page mid-review (highlighted slip + filled form), framed at 1200x630.
import { chromium } from "playwright";
const base = process.argv[2] || "http://localhost:8765/";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
await p.goto(base);
await p.waitForSelector("#strip button");
await p.click("[data-s='slip-01.jpg']");
await p.waitForFunction(() => !document.getElementById("add").disabled, null, { timeout: 90000 });
await p.addStyleTag({ content: ".demo-note,.top,.intro,.scan figcaption{display:none!important} main{padding-top:30px} .scan-img img{max-height:560px}" });
await p.evaluate(() => scrollTo(0, 0));
await p.waitForTimeout(300);
await p.screenshot({ path: new URL("../public/og.png", import.meta.url).pathname, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await b.close();

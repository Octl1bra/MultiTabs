// 用 headless Chrome 把 SVG 渲成各尺寸 PNG：node scripts/icons.mjs
import puppeteer from "puppeteer-core";
const html = (size) => `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect x="0" y="0" width="128" height="128" rx="30" fill="#1d4ed8"/>
  <!-- 后面那张标签页 -->
  <path d="M40 34 h30 a8 8 0 0 1 8 8 v6 h20 a8 8 0 0 1 8 8 v40 a8 8 0 0 1 -8 8 h-58 a8 8 0 0 1 -8 -8 v-54 a8 8 0 0 1 8 -8z" fill="#ffffff" fill-opacity="0.45"/>
  <!-- 前面那张标签页 -->
  <path d="M22 50 h30 a8 8 0 0 1 8 8 v6 h20 a8 8 0 0 1 8 8 v34 a8 8 0 0 1 -8 8 h-58 a8 8 0 0 1 -8 -8 v-48 a8 8 0 0 1 8 -8z" fill="#ffffff"/>
</svg></body></html>`;
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage();
for (const size of [16, 32, 48, 96, 128]) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(html(size));
  await page.screenshot({
    path: `public/icon/${size}.png`,
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
}
// 商店图标：128 画布，图形 96 居中，四周 16px 透明留白（商店规范）
await page.setViewport({ width: 128, height: 128, deviceScaleFactor: 1 });
await page.setContent(html(96).replace("<svg ", '<svg style="position:absolute;left:16px;top:16px" '));
await page.screenshot({
  path: "docs/store/icon-128.png",
  omitBackground: true,
  clip: { x: 0, y: 0, width: 128, height: 128 },
});
await browser.close();

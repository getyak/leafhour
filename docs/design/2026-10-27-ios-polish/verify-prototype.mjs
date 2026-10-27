import {choosePassage,openNavigation,openProgress,openCompanion} from './browser-interactions.mjs';
import { captureDOM } from "../2026-10-26-ios-half-sheet/capture-dom.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

// Uses the same explicit browser-runtime convention as the repository's reader
// verification tools. The server serves only this public design directory.
const root = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)
  throw Error(
    "Set LEAFHOUR_PLAYWRIGHT_MODULE to an existing Playwright runtime.",
  );
const { chromium } = await import(
  pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE)
);
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(
      root,
      "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname),
    );
    if (!file.startsWith(root + path.sep))
      throw Error("Outside design directory");
    const bytes = await fs.readFile(file);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".json": "application/json",
      }[path.extname(file)] || "text/plain",
    );
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const report = {
  at: new Date().toISOString(),
  timeZone: "Asia/Singapore",
  kind: "design-prototype",
  checks: [],
  screens: [],
  errors: [],
  blockedExternalRequests: [],
  limits: [
    "Fixed public-domain Walden excerpts, independent draft translations and labelled example answers.",
    "No live model, production account, paid generation, notification or real library request.",
    "Chromium desktop/touch emulation only; not native SwiftUI, physical iPhone, Safari, VoiceOver speech, haptics or native keyboard acceptance.",
    "This run checks the Web prototype; Figma authoring and readback have separate evidence in figma-verification.json.",
  ],
};
const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--no-proxy-server"],
});
report.browser = { engine: "chromium", version: browser.version() };
async function context({ fixtureSize, ...options } = {}) {
  const c = await browser.newContext({
    viewport: { width: 402, height: 874 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "no-preference",
    ...options,
  });
  await c.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(base) || url.startsWith("data:"))
      return route.continue();
    report.blockedExternalRequests.push(url);
    return route.abort();
  });
  if (fixtureSize) await c.addInitScript(size => { if (!sessionStorage.getItem("leafhour-ios-half-sheet-prototype-v1")) sessionStorage.setItem("leafhour-ios-half-sheet-prototype-v1", JSON.stringify({ size })); }, fixtureSize);
  const p = await c.newPage();
  p.setDefaultTimeout(Number(process.env.LEAFHOUR_BROWSER_TIMEOUT_MS) || 10000);
  p.on("pageerror", (error) => report.errors.push(error.message));
  await p.goto(base + "/prototype/");
  return { c, p };
}
async function settled(p) {
  await p
    .locator('#reader-sheet[data-motion="settled"]')
    .waitFor({ state: "attached" });
  await p.waitForFunction(
    () => document.getElementById("reader-sheet").dataset.motion === "settled",
  );
}
async function close(p) {
  if (await p.locator("#reader-sheet").isVisible()) {
    await p.locator("#sheet-done").click();
    await p.locator("#reader-sheet").waitFor({ state: "hidden" });
  }
}
async function select(p, id) {
  await close(p);
  await choosePassage(p,id);
  await p.getByRole("button", { name: "解释这句", exact: true }).click();
  await settled(p);
}
const quote = (p) =>
  p
    .locator(".context-quote")
    .evaluate((node) => ({
      id: node.dataset.passageId,
      start: node.dataset.selectionStart,
      end: node.dataset.selectionEnd,
      text: node.querySelector(".quote-excerpt").textContent,
    }));
function pass(name, details = {}) {
  report.checks.push({ name, status: "pass", ...details });
  console.log("PASS " + name);
}

let active;
try {
  active = await context();
  let { p } = active;
  assert.equal(await p.locator("#reader-sheet").isVisible(), false);
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  pass("launch-enters-reading-with-companion-collapsed");
  const range = await p
    .locator("#walden-2-001 .passage-text")
    .evaluate((el) => {
      const text = el.firstChild,
        index = text.textContent.lastIndexOf("生活"),
        r = document.createRange();
      r.setStart(text, index);
      r.setEnd(text, index + 2);
      const rects = [...r.getClientRects()].filter(
          (b) => b.width > 0 && b.height > 0,
        ),
        first = rects[0],
        last = rects.at(-1);
      return {
        first: text.textContent.indexOf("生活"),
        start: index,
        end: index + 2,
        x1: first.left + 1,
        x2: last.right - 1,
        y1: first.top + first.height / 2,
        y2: last.top + last.height / 2,
      };
    });
  await p.mouse.move(range.x1, range.y1);
  await p.mouse.down();
  await p.mouse.move(range.x2, range.y2, { steps: 10 });
  await p.mouse.up();
  await p.locator("#reading-scroll").focus();
  await p.keyboard.press("Shift+F10");
  await p.getByRole("button", { name: "解释这句", exact: true }).click();
  await settled(p);
  const selected = await quote(p);
  assert.equal(+selected.start, range.start);
  assert.equal(+selected.end, range.end);
  assert.notEqual(range.start, range.first);
  assert.equal(selected.text, "生活");
  pass("repeated-word-selection-keeps-actual-utf16-range", {
    range: [range.start, range.end],
  });
  await active.c.close();
  active = await context();
  p = active.p;
  await select(p, "walden-2-001");
  const first = await quote(p);
  await p.locator("#question-input").fill("A 的未发送草稿");
  await select(p, "walden-2-002");
  assert.notEqual((await quote(p)).id, first.id);
  await p.locator("#question-input").fill("B 已发送的问题");
  await p.getByRole("button", { name: "发送问题", exact: true }).click();
  await settled(p);
  await p.locator("#draft-return").click();
  assert.equal((await quote(p)).id, first.id);
  assert.equal(
    await p.locator("#question-input").inputValue(),
    "A 的未发送草稿",
  );
  assert.doesNotMatch(
    await p.locator("#sheet-body").innerText(),
    /B 已发送的问题/,
  );
  pass("restored-draft-never-adopts-another-passages-sent-question");
  await active.c.close();
  // This check requires genuine book overflow after the sheet closes.
  active = await context({ fixtureSize: 28 });
  p = active.p;
  await select(p, "walden-2-001");
  await p.locator("#question-input").fill("核对出处后仍要保留的草稿");
  await p.locator("#sheet-grip").press("Enter");
  await settled(p);
  await p.locator("#sheet-body").hover();
  await p.mouse.wheel(0, 900);
  await p.waitForFunction(
    () => document.getElementById("sheet-body").scrollTop > 0,
  );
  const oldScroll = await p.locator("#sheet-body").evaluate((n) => n.scrollTop);
  const oldQuote = await quote(p);
  await p.getByRole("button", { name: "本段", exact: true }).click();
  await settled(p);
  await p.getByRole("button", { name: "返回讨论", exact: true }).click();
  await settled(p);
  assert.equal(
    await p.locator("#question-input").inputValue(),
    "核对出处后仍要保留的草稿",
  );
  assert.deepEqual(await quote(p), oldQuote);
  const newScroll = await p.locator("#sheet-body").evaluate((n) => n.scrollTop);
  assert.ok(Math.abs(oldScroll - newScroll) <= 2);
  assert.ok(
    await p
      .locator("#reader-sheet")
      .evaluate(
        (n) =>
          n.getBoundingClientRect().top >
          document.getElementById("phone").getBoundingClientRect().top + 300,
      ),
  );
  pass("citation-roundtrip-restores-half-detent-scroll-quote-and-draft", {
    beforeScroll: oldScroll,
    afterScroll: newScroll,
  });
  await p.locator("#reading-scroll").hover({ position: { x: 120, y: 60 } });
  await p.mouse.wheel(0, 170);
  await p.waitForFunction(
    () => document.getElementById("reading-scroll").scrollTop > 0,
  );
  // Wheel dispatch resolves before the scroll has finished applying.
  await p.waitForTimeout(200);
  const readingBefore = await p
    .locator("#reading-scroll")
    .evaluate((n) => n.scrollTop);
  await close(p);
  const readingAfter = await p
    .locator("#reading-scroll")
    .evaluate((n) => n.scrollTop);
  assert.ok(Math.abs(readingAfter - readingBefore) <= 2);
  pass("half-sheet-background-reading-survives-closing", {
    before: readingBefore,
    after: readingAfter,
  });
  await p.reload();
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(await p.locator("#reader-sheet").isVisible(), false);
  assert.ok(
    Math.abs(
      (await p.locator("#reading-scroll").evaluate((n) => n.scrollTop)) -
        readingAfter,
    ) <= 2,
  );
  pass("reopen-restores-reading-and-keeps-discussion-collapsed");
  await active.c.close();
  active = await context({
    viewport: { width: 980, height: 1060 },
    isMobile: false,
  });
  p = active.p;
  await p.locator("#offline-mode").check();
  await select(p, "walden-2-001");
  await p.locator("#question-input").fill("断网时提交的问题");
  await p.getByRole("button", { name: "发送问题", exact: true }).click();
  await settled(p);
  await p.locator("#question-input").fill("后来编辑但还没发送的问题");
  await p.locator("#offline-mode").uncheck();
  assert.match(await p.locator("#sheet-body").innerText(), /尚未重试/);
  assert.equal(await p.locator(".answer").count(), 0);
  await p.getByRole("button", { name: "重试这次提问", exact: true }).click();
  assert.equal(await p.locator(".answer").count(), 1);
  await p.locator("#draft-return").click();
  assert.equal(
    await p.locator("#question-input").inputValue(),
    "后来编辑但还没发送的问题",
  );
  pass("connection-recovery-requires-explicit-retry-and-retains-edited-draft");
  await active.c.close();
  active = await context();
  p = active.p;
  await select(p, "walden-2-001");
  await p.getByRole("button", { name: "记一句", exact: true }).click();
  await settled(p);
  await p.locator("#note-field").fill("A 的笔记草稿");
  await p.locator("#sheet-grip").press("Enter");
  await settled(p);
  await p.locator("#reading-scroll").hover({ position: { x: 130, y: 60 } });
  await p.mouse.wheel(0, 250);
  await choosePassage(p,"walden-2-002");
  await p.getByRole("button", { name: "记一句", exact: true }).click();
  await settled(p);
  assert.equal(await p.locator("#note-field").inputValue(), "");
  await p
    .locator("#note-field")
    .fill("（演示笔记）把自己的问题与讲解分开保存。");
  await p.getByRole("button", { name: "保存", exact: true }).click();
  await close(p);
  await openNavigation(p);await p.getByLabel("打开书房", { exact: true }).click();
  await settled(p);
  await p.getByRole("button", { name: /我的记录 笔记/ }).click();
  await settled(p);
  assert.match(await p.locator("#sheet-body").innerText(), /自己的笔记/);
  assert.match(
    await p.locator("#sheet-body").innerText(),
    /把自己的问题与讲解分开保存/,
  );
  pass(
    "note-drafts-stay-with-their-own-quote-and-saved-notes-keep-user-attribution",
  );
  await active.c.close();
  active = await context({
    viewport: { width: 320, height: 740 },
    reducedMotion: "reduce",
  });
  p = active.p;
  await openNavigation(p);await p.getByLabel("排版设置", { exact: true }).click();
  await settled(p);
  for (let i = 0; i < 6; i++)
    await p.getByLabel("增大字号", { exact: true }).click();
  await p.getByRole("button", { name: "夜读", exact: false }).click();
  assert.equal(await p.locator("#phone").getAttribute("data-theme"), "night");
  await close(p);
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await openCompanion(p);
  await settled(p);
  const composer = await p.locator("#composer").boundingBox();
  assert.ok(composer.y + composer.height <= 740);
  pass("320px-large-text-night-and-reduced-motion-remain-operable");
  await p
    .locator("#phone")
    .screenshot({
      path: path.join(root, "exports", "14-narrow-large-night.png"),
      animations: "disabled",
    });
  await active.c.close();
  active = await context({ reducedMotion: "reduce" });
  p = active.p;
  const states = [
    ["resume", "01-resume", "01 · 打开即续读"],
    ["selected", "02-selected", "02 · 选文"],
    ["companion", "03-companion", "03 · 半屏陪读"],
    ["discussion", "04-discussion", "04 · 展开讨论"],
    ["citation", "05-citation", "05 · 核对出处"],
    ["note", "06-note", "06 · 记一句"],
    ["original", "07-original", "07 · 原文与两种译文"],
    ["library", "08-library", "08 · 书房"],
    ["records", "09-records", "09 · 我的记录"],
    ["contents", "10-contents", "10 · 章节与段落"],
    ["appearance", "11-appearance", "11 · 阅读偏好"],
    ["offline", "12-offline", "12 · 连接失败"],
    ["night", "13-night", "13 · 夜读陪读"],
  ];
  await fs.mkdir(path.join(root, "captures"), { recursive: true });
  for (const [route, slug, name] of states) {
    await p.goto(
      base + "/prototype/" + (route === "resume" ? "" : "?state=" + route),
    );
    if (route === "selected")
      await choosePassage(p,"walden-2-001");
    if (route !== "resume" && route !== "selected") {
      await settled(p);
      await p.locator(".sheet-header").click({ position: { x: 200, y: 20 } });
    }
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await p
      .locator("#phone")
      .screenshot({ path: path.join(root, "exports", slug + ".png"), animations: "disabled" });
    const scene = await p.evaluate(captureDOM, { name });
    await fs.writeFile(
      path.join(root, "captures", slug + ".json"),
      JSON.stringify(scene, null, 2),
    );
    report.screens.push({ slug, width: scene.width, height: scene.height });
  }
  pass("13-core-states-render-at-402x874", { screens: 13 });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.blockedExternalRequests, []);
  pass("no-page-errors-and-no-external-network-requests");
  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.failure = { message: error.message, stack: error.stack };
  console.error(error);
  if (active?.p)
    await active.p
      .screenshot({
        path: path.join(root, "exports", "verification-failure.png"),
        fullPage: true,
      })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  await active?.c.close();
  await browser.close();
  server.close();
  report.sourceHashes = {};
  for (const file of [
    "prototype/app.js",
    "prototype/motion.mjs",
    "prototype/selection-position.mjs",
    "prototype/reading-position.mjs",
    "prototype/companion-context.mjs",
    "prototype/note-recovery.mjs",
    "prototype/reading-intent.mjs",
    "prototype/reading-progress.mjs",
    "prototype/style.css",
    "prototype/index.html",
  ])
    report.sourceHashes[file] = createHash("sha256")
      .update(await fs.readFile(path.join(root, file)))
      .digest("hex");
  await fs.writeFile(
    path.join(root, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.length,
      screens: report.screens.length,
    }),
  );
}

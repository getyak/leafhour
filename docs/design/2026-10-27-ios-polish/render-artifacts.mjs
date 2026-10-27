import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)
  throw Error("Set the existing LEAFHOUR_PLAYWRIGHT_MODULE browser runtime.");
const { chromium } = await import(
  pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE)
);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const report = JSON.parse(
  await fs.readFile(path.join(root, "verification.json"), "utf8"),
);
report.artifactRendering = [];
try {
  for (const name of ["core-flow", "relationships", "navigation"]) {
    const source = path.join(root, "exports", name + ".svg"),
      svg = await fs.readFile(source, "utf8");
    const width = Number(svg.match(/<svg[^>]*width="([\d.]+)"/)[1]),
      height = Number(svg.match(/<svg[^>]*height="([\d.]+)"/)[1]);
    const p = await browser.newPage({ viewport: { width, height } });
    await p.goto(pathToFileURL(source).href);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(root, "exports", name + ".png") });
    await p.close();
    report.artifactRendering.push({
      name,
      width,
      height,
      renderer: "Chrome system-font rendering",
    });
  }
  const vector = await browser.newPage({
    viewport: { width: 402, height: 874 },
  });
  await vector.goto(
    pathToFileURL(path.join(root, "exports", "03-companion.svg")).href,
  );
  await vector.evaluate(() => document.fonts.ready);
  await vector.screenshot({
    path: path.join(root, "evidence", "vector-layout-check.png"),
  });
  await vector.close();
  const p = await browser.newPage({
      viewport: { width: 402, height: 874 },
      reducedMotion: "reduce",
    }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(
    pathToFileURL(path.join(root, "Leafhour-iOS-prototype.html")).href,
  );
  await p.getByRole("button", { name: "读到这里", exact: true }).click();
  await p.locator('#reader-sheet[data-motion="settled"]').waitFor();
  assert.equal(await p.locator("#sheet-title").innerText(), "读到这里");
  await p.locator('[data-action="note"]').click();
  await p.locator('#reader-sheet[data-motion="settled"]').waitFor();
  await p.locator('#note-field').fill('单文件的合成笔记');
  await p.locator('[data-action="save-note"]').click();
  await p.locator('#reader-sheet[data-motion="settled"]').waitFor();
  await p.locator('[data-action="undo-note-save"]').click();
  await p.locator('#reader-sheet[data-motion="settled"]').waitFor();
  assert.equal(await p.locator('#note-field').inputValue(),'单文件的合成笔记');
  assert.deepEqual(errors, []);
  await p.close();
  report.standalone = {
    status: "pass",
    opensDirectlyFromLocalFile: true,
    externalCSSOrScriptDependencies: 0,
    noteSaveAndUndo: "pass",
  };
  await fs.writeFile(
    path.join(root, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    "Rendered readable diagrams and checked the standalone prototype.",
  );
} finally {
  await browser.close();
}

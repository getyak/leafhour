import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { build } from "esbuild";
const root = path.dirname(fileURLToPath(import.meta.url));
const measure = createCanvas(10, 10).getContext("2d");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const px = (v, fallback = 0) => Number.parseFloat(v) || fallback;
const family = (value) =>
  (value || "PingFang SC")
    .split(",")[0]
    .replaceAll('"', "")
    .replaceAll("'", "")
    .trim();
const isClear = (color) =>
  !color || color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
function lines(text, width, font, size, weight, spacing) {
  measure.font = `${weight || 400} ${size}px "${font}"`;
  const out = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    const units = paragraph.match(
      /[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*|[^\x00-\x7F]|\s+|./gu,
    ) || [""];
    for (const unit of units) {
      const candidate = current + unit;
      const estimated =
        measure.measureText(candidate).width +
        Math.max(0, [...candidate].length - 1) * spacing;
      if (
        current &&
        estimated > width + 1 &&
        !/^[，。！？；：、）》」』…]/u.test(unit)
      ) {
        out.push(current.trimEnd());
        current = unit.trimStart();
      } else current = candidate;
    }
    out.push(current.trimEnd());
  }
  return out;
}
function renderScene(scene) {
  let clipSeq = 0;
  const clips = [];
  function render(node) {
    if (node.kind === "svg") {
      let raw = node.svg.replace(
        "<svg ",
        `<svg width="${node.width}" height="${node.height}" fill="none" stroke="${esc(node.color)}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="color:${esc(node.color)}" `,
      );
      return `<g transform="translate(${node.x} ${node.y})">${raw}</g>`;
    }
    if (node.kind === "text") {
      if (node.glyphLines?.length) {
        const size = px(node.fontSize, 16);
        return node.glyphLines
          .map(
            (line) =>
              `<text x="${line.x}" y="${line.baseline}" fill="${esc(node.color || "#242A27")}" font-family="${esc(family(node.fontFamily))},sans-serif" font-weight="${esc(node.fontWeight || 400)}" font-size="${size}" letter-spacing="${px(node.letterSpacing)}" xml:space="preserve">${esc(line.text)}</text>`,
          )
          .join("");
      }
      const size = px(node.fontSize, 16),
        lineHeight = px(node.lineHeight, size * 1.2),
        font = family(node.fontFamily),
        spacing = px(node.letterSpacing);
      return `<text x="${node.x}" y="${node.y + size * 0.84}" fill="${esc(node.color || "#242A27")}" font-family="${esc(font)},sans-serif" font-weight="${esc(node.fontWeight || 400)}" font-size="${size}" letter-spacing="${spacing}">${lines(
        node.text,
        node.width,
        font,
        size,
        node.fontWeight,
        spacing,
      )
        .map(
          (line, index) =>
            `<tspan x="${node.x}" dy="${index ? lineHeight : 0}">${esc(line)}</tspan>`,
        )
        .join("")}</text>`;
    }
    const radius = px(node.radius),
      border = px(node.borderWidth);
    let background = isClear(node.background) ? "none" : node.background;
    let content = `<rect width="${node.width}" height="${node.height}" rx="${radius}" fill="${esc(background)}"${border ? ` stroke="${esc(node.borderColor)}" stroke-width="${border}"` : ""}/>`;
    if (node.field) {
      const f = node.field,
        size = px(f.fontSize, 16);
      content += render({
        kind: "text",
        name: f.name,
        text: f.text,
        x: px(f.paddingLeft),
        y: node.tag === "TEXTAREA" ? 8 : (node.height - size * 1.2) / 2,
        width: node.width - px(f.paddingLeft) - px(f.paddingRight),
        height: node.height,
        fontSize: f.fontSize,
        fontFamily: f.fontFamily,
        fontWeight: f.fontWeight,
        lineHeight: f.lineHeight,
        color: f.color,
      });
    }
    content += (node.children || []).map(render).join("");
    let clip = "";
    if (node.clip) {
      const id = "clip" + ++clipSeq;
      clips.push(
        `<clipPath id="${id}"><rect width="${node.width}" height="${node.height}" rx="${radius}"/></clipPath>`,
      );
      clip = ` clip-path="url(#${id})"`;
    }
    return `<g id="${esc(node.key || "")}" aria-label="${esc(node.name)}" transform="translate(${node.x} ${node.y})"${clip}>${content}</g>`;
  }
  const body = render(scene.root);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}"><title>${esc(scene.name)}</title><defs>${clips.join("")}</defs>${body}</svg>`;
}
await mkdir(path.join(root, "exports"), { recursive: true });
const files = (await readdir(path.join(root, "captures")))
  .filter((f) => f.endsWith(".json"))
  .sort();
const manifest = [];
for (const file of files) {
  const scene = JSON.parse(
    await readFile(path.join(root, "captures", file), "utf8"),
  );
  const slug = file.replace(".json", "");
  const vector = renderScene(scene);
  await writeFile(path.join(root, "exports", slug + ".svg"), vector);
  manifest.push({
    slug,
    name: scene.name,
    width: scene.width,
    height: scene.height,
    source: "captures/" + file,
    svg: "exports/" + slug + ".svg",
    png: "exports/" + slug + ".png",
  });
}
await writeFile(
  path.join(root, "design-manifest.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      source:
        "Observed prototype DOM geometry; text remains editable in SVG and capture JSON.",
      screens: manifest,
    },
    null,
    2,
  ),
);
const cols = 3,
  cardWidth = 402,
  gap = 58,
  header = 114,
  rows = Math.ceil(manifest.length / cols),
  w = cols * (cardWidth + gap) + gap,
  h = header + rows * (874 + 88) + 40;
const board = createCanvas(w, h),
  ctx = board.getContext("2d");
ctx.fillStyle = "#EEF1EC";
ctx.fillRect(0, 0, w, h);
ctx.fillStyle = "#365B47";
ctx.font = "32px Georgia";
ctx.fillText("Leafhour", gap, 58);
ctx.fillStyle = "#5D6A62";
ctx.font = '18px "PingFang SC"';
ctx.fillText("iOS · 半屏陪读 · 核心画面", gap + 180, 57);
for (let i = 0; i < manifest.length; i++) {
  const item = manifest[i],
    x = gap + (i % cols) * (cardWidth + gap),
    y = header + Math.floor(i / cols) * (874 + 88);
  try {
    const img = await loadImage(await readFile(path.join(root, item.png)));
    ctx.drawImage(img, x, y, 402, 874);
  } catch {}
  ctx.fillStyle = "#242A27";
  ctx.font = '18px "PingFang SC"';
  ctx.fillText(item.name, x, y + 905);
}
await writeFile(
  path.join(root, "exports", "screen-board.png"),
  board.toBuffer("image/png"),
);
const hero = createCanvas(1438, 1060);
const heroContext = hero.getContext("2d");
heroContext.fillStyle = "#EEF1EC";
heroContext.fillRect(0, 0, 1438, 1060);
heroContext.fillStyle = "#365B47";
heroContext.font = "32px Georgia";
heroContext.fillText("Leafhour", 58, 58);
heroContext.fillStyle = "#242A27";
heroContext.font = '19px "Songti SC"';
heroContext.fillText("继续阅读，沿着原句展开思考。", 240, 57);
for (const [index, slug] of [
  "01-resume",
  "03-companion",
  "05-citation",
].entries()) {
  const x = 58 + index * 460;
  const source = await loadImage(
    await readFile(path.join(root, "exports", slug + ".png")),
  );
  heroContext.drawImage(source, x, 110, 402, 874);
  heroContext.fillText(
    ["打开即续读", "半屏读与问", "核对出处，原路返回"][index],
    x,
    1024,
  );
}
await writeFile(
  path.join(root, "exports", "core-preview.png"),
  hero.toBuffer("image/png"),
);
const html = await readFile(path.join(root, "prototype", "index.html"), "utf8"),
  css = await readFile(path.join(root, "prototype", "style.css"), "utf8"),
  js = (await build({ entryPoints: [path.join(root, "prototype", "app.js")], bundle: true, write: false, format: "iife", target: "es2022" })).outputFiles[0].text;
const standalone = html
  .replace(
    /<link\s+rel="stylesheet"\s+href="style\.css"\s*\/?>/,
    `<style>${css}</style>`,
  )
  .replace(
    '<script type="module" src="app.js"></script>',
    `<script>${js.replaceAll("</script", "<\\/script")}</script>`,
  )
  .replaceAll("../exports/", "./exports/")
  .replaceAll("../README.md", "./README.md");
await writeFile(path.join(root, "Leafhour-iOS-prototype.html"), standalone);
console.log(
  JSON.stringify({
    screens: manifest.length,
    board: [w, h],
    standalone: "Leafhour-iOS-prototype.html",
  }),
);

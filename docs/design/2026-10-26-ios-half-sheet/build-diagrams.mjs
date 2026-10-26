import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const C = {
  paper: "#F7F8F5",
  ink: "#242A27",
  muted: "#5D6A62",
  green: "#365B47",
  line: "#DCE3DA",
  wash: "#EDF1EB",
  surface: "#FFFFFF",
};
const esc = (s) =>
  String(s).replace(
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
const text = (x, y, s, size = 20, color = C.ink, weight = 400) =>
  `<text x="${x}" y="${y}" fill="${color}" font-family="-apple-system,PingFang SC,sans-serif" font-size="${size}" font-weight="${weight}">${esc(s)}</text>`;
function block(x, y, w, h, title, lines, { accent = false } = {}) {
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="${accent ? C.green : C.surface}" stroke="${accent ? C.green : C.line}"/>` +
    text(x + 25, y + 43, title, 25, accent ? C.paper : C.ink, 500) +
    lines
      .map((s, i) =>
        text(x + 25, y + 79 + i * 28, s, 17, accent ? "#D9E5DA" : C.muted),
      )
      .join("")
  );
}
function arrow(d, label, x, y) {
  return (
    `<path d="${d}" fill="none" stroke="${C.green}" stroke-width="2" marker-end="url(#arrow)"/>` +
    (label ? text(x, y, label, 15, C.muted) : "")
  );
}
function svg(w, h, title, subtitle, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10" fill="${C.green}"/></marker></defs><rect width="${w}" height="${h}" fill="${C.paper}"/>${text(64, 76, "Leafhour", 26, C.green, 500)}${text(64, 144, title, 43, C.ink, 500)}${text(64, 190, subtitle, 20, C.muted)}${body}${text(64, h - 38, "设计原型 · 2026-10-26 · 与生产实现、原生手感验收分别记录", 15, C.muted)}</svg>`;
}
const flow = svg(
  1760,
  1080,
  "从上次那一句继续",
  "阅读位置、讨论位置与临时出处各自保存，往返时不相互覆盖。",
  [
    block(64, 255, 350, 145, "打开即续读", ["缓存正文先可读", "陪读默认收起"]),
    block(490, 255, 350, 145, "选择词句", [
      "解释／原文／记一句",
      "选择本身不改讨论上下文",
    ]),
    block(
      916,
      255,
      350,
      145,
      "半屏陪读",
      ["原句可见，上方正文可读", "问题绑定已发送的选文"],
      { accent: true },
    ),
    block(1342, 255, 350, 145, "展开讨论", [
      "上拉或聚焦输入",
      "草稿与回答位置保留",
    ]),
    arrow("M414 328H482", "", 0, 0),
    arrow("M840 328H908", "", 0, 0),
    arrow("M1266 328H1334", "上拉", 1275, 310),
    block(1342, 548, 350, 145, "核对出处", [
      "临时查看作者原文",
      "不覆盖正式阅读位置",
    ]),
    block(916, 548, 350, 145, "返回讨论", [
      "恢复问题、草稿、回答位置",
      "恢复原来的面板高度",
    ]),
    block(490, 548, 350, 145, "继续阅读", [
      "留在最新主动读到的位置",
      "「返回原句」是另一个动作",
    ]),
    arrow("M1517 400V540", "点引用", 1533, 476),
    arrow("M1342 620H1274", "", 0, 0),
    arrow("M916 620H848", "收起", 861, 601),
    arrow("M490 620H239V409", "", 0, 0),
    text(64, 851, "正常启动", 18, C.green, 500),
    text(
      64,
      885,
      "恢复正文与排版。没有历史位置时进入书房；显式引用链接优先定位引用。",
      20,
      C.muted,
    ),
    text(916, 851, "连接失败", 18, C.green, 500),
    text(
      916,
      885,
      "正文继续可读。问题与选文保留，恢复连接后显式重试。",
      20,
      C.muted,
    ),
    text(
      64,
      973,
      "新选文遇到旧草稿：用新句另开草稿，原问题仍能找回。",
      20,
      C.ink,
    ),
  ].join(""),
);
const relationships = svg(
  1760,
  1130,
  "一句话怎样关联所有理解",
  "稳定段落是共同锚点；读者的文字、作者原文与讲解回答分别归属。",
  [
    text(65, 270, "书的内容", 20, C.green, 500),
    text(650, 270, "位置与回程", 20, C.green, 500),
    text(1230, 270, "围绕一句话的讨论", 20, C.green, 500),
    block(64, 300, 420, 100, "一本书", ["来源版本与章节"]),
    block(64, 465, 420, 110, "稳定段落", ["同一段原文的长期标识"], {
      accent: true,
    }),
    block(64, 645, 420, 125, "原文与两种译文", [
      "作者原文／直译／意译",
      "独立保存、独立版本",
    ]),
    arrow("M274 400V457", "章节", 290, 439),
    arrow("M274 575V637", "", 0, 0),
    block(650, 300, 420, 125, "阅读位置", [
      "段落、段内位置、显示偏好",
      "主动阅读才更新",
    ]),
    block(650, 495, 420, 125, "讨论位置", [
      "问题、草稿、回答滚动位置",
      "面板高度与选文快照",
    ]),
    block(650, 690, 420, 125, "临时出处", ["引用目标＋返回帧", "不改阅读位置"]),
    arrow("M650 362H570V500H492", "", 0, 0),
    arrow("M860 690V628", "返回讨论", 880, 661),
    block(1230, 300, 466, 110, "选文快照", ["书、段落、实际版本与真实选区"]),
    block(1230, 480, 466, 110, "用户的问题", ["发送后不随正文滚动而换对象"]),
    block(1230, 660, 466, 125, "讲解回答与实际引用", [
      "引用必须能回到真实来源",
      "保存讲解不变成用户原话",
    ]),
    arrow("M1463 410V472", "", 0, 0),
    arrow("M1463 590V652", "", 0, 0),
    arrow("M1230 354H1135V450H540V550H492", "指向同一段", 1100, 442),
    arrow("M1230 723H1078", "查看出处", 1097, 701),
    `<rect x="64" y="895" width="1632" height="135" rx="20" fill="${C.wash}"/>`,
    text(90, 939, "自己的笔记", 24, C.ink, 500),
    text(
      90,
      979,
      "由读者自己写下并保存，指向原句；与讲解、原文和译文保持独立归属。私人笔记不自动进入提问上下文。",
      20,
      C.muted,
    ),
  ].join(""),
);
const navigation = svg(
  1760,
  980,
  "页面少，回程完整",
  "阅读是默认入口；书房和记录服务于回到书页。",
  [
    block(64, 300, 400, 145, "书房", ["选书／继续读", "记录与阅读偏好"]),
    block(
      680,
      300,
      400,
      145,
      "阅读",
      ["书房 · 书名/目录 · 排版", "正文与可收起的阅读工具"],
      { accent: true },
    ),
    block(1296, 300, 400, 145, "我的记录", [
      "自己的笔记／讨论",
      "点记录回到绑定原句",
    ]),
    arrow("M464 372H672", "选择一本书", 499, 349),
    arrow("M1296 372H1088", "返回原句", 1123, 349),
    block(680, 590, 400, 145, "半屏／展开陪读", [
      "解释、追问、出处、记一句",
      "都属于当前书的辅助层",
    ]),
    arrow("M880 445V582", "选文或「读到这里」", 907, 522),
    arrow("M680 660H580V410H672", "继续读", 480, 578),
    text(64, 853, "导航规则", 20, C.green, 500),
    text(
      64,
      894,
      "目录、排版、陪读均可收起。查看出处不把用户送入另一个失去回程的阅读会话。",
      23,
      C.ink,
    ),
  ].join(""),
);
await mkdir(path.join(root, "exports"), { recursive: true });
for (const [name, data] of Object.entries({
  "core-flow.svg": flow,
  "relationships.svg": relationships,
  "navigation.svg": navigation,
}))
  await writeFile(path.join(root, "exports", name), data);
await writeFile(
  path.join(root, "tokens.json"),
  JSON.stringify(
    {
      color: C,
      reading: { font: "Songti SC", size: 22, lineHeight: 1.83 },
      interface: { font: "PingFang SC", body: 16, label: 13 },
      frame: { width: 402, height: 874 },
      spacing: [4, 8, 12, 16, 20, 24, 28, 32],
      motion: {
        half: 0.52,
        full: 0.88,
        spring: { stiffness: 390, damping: 36 },
        reduced: "static positions; no bounce",
      },
    },
    null,
    2,
  ),
);
console.log("Exported core flow, relationships, navigation and design tokens.");

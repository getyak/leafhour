// Observed glyph baselines and line breaks keep the editable SVG independent
// of a second renderer's font substitution. No application state is accessed.
export function captureDOM({ name }) {
  const phone = document.getElementById("phone");
  const phoneRect = phone.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  const metrics = canvas.getContext("2d");
  const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
  let sequence = 0;
  function walk(node, parentRect) {
    if (node.nodeType === 3) {
      const value = node.textContent;
      if (!value.trim()) return null;
      const range = document.createRange();
      range.selectNodeContents(node);
      const b = range.getBoundingClientRect();
      if (!b.width || !b.height) return null;
      const s = getComputedStyle(node.parentElement);
      metrics.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const glyphLines = [];
      for (const { segment, index } of segmenter.segment(value)) {
        range.setStart(node, index);
        range.setEnd(node, index + segment.length);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const ascent = metrics.measureText(segment).fontBoundingBoxAscent;
        const baseline = rect.top - parentRect.top + ascent;
        let line = glyphLines.at(-1);
        if (!line || Math.abs(line.baseline - baseline) > 0.7) {
          line = { x: rect.left - parentRect.left, baseline, text: "" };
          glyphLines.push(line);
        }
        line.text += segment;
      }
      return {
        kind: "text",
        name: value.trim().slice(0, 32),
        text: value.trim(),
        x: b.x - parentRect.x,
        y: b.y - parentRect.y,
        width: b.width,
        height: b.height,
        glyphLines,
        fontFamily: s.fontFamily,
        fontWeight: s.fontWeight,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        color: s.color,
      };
    }
    if (node.nodeType !== 1) return null;
    const s = getComputedStyle(node);
    if (s.display === "none" || s.visibility === "hidden" || node.hidden)
      return null;
    const b = node.getBoundingClientRect();
    if (
      !b.width ||
      !b.height ||
      b.bottom < phoneRect.top ||
      b.top > phoneRect.bottom ||
      b.right < phoneRect.left ||
      b.left > phoneRect.right
    )
      return null;
    if (node.tagName.toLowerCase() === "svg")
      return {
        kind: "svg",
        name: "图标",
        x: b.x - parentRect.x,
        y: b.y - parentRect.y,
        width: b.width,
        height: b.height,
        svg: node.outerHTML,
        color: s.color,
      };
    const out = {
      kind: "frame",
      key: "n" + ++sequence,
      name:
        node.getAttribute("aria-label") ||
        node.id ||
        node.className ||
        node.tagName,
      x: b.x - parentRect.x,
      y: b.y - parentRect.y,
      width: b.width,
      height: b.height,
      background: s.backgroundColor,
      color: s.color,
      radius: s.borderTopLeftRadius,
      borderWidth: s.borderTopWidth,
      borderColor: s.borderTopColor,
      clip:
        ["hidden", "auto", "scroll", "clip"].includes(s.overflowY) ||
        ["hidden", "auto", "scroll", "clip"].includes(s.overflowX),
      tag: node.tagName,
      action:
        node.dataset.action ||
        node.dataset.scenario ||
        node.dataset.selection ||
        node.dataset.jump ||
        null,
      children: [],
    };
    if (["INPUT", "TEXTAREA"].includes(node.tagName)) {
      const placeholder = getComputedStyle(node, "::placeholder");
      out.field = {
        name: node.getAttribute("aria-label") || "输入框",
        text: node.value || node.placeholder || "",
        paddingLeft: s.paddingLeft,
        paddingRight: s.paddingRight,
        fontFamily: s.fontFamily,
        fontWeight: s.fontWeight,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        color: node.value ? s.color : placeholder.color,
      };
    } else {
      for (const child of node.childNodes) {
        const item = walk(child, b);
        if (item) out.children.push(item);
      }
    }
    return out;
  }
  return {
    name,
    width: phoneRect.width,
    height: phoneRect.height,
    root: walk(phone, phoneRect),
    source: "Observed DOM and glyph baselines of the fixed-content prototype",
  };
}

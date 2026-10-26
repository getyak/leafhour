# Leafhour iOS 交互打磨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 持续优化已批准的 iOS 半屏陪读原型，截止 2026-10-27 12:00 Asia/Singapore。

**Architecture:** 保留初版，第二版在独立目录迭代。面板运动与选文定位分别使用无 DOM 的计算模块，页面管理输入、归属与回程。单文件交付使用仓库已有 esbuild 打包，不新增依赖。

**Tech Stack:** 浏览器原生模块、CSS、Pointer Events、Node 测试、Playwright、免费 Figwright。

**Spec:** `docs/design/2026-10-27-ios-polish/DESIGN.md`

## Global Constraints

- 截止为 2026-10-27 12:00 Asia/Singapore；每轮先检查时间，截止后不启动新变更。
- 固定公版样章，无模型、真实账号、私人笔记或运行数据请求。
- 原文、直译、意译、讲解、用户笔记独立归属。
- 原版保留；保留其他聊天改动；本轮只写设计目录、计划与 `tests/ios-design-interaction.test.mjs` 这一常规检查入口。
- 减少动态无弹性位移，所有手势有按钮替代。

## Review Focus

- 拖动中或收起过程中重新抓取，面板必须从当前显示位置继续。
- 慢帧和快帧的同一段真实时间应得到一致结果，不能跳过动画时间。
- 指针取消或失去捕获不能提交关闭动作。
- 菜单靠近可视区边缘时仍完整可点击，不覆盖选择起点。
- 选文、滚动、切换版本和关闭面板不能串接另一段问题或草稿。

### Task 1: 稳定面板与连续反馈

**Files:** Create `docs/design/2026-10-27-ios-polish/prototype/motion.mjs`; modify `prototype/app.js`, `prototype/style.css`; test `motion.test.mjs`, `verify-polish.mjs` in the same design directory.

**Interfaces:** Consumes approved half/full/closed detents. Produces `advanceSpring({position,velocity},target,seconds)`, `resistedPosition(value,min,max,extent)`, `nearestDetent(position,velocity,stops)`; velocities use px/s. DOM code owns lifecycle, focus and cancellation.

- [ ] Write tests for time invariance, retained velocity, finite settling, soft bounds and projected detent.
- [ ] Run `node --test docs/design/2026-10-27-ios-polish/motion.test.mjs`; expected failing assertions before implementation.
- [ ] Implement the motion module and integrate it; add a 44 px handle, continuous scrim and short press feedback with reduced-motion/transparency alternatives.
- [ ] Run pure tests and browser cancellation/reversal checks; expected pass with no page errors.
- [ ] Commit only the new design directory and this plan.

### Task 2: 跟随选文的工具与可交付证据

**Files:** Create `prototype/selection-position.mjs`, `selection-position.test.mjs`, `verify-polish.mjs`, `README.md`, `WORKLOG.md`, `build.mjs`; adapt existing prototype regression/capture tools into the new directory.

The two pure test modules are also imported by `tests/ios-design-interaction.test.mjs`, so the existing repository CI runs their assertions.

**Interfaces:** Consumes actual selection rectangles and viewport safe bounds. Produces `placeSelectionMenu(anchor,menu,bounds)` returning `{left,top,placement}`; DOM code converts browser coordinates into phone coordinates, tracks scroll and clears temporary selection feedback. `build.mjs` bundles local modules into a standalone HTML file.

- [ ] Write geometry tests and browser tests that fail for the fixed menu and lingering highlight.
- [ ] Run the new tests and confirm the intended failures.
- [ ] Implement anchored placement, scroll updates and cancellation/clear behavior; preserve quote snapshots and draft isolation.
- [ ] Run the 11 original browser regressions against v2 plus new interaction checks; export real captures and check the standalone file. Expected all pass, no external requests.
- [ ] Review actual screenshots, update Figma with versioned frames and read back changed reactions. Record actual scope and limits.
- [ ] Obtain an independent whole-branch review, fix material findings with regression checks, then commit and deliver through PR/CI/production gates.

## Self-review

The two tasks share only the page input lifecycle and the standalone bundler. Motion handles no text or quote state; selection placement handles no reading persistence. The browser checks cover their seam, and existing draft/citation regressions remain mandatory. The user's instruction to continue the established prototype authorizes these routine refinements; no new product direction or live service integration is inferred.

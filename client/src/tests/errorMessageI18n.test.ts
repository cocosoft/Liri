/**
 * HD-P2-2 收尾 ·「错误消息入 i18n」**源码守卫**（防回流）。
 *
 * **为什么错误消息也要 i18n**：`toastError(err)`（`stores/toastStore.ts:64`）会把
 * `friendlyErrorSummary(err)` 与 **`getRawErrorMessage(err)`** 一起推给 toast ⇒
 * **原异常文本会作为「原异常信息」显示给用户**。故服务/Store 层 `new Error("中文")`、
 * `reject(new Error("中文"))` 与组件 `setError("中文")` 的中文**都会上屏**。
 *
 * **本片做法**：把 `client/src` 下这些**用户可见错误消息**统一改为 i18n 引用
 * （纯函数模块用 `i18n.t(...)`，组件用 `t(...)`），zh 渲染结果**逐字不变**。
 * 本守卫防其回流：在下列文件里，错误消息构造点不得再出现**裸中文**。
 *
 * **判据**（逐行）：
 * - 注释行不计（按**行首**判定，含 JSX 注释 `{/*`）；
 * - 命中 `new Error(` / `setError(` / `setDataDirError(` / `onError(`，且**同一括号内**出现中文；
 * - 且该行**未**引用 i18n（`\bt\(` 可命中 `t(` 与 `i18n.t(`）⇒ 记为违规。
 *
 * ⚠️ 有意**不**覆盖的「内部兜底」：本守卫只保证**错误消息**走 i18n；
 * 与之无关的中文（如 `logger.*` 日志文案、`format.ts` 的 `万`/`千` 单位）
 * 由 `i18nLiteralRatchet.test.ts` 的棘轮另行计量，不在本守卫范围。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

const SRC = join(__dirname, "..");

/** 本片迁移过的文件（错误消息已入 i18n）—— 改名/删除须同步维护本清单 */
const FILES = [
  "src/utils/format.ts",
  "src/services/agentService.ts",
  "src/services/chatService.ts",
  "src/services/faqService.ts",
  "src/services/graphService.ts",
  "src/services/datasourceService.ts",
  "src/services/knowledgeService.ts",
  "src/services/notificationService.ts",
  "src/services/modelSwitchService.ts",
  "src/services/llamaService.ts",
  "src/services/monitorService.ts",
  "src/services/projectArtifactService.ts",
  "src/services/sessionService.ts",
  "src/services/sttStream.ts",
  "src/services/tauriProxy.ts",
  "src/services/videoService.ts",
  "src/services/voiceService.ts",
  "src/services/translateService.ts",
  "src/stores/councilStore.ts",
  "src/stores/chat/chat-message-actions.ts",
  "src/components/views/SettingsPage.tsx",
  "src/components/views/image/canvas-editor/components/CanvasEditor.tsx",
];

/** 错误消息构造点 + **同一括号内**出现中文（`[^)]*` 避免命中行尾注释里的中文） */
const ERROR_MSG_WITH_CJK =
  /(?:new Error|setError|setDataDirError|onError)\([^)]*[\u4e00-\u9fff]/;
/** 该行是否已走 i18n（`\b` 使 `t(` 与 `i18n.t(` 都命中，但不误命中 `split(` / `set(`） */
const I18N = /\bt\(/;

function isCommentLine(line: string): boolean {
  const s = line.trimStart();
  return (
    s.startsWith("//") ||
    s.startsWith("*") ||
    s.startsWith("/*") ||
    s.startsWith("{/*")
  );
}

test("错误消息不再裸写中文（应走 i18n.t / t）", () => {
  const violations: string[] = [];
  for (const rel of FILES) {
    const abs = join(SRC, "..", rel);
    expect(
      existsSync(abs),
      `清单里的文件不存在（改名/删除后须同步维护清单）：${rel}`,
    ).toBe(true);
    const lines = readFileSync(abs, "utf-8").split("\n");
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return;
      if (!ERROR_MSG_WITH_CJK.test(line)) return;
      if (I18N.test(line)) return;
      violations.push(`${rel}:${i + 1} → ${line.trim()}`);
    });
  }
  expect(
    violations,
    "错误消息里出现裸中文（会随「原异常信息」上屏）——应改为 i18n 引用",
  ).toEqual([]);
});

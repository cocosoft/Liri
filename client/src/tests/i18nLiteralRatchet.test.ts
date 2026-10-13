/**
 * HD-P2-2 续作 —— **前端内联中文文案「棘轮」守卫**（只减不增）。
 *
 * **为什么是棘轮而非"一次清零"**：回仓实测的同类问题有 **≈120 处 / ≈40 文件**（方案原估
 * 16 处 / 7 文件），一次性全清既不可验证也难回滚 ⇒ 采用仓内既有棘轮手法（对照 A6 host 棘轮）：
 * **记录基线 → 每批只许降不许升 → 新增内联文案立即变红**。
 *
 * **统计口径**（与方案的"文案 vs 数据表 vs 开发者消息"三分法一致）：
 * - **只统计会渲染给用户看的中文**（字符串字面量 / JSX 文本）—— 即方案的"文案"类；
 * - 注释行不计（按**行首**判定，不用"剥 `//` 注释"—— 那会误伤 `http://`，见 HD-P0-3 实测）；
 * - 测试文件、`i18n/locales/**`（i18n 资源本身）不计；
 * - **不区分**"数据表/开发者消息"—— 它们一并计入基线（本守卫只保证**总量单调下降**，
 *   分类处置由方案 §5 与各批次的 ledger 条目记录）。
 *
 * 记录/更新基线：`UPDATE_I18N_BASELINE=1 bunx vitest run src/tests/i18nLiteralRatchet.test.ts`
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const SRC = join(__dirname, "..");
const BASELINE_PATH = join(__dirname, "fixtures", "i18nLiteralBaseline.json");

/** 字符串字面量里的中文 */
const STRING_WITH_CJK = /(['"`])[^'"`\n]*[\u4e00-\u9fff]/;
/** JSX 文本节点里的中文（`>中文<`） */
const JSX_TEXT_WITH_CJK = />[^<>{}]*[\u4e00-\u9fff][^<>{}]*</;

/**
 * **已走 i18n** 的行（不计入）—— 本仓主流写法是 `t("key", "中文默认值")`，
 * 其"默认值"虽也是中文字面量，但**已接 i18n**（切 en 会走字典），不属本片目标。
 *
 * `\bt\(` 的 `\b` 很关键：可命中 `t(` / `i18n.t(`，但**不会**误命中 `split(` / `set(`。
 */
const I18N_ALREADY = /\bt\(\s*['"`]|defaultValue\s*:|labelKey\s*:|i18nKey\s*:/;

/**
 * **开发者消息**（不计入）—— 本片口径明确"不迁"：`console.*` / `logger.*` 的输出，
 * 以及 `throw new Error("中文")`（多数只给开发者看）。
 *
 * ⚠️ 边界：确实存在"throw 后被 catch 上屏"的消息（扫描称 ≈35 处"边界项"）—— 那需要先定义
 * **哪些 catch 会上屏**（属另一片），本片统一**登记不治理**，故一并排除。
 */
const DEV_ONLY = /\b(console|logger)\.|throw new Error\(/;

function isCommentLine(line: string): boolean {
  const s = line.trimStart();
  return (
    s.startsWith("//") ||
    s.startsWith("*") ||
    s.startsWith("/*") ||
    // JSX 注释 `{/* … */}`：不渲染给用户，属注释。
    // 回仓实证（2026-10-13）：`ChatInput.tsx` 的 `{/* … 组件内 `ml-auto` 右对齐） */}`
    // 曾被**误计**为内联文案（其反引号 + 中文命中了 STRING_WITH_CJK）⇒ 排除。
    s.startsWith("{/*")
  );
}

/**
 * **目标清单**（唯一统计范围）—— 取自 2026-10-13 的**回仓只读扫描**（该扫描对每条命中
 * 逐条给出 `文件:行号` 与"出现在哪个界面元素上"的判断依据）。
 *
 * ⚠️ 为什么**不做全仓扫描**：全仓口径会把**数据表**（`utils/formatKey.ts` 工具参数标签字典 ·
 * `utils/lunarCalendar.ts` 历法常量 · `components/views/image/canvas-editor/utils/i18n.ts`
 * 自带的迷你 i18n 资源 · `config/providerPresets.ts` 供应商显示名/说明 …）一并计入 ⇒
 * **将来合法地给数据表加一行**就会误触门禁（正是方案 §8 提醒的"噪音门禁、必无人维护"）。
 * ⇒ 只统计扫描认定为「**绕开 i18n 的用户可见文案**」的文件；其余按 §5 登记为不治理。
 *
 * 有意**排除**（由扫描归入"数据表/示例"，不属本片）：
 * `utils/lunarCalendar.ts`（历法常量）· `components/ChatArea/FilePreviewContent.tsx`（预览示例 HTML）。
 */
const TARGET_FILES = [
  "src/utils/format.ts",
  "src/utils/formatValue.ts",
  "src/utils/friendlyError.ts",
  "src/utils/toolHumanSummary.ts",
  "src/utils/messageText.ts",
  "src/utils/planRestore.ts",
  "src/utils/sessionLog.ts",
  "src/services/chatService.ts",
  "src/hooks/useBuddyNotification.ts",
  "src/hooks/useVideoTaskPolling.ts",
  "src/stores/fileStore.ts",
  "src/stores/councilStore.ts",
  "src/stores/backendStore.ts",
  "src/stores/channelStore.ts",
  "src/stores/chat/chat-message-stream.ts",
  "src/stores/chat/chat-message.slice.ts",
  "src/stores/chat/chat-message-shared.ts",
  "src/stores/chat/chat-message-actions.ts",
  "src/components/chat/ContextWatermark.tsx",
  "src/components/Terminal/XTermPanel.tsx",
  "src/components/views/DAGView.tsx",
  "src/components/views/ViewRouter.tsx",
  "src/components/views/media/MasonryGallery.tsx",
  "src/components/views/office/CenterPanel.tsx",
  "src/components/views/office/CreateDocModal.tsx",
  "src/components/views/media/TemplateCarousel.tsx",
  "src/components/views/image/ImageGallery.tsx",
  "src/components/views/MediaPage.tsx",
  "src/components/views/PlansPage.tsx",
  "src/components/ChatArea/ChatInput.tsx",
  "src/components/ChatArea/WorkflowRunCard.tsx",
  "src/components/ChatArea/ImageToolResult/ImageDisplayResult.tsx",
  "src/components/ChatArea/ImageToolResult/ImageGenerateResult.tsx",
  "src/components/VoiceInputButton.tsx",
  "src/components/views/HomePage.tsx",
  "src/components/Knowledge/useKnowledgeBaseList.ts",
  "src/components/Knowledge/useCompilePolling.ts",
  "src/components/Knowledge/shared/utils.ts",
  "src/App.tsx",
];

/** 统计目标清单里每个文件"绕开 i18n 的用户可见中文"**行数**（同一行多处算 1） */
function scan(): Record<string, number> {
  const counts: Record<string, number> = {};
  const missing: string[] = [];
  for (const rel of TARGET_FILES) {
    const abs = join(SRC, "..", rel);
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    let n = 0;
    for (const line of readFileSync(abs, "utf-8").split("\n")) {
      if (isCommentLine(line)) continue;
      if (I18N_ALREADY.test(line)) continue; // 已走 i18n（含中文默认值）—— 不是本片目标
      if (DEV_ONLY.test(line)) continue; // 开发者消息（console/logger/throw）—— 口径明确不迁
      if (STRING_WITH_CJK.test(line) || JSX_TEXT_WITH_CJK.test(line)) n++;
    }
    if (n > 0) counts[rel] = n;
  }
  // 清单里的文件必须真实存在（防"改名后静默漏检"）
  expect(
    missing,
    "目标清单里有不存在的文件（改名/删除后须同步维护清单）",
  ).toEqual([]);
  return counts;
}

const current = scan();
const total = Object.values(current).reduce((a, b) => a + b, 0);

describe("HD-P2-2 · 内联中文文案棘轮（只减不增）", () => {
  test("基线存在，且各文件命中数不超过基线（总量单调下降）", () => {
    expect(existsSync(BASELINE_PATH), `基线缺失：${BASELINE_PATH}`).toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as {
      total: number;
      files: Record<string, number>;
    };

    // 由明细算出基线总量（防止手工改 total 与明细不一致）
    const baselineTotal = Object.values(baseline.files).reduce(
      (a, b) => a + b,
      0,
    );
    expect(baseline.total).toBe(baselineTotal);

    const regressions: string[] = [];
    for (const [file, n] of Object.entries(current)) {
      const base = baseline.files[file] ?? 0;
      if (n > base) regressions.push(`${file}: ${base} → ${n}`);
    }
    expect(
      regressions,
      "新增/回流的内联中文文案（应改为走 i18n；若确属数据表，记录到基线并说明理由）",
    ).toEqual([]);

    // 总量只减不增（新增文件若不在基线里，上面的逐文件检查已拦住）
    expect(
      total,
      `总量应 ≤ 基线 ${baseline.total}（当前 ${total}）`,
    ).toBeLessThanOrEqual(baseline.total);
  });
});

// 记录模式：只在显式置 env 时写基线（避免测试静默改文件）
if (process.env.UPDATE_I18N_BASELINE === "1") {
  mkdirSync(join(__dirname, "fixtures"), { recursive: true });
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ total, files: current }, null, 2) + "\n",
    "utf-8",
  );

  console.log(
    `[i18n 棘轮] 基线已写入：total=${total}，文件数=${Object.keys(current).length}`,
  );
}

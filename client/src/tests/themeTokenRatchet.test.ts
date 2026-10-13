/**
 * HD-P2-1 主题令牌 —— **原始颜色字面量「只减不增」棘轮守卫**。
 *
 * **为什么是棘轮而非"一次清零"**：回仓实测 `client/src` 的 6 位十六进制色值共 **338 处 / 46 文件**
 * （方案 §3.2 记的「颜色未走主题令牌」），其中**大量属数据表 / 艺术资源**（供应商品牌色
 * `config/providerPresets.ts`、吉祥物配色 `components/Buddy/**`、画布工具色板
 * `views/image/canvas-editor/**`）⇒ 按方案 §5 **登记不治理**；真正要令牌化的是**语义状态/中性色**。
 * 一次性全清既不可验证也难回滚 ⇒ 采用仓内既有棘轮手法（对照 `i18nLiteralRatchet` / `fn-size`）。
 *
 * **统计口径**：`client/src/**\/*.{ts,tsx}` 中含 **6–8 位十六进制色值**（`#RRGGBB` / `#RRGGBBAA`）的行数
 * （同一行多处算 1）。**不计入**：
 * - 测试文件（`**\/tests/**`、`**\/__tests__/**`、`*.test.ts(x)`）；
 * - `EXCLUDE_FILES`（数据表 / 艺术资源）与 `EXCLUDE_DIRS`（画布色板：hex 是**数据值**，非 CSS 呈现）；
 * - `.css` 文件（令牌定义 / 独立主题层，本守卫只扫 ts/tsx）。
 *
 * 记录/更新基线：`UPDATE_THEME_BASELINE=1 bunx vitest run src/tests/themeTokenRatchet.test.ts`
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "vitest";

const SRC = join(__dirname, "..");
const BASELINE_PATH = join(__dirname, "fixtures", "themeTokenBaseline.json");

/** 有意**不计入**的整文件（数据表 / 艺术资源 / 独立主题 —— 方案 §5「不治理」同类） */
const EXCLUDE_FILES = [
  "config/providerPresets.ts", // 供应商品牌色（数据表）
  "components/Buddy/buddySprites.ts", // 吉祥物精灵配色（艺术资源）
  "components/Buddy/BuddySVG.tsx", // 吉祥物 SVG 配色（艺术资源）
  // Tokyo Night **代码主题调色板**（工具调用/文档流程/决策侧栏的代码块配色，自成一体的主题数据）
  "components/ChatArea/ToolCallGroup.tsx",
  "components/ChatArea/DocWorkflowProgress.tsx",
  "components/ChatInspector/PendingDecisionSidebar.tsx",
  // Google / Microsoft **品牌 logo 色**（第三方身份色，非本产品主题）
  "components/views/LoginPage.tsx",
  // Tokyo Night 代码主题**同族**（工具执行组/状态块/思考块：同一代码块配色）
  "components/ChatArea/ToolExecutionGroup.tsx",
  "components/ChatArea/StatusBlock.tsx",
  "components/ChatArea/ThinkingBlock.tsx",
  // **图表分类色**（多系列 categorical palette，非语义状态色）
  "components/common/ModelRankTable.tsx",
  // **页面插画/品牌渐变**（Liri 落地页的紫系装饰）
  "components/views/LiriPage.tsx",
];

/** 有意**不计入**的目录前缀（画布工具色板：hex 是**数据值**，喂给 `<input type=color>` / Canvas2D） */
const EXCLUDE_DIRS = ["components/views/image/canvas-editor/"];

/** 6–8 位十六进制色值（`#RRGGBB` / `#RRGGBBAA`） */
const HEX_COLOR = /#[0-9a-fA-F]{6,8}\b/;

function collect(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      collect(join(dir, e.name), out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
}

function isExcluded(rel: string): boolean {
  if (rel.includes("__tests__") || /\.test\.(ts|tsx)$/.test(rel)) return true;
  if (EXCLUDE_FILES.some((f) => rel === f)) return true;
  if (EXCLUDE_DIRS.some((d) => rel.startsWith(d))) return true;
  return false;
}

/** 统计含原始色值的**行数**（同一行多处算 1） */
function scan(): { total: number; files: Record<string, number> } {
  const abs: string[] = [];
  collect(SRC, abs);
  const files: Record<string, number> = {};
  let total = 0;
  for (const p of abs) {
    const rel = relative(SRC, p).split("\\").join("/");
    if (isExcluded(rel)) continue;
    let n = 0;
    for (const line of readFileSync(p, "utf-8").split("\n")) {
      if (HEX_COLOR.test(line)) n++;
    }
    if (n > 0) {
      files[rel] = n;
      total += n;
    }
  }
  return { total, files };
}

const { total, files } = scan();

describe("HD-P2-1 · 原始颜色字面量棘轮（只减不增）", () => {
  test("基线存在，且逐文件命中数不超过基线（总量单调下降）", () => {
    expect(existsSync(BASELINE_PATH), `基线缺失：${BASELINE_PATH}`).toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as {
      total: number;
      files: Record<string, number>;
    };
    const baselineTotal = Object.values(baseline.files).reduce(
      (a, b) => a + b,
      0,
    );
    expect(baseline.total).toBe(baselineTotal);

    const regressions: string[] = [];
    for (const [file, n] of Object.entries(files)) {
      const base = baseline.files[file] ?? 0;
      if (n > base) regressions.push(`${file}: ${base} → ${n}`);
    }
    expect(
      regressions,
      "新增/回流的原始颜色字面量（应改用 index.css 的 --color-* 令牌；确属数据表须记入 EXCLUDE_* 并注明理由）",
    ).toEqual([]);
    expect(
      total,
      `总量应 ≤ 基线 ${baseline.total}（当前 ${total}）`,
    ).toBeLessThanOrEqual(baseline.total);
  });
});

if (process.env.UPDATE_THEME_BASELINE === "1") {
  mkdirSync(join(__dirname, "fixtures"), { recursive: true });
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ total, files }, null, 2) + "\n",
    "utf-8",
  );
  console.log(
    `[主题令牌棘轮] 基线已写入：total=${total}，文件数=${Object.keys(files).length}`,
  );
}

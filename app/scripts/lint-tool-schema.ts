/**
 * lint-tool-schema.ts — 工具 Schema **能力/风险声明棘轮**（D5，2026-10-11）
 *
 * 口径（用户裁定「采纳 · 渐进棘轮」；方案 §4.5.4 N2 + 修正 3）：
 * - **初期仅 WARN**：存量工具**未显式声明**能力 ⇒ 记 WARN（不阻断），避免一次改 81 个文件；
 * - **只对新增工具增量严格**：不在基线 `.trae/architecture/tool-capability-baseline.json` 内
 *   且**未显式声明**能力的工具 ⇒ **ERROR**（exit 1）。
 *
 * "显式声明"判据（工具类内，非继承）：
 * - **`extends BaseTool`**：工具名在 `TOOL_EFFECTS` 有条目即视为已声明 —— 该表以
 *   `Record<ToolName, ToolEffect>` 编译期穷举，**漏声明 / 拼错名 ⇒ `typecheck` 失败**（唯一真源）；
 *   另有类内 `getCapability(` / `capability:` / `sandboxLevel` 等声明也算（2026-10-20 用户裁定）。
 * - **`implements Tool`**：无基类派生 ⇒ 必须在类内显式声明 `idempotent` / `sideEffect` /
 *   `sandboxLevel` / `getCapability()`。
 *
 * 未显式声明时，运行时仍由 `BaseTool.getCapability()` 经 `deriveFromLegacyEffects()` **默认派生**
 * （零侵入：既有 `TOOL_EFFECTS` + `tags/isReadOnly/isDestructive`）。
 *
 * 用法：
 *   bun run lint:tool-schema                   # 校验（WARN + 棘轮 ERROR）
 *   bun run lint:tool-schema --update-baseline # 用当前状态刷新基线（仅在有意接受缺失时）
 *
 * 异常处理：任何 IO/解析异常均**捕获**并输出**双语**信息（禁裸异常栈）。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_NAME_CONSTANTS } from '../src/tools/toolNameConstants';
import { TOOL_EFFECTS } from '../src/tools/toolEffects';

const HERE = dirname(fileURLToPath(import.meta.url)); // app/scripts
const APP_DIR = resolve(HERE, '..'); // app
const TOOLS_DIR = join(APP_DIR, 'src', 'tools');
/**
 * 扫描面（U-03 2026-10-19）：除 `src/tools/**` 外，knowledge 工具在 `src/knowledge/tools/**`
 * （`implements Tool` 的另一大簇，原扫描面完全覆盖不到）。
 */
const SCAN_DIRS = [TOOLS_DIR, join(APP_DIR, 'src', 'knowledge', 'tools')];
const BASELINE_PATH = resolve(
  APP_DIR,
  '..',
  '.trae',
  'architecture',
  'tool-capability-baseline.json'
);

/** 一个"未显式声明能力"的工具 */
export interface MissingCapabilityDecl {
  name: string;
  file: string;
}

/**
 * `extends BaseTool` 的"已声明"来源：`TOOL_EFFECTS` 的键（编译期穷举的内置工具效果表）。
 * 提到模块级常量，供门禁与测试共用同一口径。
 */
const DEFAULT_DECLARED_EFFECTS: ReadonlySet<string> = new Set(
  Object.keys(TOOL_EFFECTS)
);

interface SourceFile {
  file: string;
  text: string;
}

/**
 * 判据（**纯函数**，供门禁自证/负向夹具复用）：扫描源码文本，返回"缺显式能力声明"的工具。
 *
 * - 统计**两类工具类**：`extends BaseTool` 与 `implements Tool`
 *   （U-03 2026-10-19：后者含 knowledge/voice/code_analysis/memory/适配器等 37 个类，
 *   原先**完全不在门禁视野**内 ⇒ 新增此类工具缺声明时无人拦截）；
 * - `extends BaseTool`：**工具名在 `TOOL_EFFECTS` 有条目即视为已声明**（2026-10-20 用户裁定：
 *   该表编译期穷举，是 `idempotent` / `sideEffect` 的唯一真源；再要求类内重复写 `getCapability()`
 *   只会制造 58 份副本）；此外类内声明 `getCapability(` / `capability:` /
 *   `idempotent` / `sideEffect` / `sandboxLevel`（`:` 与 `=` 两种写法）同样算已声明；
 * - `implements Tool`：无基类派生 ⇒ 只能靠类内显式声明（同上字段集合）。
 *
 * @param declaredEffects 视为"已由 `TOOL_EFFECTS` 声明"的工具名集合（缺省取真实表的键；
 *   测试可注入以固定夹具，不依赖真实表内容）。
 * @returns `missing`＝缺声明者；`total`＝识别到的工具类总数（两者口径一致）。
 */
export function findToolsMissingCapability(
  sources: ReadonlyArray<SourceFile>,
  declaredEffects: ReadonlySet<string> = DEFAULT_DECLARED_EFFECTS
): { missing: MissingCapabilityDecl[]; total: number } {
  const out: MissingCapabilityDecl[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const { file, text } of sources) {
    const isBaseToolClass = /extends\s+BaseTool\b/.test(text);
    const implementsTool = /implements\s+[^{;\n]*\bTool\b/.test(text);
    if (!isBaseToolClass && !implementsTool) continue;

    // 工具名：优先常量表引用，其次字面量（允许 `name: string = '…'` 这类显式类型标注）
    const viaConst = text.match(
      /\bname\s*(?::\s*[A-Za-z_$][\w$]*)?\s*=\s*TOOL_NAME_CONSTANTS\.([A-Za-z0-9_]+)/
    );
    const viaLiteral = text.match(
      /\bname\s*(?::\s*[A-Za-z_$][\w$]*)?\s*=\s*'([a-zA-Z0-9_:]+)'/
    );
    const name = viaConst
      ? (TOOL_NAME_CONSTANTS as Record<string, string>)[viaConst[1]]
      : viaLiteral
        ? viaLiteral[1]
        : undefined;
    if (!name) continue;

    total += 1;

    // 用户裁定（2026-10-20）：`extends BaseTool` 的 `idempotent` / `sideEffect` 由
    // `TOOL_EFFECTS` **唯一声明**（`Record<ToolName, …>` 编译期穷举）⇒ 有条目即视为已声明，
    // 不再要求 58 个类内重复 `getCapability()`（避免第二事实源）。
    if (isBaseToolClass && declaredEffects.has(name)) continue;

    const declaresCapability =
      /getCapability\s*\(/.test(text) ||
      /\bcapability\s*:/.test(text) ||
      // 2026-10-20：同时接受**字段初始化器**写法（`override sandboxLevel = 'execution' as const`）
      // —— `extends BaseTool` 的工具以 `=` 声明，原判据只认 `:` ⇒ `bash` / `powershell` /
      // `code_run` 三个**已显式声明**的类被误判为"缺声明"（判据漏检，非工具缺失）。
      /\b(?:idempotent|sideEffect|sandboxLevel)\s*[:=]/.test(text);
    if (declaresCapability) continue;

    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, file });
  }

  return {
    missing: out.sort((a, b) => a.name.localeCompare(b.name)),
    total,
  };
}

/** 递归收集 `src/tools/**\/*.ts` */
function collectSources(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(p));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push({ file: p, text: readFileSync(p, 'utf8') });
    }
  }
  return out;
}

function loadBaseline(): string[] {
  if (!existsSync(BASELINE_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as {
      tools?: string[];
    };
    return Array.isArray(raw.tools) ? raw.tools : [];
  } catch (error) {
    console.error(
      `[lint:tool-schema] ❌ 基线文件无法解析 / baseline file is not valid JSON: ${BASELINE_PATH}\n  ${String(error)}`
    );
    process.exit(1);
  }
}

function writeBaseline(tools: string[]): void {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        note:
          'D5 能力/风险声明棘轮基线（存量「缺显式声明能力」的工具）。' +
          '口径（2026-10-20 用户裁定）：`extends BaseTool` 的工具名在 TOOL_EFFECTS（编译期穷举）有条目即视为已声明；' +
          '`implements Tool` 及「不在 TOOL_EFFECTS 的 BaseTool」须在类内显式声明。' +
          '新工具若缺显式声明 ⇒ lint:tool-schema ERROR。由 --update-baseline 生成，勿手改。' +
          '（基线内条目均为**未进 ToolName 联合的影子工具**，故 TOOL_EFFECTS 覆盖不到；随接线/弃用一并处理。）',
        tools,
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

function main(): void {
  const updateBaseline = process.argv.includes('--update-baseline');

  let missing: MissingCapabilityDecl[];
  let total: number;
  try {
    const sources = SCAN_DIRS.filter((dir) => existsSync(dir)).flatMap((dir) =>
      collectSources(dir)
    );
    ({ missing, total } = findToolsMissingCapability(sources));
  } catch (error) {
    console.error(
      `[lint:tool-schema] ❌ 扫描 src/tools 失败 / failed to scan src/tools:\n  ${String(error)}`
    );
    process.exit(1);
    return;
  }

  if (updateBaseline) {
    writeBaseline(missing.map((m) => m.name));
    console.log(
      `[lint:tool-schema] 基线已更新 / baseline updated: ${missing.length} 个工具 → ${BASELINE_PATH}`
    );
    process.exit(0);
    return;
  }

  const baseline = new Set(loadBaseline());
  const baselined = missing.filter((m) => baseline.has(m.name));
  const novel = missing.filter((m) => !baseline.has(m.name));

  console.log(
    `[lint:tool-schema] 工具类(extends BaseTool | implements Tool): ${total} · ` +
      `已声明能力(类内声明或 TOOL_EFFECTS 条目): ${total - missing.length} · ` +
      `存量缺声明(WARN, 基线内): ${baselined.length} · 新增缺声明(ERROR): ${novel.length}`
  );

  if (baselined.length > 0) {
    console.warn(
      `[lint:tool-schema] ⚠️ 以下存量工具既不在 TOOL_EFFECTS，也无声明的 capability/risk（仅告警；运行时按既有元数据默认派生）：\n  ${baselined
        .map((m) => m.name)
        .join(', ')}`
    );
  }

  if (novel.length > 0) {
    console.error(
      `[lint:tool-schema] ❌ 新增工具缺少显式 capability/risk 声明 / new tool(s) missing explicit capability declaration：`
    );
    for (const m of novel) {
      console.error(`  - ${m.name}  (${m.file})`);
    }
    console.error(
      `  → 内置工具：在 tools/toolEffects.ts 的 TOOL_EFFECTS 声明（extends BaseTool 的唯一真源）；` +
        `非内置 / implements Tool：在类内声明 idempotent / sideEffect / sandboxLevel 或覆盖 getCapability()。` +
        `确属存量的，经评审后加入基线 / declare capability explicitly (TOOL_EFFECTS entry, or in-class metadata / getCapability()), or, after review, add to baseline.`
    );
    process.exit(1);
    return;
  }

  console.log('[lint:tool-schema] ✅ 通过 / passed');
  process.exit(0);
}

// 仅**直接运行**时执行（被测试 import 时不触发 ⇒ 便于复用纯判据做门禁自证）
if (import.meta.main) {
  main();
}

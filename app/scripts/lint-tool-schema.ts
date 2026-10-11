/**
 * lint-tool-schema.ts — 工具 Schema **能力/风险声明棘轮**（D5，2026-10-11）
 *
 * 口径（用户裁定「采纳 · 渐进棘轮」；方案 §4.5.4 N2 + 修正 3）：
 * - **初期仅 WARN**：存量工具**未显式声明**能力 ⇒ 记 WARN（不阻断），避免一次改 81 个文件；
 * - **只对新增工具增量严格**：不在基线 `.trae/architecture/tool-capability-baseline.json` 内
 *   且**未显式声明**能力的工具 ⇒ **ERROR**（exit 1）。
 *
 * "显式声明"判据（工具类内，非继承）：覆盖 `getCapability(` 或声明 `capability:` 字段。
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

const HERE = dirname(fileURLToPath(import.meta.url)); // app/scripts
const APP_DIR = resolve(HERE, '..'); // app
const TOOLS_DIR = join(APP_DIR, 'src', 'tools');
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

interface SourceFile {
  file: string;
  text: string;
}

/**
 * 判据（**纯函数**，供门禁自证/负向夹具复用）：扫描源码文本，返回"缺显式能力声明"的工具。
 *
 * - 仅统计**工具类**（`extends BaseTool`）；
 * - 已覆盖 `getCapability(` 或声明 `capability:` 的类 ⇒ 视为已显式声明，跳过。
 *
 * @returns `missing`＝缺声明者；`total`＝识别到的工具类总数（两者口径一致）。
 */
export function findToolsMissingCapability(
  sources: ReadonlyArray<SourceFile>
): { missing: MissingCapabilityDecl[]; total: number } {
  const out: MissingCapabilityDecl[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const { file, text } of sources) {
    if (!/extends\s+BaseTool\b/.test(text)) continue;

    // 工具名：优先常量表引用，其次字面量
    const viaConst = text.match(
      /name\s*=\s*TOOL_NAME_CONSTANTS\.([A-Za-z0-9_]+)/
    );
    const viaLiteral = text.match(/name\s*=\s*'([a-zA-Z0-9_:]+)'/);
    const name = viaConst
      ? (TOOL_NAME_CONSTANTS as Record<string, string>)[viaConst[1]]
      : viaLiteral
        ? viaLiteral[1]
        : undefined;
    if (!name) continue;

    total += 1;

    const declaresCapability =
      /getCapability\s*\(/.test(text) || /\bcapability\s*:/.test(text);
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
          'D5 能力/风险声明棘轮基线（存量"未显式声明能力"的工具）。' +
          '新工具若缺显式声明 ⇒ lint:tool-schema ERROR。由 --update-baseline 生成，勿手改。',
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
    ({ missing, total } = findToolsMissingCapability(collectSources(TOOLS_DIR)));
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
    `[lint:tool-schema] 工具类(extends BaseTool): ${total} · ` +
      `已显式声明能力: ${total - missing.length} · ` +
      `存量缺声明(WARN, 基线内): ${baselined.length} · 新增缺声明(ERROR): ${novel.length}`
  );

  if (baselined.length > 0) {
    console.warn(
      `[lint:tool-schema] ⚠️ 以下存量工具未显式声明 capability/risk（仅告警；运行时按既有元数据默认派生）：\n  ${baselined
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
      `  → 请在工具类内覆盖 getCapability()，或加入基线（须评审）/ override getCapability() or, after review, add to baseline.`
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

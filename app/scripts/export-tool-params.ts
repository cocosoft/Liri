/**
 * C-3b（2026-10-18）工具**参数描述**冻结导出（T2 字段级资源）。
 *
 * 从**真实工具实例**（`loadTools + getAllBuiltinToolLoaders`）读取 `params`，
 * 展开嵌套（`items` / `items.<key>`）后落盘为单文件资源：
 *   `app/prompts/<locale>/tool-params.json`（键 = `<toolName>.<paramPath>`）。
 *
 * **行为零变化**：导出值 === 当前 `getToolSchemas()` 里的描述；解析链命中资源即同值。
 * 与 C-1 的整段提示词导出同构：只读运行时文本、只写资源文件。
 *
 * **en-US 译文不由本脚本生成**（源语言是 zh-CN）：`app/prompts/en-US/tool-params.json`
 * 为离线人工译文，键集/协议文本/占位符由 `tests/prompt-locale/toolParamsLocaleParity.test.ts`
 * 守卫；新增 zh 键而 en 未补齐时该测试直接失败。`--check` 额外校验 en-US 的**键集与空值**
 * （T1/占位符/长度预算仍由测试承担，避免两处各写一份完整校验）。
 *
 * 用法（`app/` 目录）：
 *   bun run scripts/export-tool-params.ts           # 生成 / 覆盖
 *   bun run scripts/export-tool-params.ts --check   # 只校验（不一致 ⇒ exit 1）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 变体层必须最先注入：`ToolManagerUtils.buildBuiltinToolLoaders()` 在**模块顶层**调
// `feature()`，而 P3 的时序守卫在未注入且非 test 环境下会抛
// `CORE_VARIANT_FLAGS_NOT_INITIALIZED`（CI「Prompt resource gates」即因缺这一行而红）。
import '../src/bootstrap/initVariantFlags';

import { ToolFactory } from '../src/tools/ToolFactory';
import {
  getAllBuiltinToolLoaders,
  loadTools,
} from '../src/tools/utils/ToolManagerUtils';
import type { ToolParam } from '../src/utils/toolContract/Tool';

const LOCALE = 'zh-CN';
const OUT_PATH = resolve(
  import.meta.dir,
  '../prompts',
  LOCALE,
  'tool-params.json'
);
/** en-US 译文（人工维护；`--check` 校验键集与空值） */
const EN_OUT_PATH = resolve(
  import.meta.dir,
  '../prompts',
  'en-US',
  'tool-params.json'
);

interface ToolParamResource {
  schemaVersion: number;
  locale: string;
  generatedBy: string;
  counts: { tools: number; params: number };
  params: Record<string, string>;
}

/** 展开参数（含数组元素与其对象字段） */
function flattenParams(
  toolName: string,
  params: readonly ToolParam[],
  out: Record<string, string>
): number {
  let count = 0;
  for (const param of params) {
    out[`${toolName}.${param.name}`] = param.description;
    count++;

    if (param.items) {
      if (param.items.description) {
        out[`${toolName}.${param.name}.items`] = param.items.description;
        count++;
      }
      for (const [key, sub] of Object.entries(param.items.properties ?? {})) {
        out[`${toolName}.${param.name}.items.${key}`] = sub.description;
        count++;
      }
    }
  }
  return count;
}

function buildResource(): ToolParamResource {
  const tools = loadTools(new ToolFactory(), getAllBuiltinToolLoaders());
  const params: Record<string, string> = {};
  let paramCount = 0;
  let toolCount = 0;

  for (const tool of tools) {
    const info = tool.getInfo();
    if (!info.params || info.params.length === 0) continue;
    toolCount++;
    paramCount += flattenParams(info.name, info.params, params);
  }

  return {
    schemaVersion: 1,
    locale: LOCALE,
    generatedBy: 'app/scripts/export-tool-params.ts',
    counts: { tools: toolCount, params: paramCount },
    params,
  };
}

function serialize(resource: ToolParamResource): string {
  // 键排序保证 diff 稳定（参数顺序不随注册顺序漂移）
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(resource.params).sort()) {
    sorted[key] = resource.params[key];
  }
  return JSON.stringify({ ...resource, params: sorted }, null, 2) + '\n';
}

/**
 * 校验 en-US 译文的**键集与空值**（C-3b 译文批）
 *
 * 完整口径（T1 标识 / 占位符 / 反引号 / ≤2× token）由
 * `tests/prompt-locale/toolParamsLocaleParity.test.ts` 承担；此处只守住
 * 「新增 zh 键必须同步补 en」这条最容易漏的漂移。
 */
function checkEnUs(resource: ToolParamResource): string[] {
  const problems: string[] = [];
  if (!existsSync(EN_OUT_PATH)) {
    return [`缺少 en-US 译文：${EN_OUT_PATH}`];
  }

  let en: ToolParamResource;
  try {
    en = JSON.parse(readFileSync(EN_OUT_PATH, 'utf-8')) as ToolParamResource;
  } catch (err) {
    return [`en-US 译文解析失败：${EN_OUT_PATH}（${String(err)}）`];
  }

  const enParams = en.params ?? {};
  const zhKeys = Object.keys(resource.params);
  const missing = zhKeys.filter((key) => !(key in enParams));
  const extra = Object.keys(enParams).filter(
    (key) => !(key in resource.params)
  );
  const empty = zhKeys.filter((key) => !enParams[key]?.trim());

  if (missing.length > 0) {
    problems.push(
      `en-US 缺键 ${missing.length} 条（示例：${missing.slice(0, 3).join(', ')}）`
    );
  }
  if (extra.length > 0) {
    problems.push(
      `en-US 多键 ${extra.length} 条（示例：${extra.slice(0, 3).join(', ')}）`
    );
  }
  if (empty.length > 0) {
    problems.push(
      `en-US 空译文 ${empty.length} 条（示例：${empty.slice(0, 3).join(', ')}）`
    );
  }
  if (en.counts?.params !== zhKeys.length) {
    problems.push(
      `en-US counts.params=${String(en.counts?.params)} ≠ zh ${zhKeys.length}`
    );
  }

  return problems;
}

function main(): number {
  const resource = buildResource();
  const expected = serialize(resource);

  if (process.argv.includes('--check')) {
    if (!existsSync(OUT_PATH)) {
      console.error(
        `✗ 缺失：${OUT_PATH}（先运行 bun run scripts/export-tool-params.ts）`
      );
      return 1;
    }
    const actual = readFileSync(OUT_PATH, 'utf-8');
    if (actual !== expected) {
      console.error(
        `✗ 工具参数资源与运行时不一致：${OUT_PATH}` +
          `（工具 ${resource.counts.tools} / 参数 ${resource.counts.params}）`
      );
      return 1;
    }

    const enProblems = checkEnUs(resource);
    if (enProblems.length > 0) {
      console.error(`✗ en-US 译文漂移（${enProblems.length} 项）：`);
      for (const problem of enProblems) console.error(`   - ${problem}`);
      return 1;
    }

    console.log(
      `✓ 工具参数资源一致：${resource.counts.tools} 个工具 / ${resource.counts.params} 条描述 · en-US 键集一致`
    );
    return 0;
  }

  writeFileSync(OUT_PATH, expected, 'utf-8');
  console.log(
    `✓ 已导出 ${resource.counts.params} 条参数描述（${resource.counts.tools} 个工具）⇒ ${OUT_PATH}`
  );
  return 0;
}

process.exit(main());

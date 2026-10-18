/**
 * T2（2026-10-18）工具**级描述**冻结导出（模型侧 `tools[].description`）。
 *
 * 从**真实工具实例**（`loadTools + getAllBuiltinToolLoaders`）读取 `getInfo().description`，
 * 落盘为单文件资源：`app/prompts/<locale>/tool-descriptions.json`（键 = 工具 wire 名）。
 *
 * 为什么用单文件而不是逐工具 `.md`：
 * - `ToolRegistry.getToolSchemas()` 是模型侧唯一出口 ⇒ 在此链路单点替换即可覆盖全部工具；
 * - 逐工具改类需要 75 个 getter + locale 时序，且会把 S-P4 刚删掉的 `*_TOOL_PROMPT` 绑定重新引入。
 *
 * **行为零变化**：导出值 === 当前 `getInfo().description`（zh-CN 源语言）；
 * `en-US` 为离线人工译文，键集/空值/工具名守恒由测试守卫。
 *
 * 用法（`app/` 目录）：
 *   bun run scripts/export-tool-descriptions.ts           # 生成 / 覆盖 zh-CN
 *   bun run scripts/export-tool-descriptions.ts --check   # 只校验（漂移 ⇒ exit 1）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ToolFactory } from '../src/tools/ToolFactory';
import {
  getAllBuiltinToolLoaders,
  loadTools,
} from '../src/tools/utils/ToolManagerUtils';

const LOCALE = 'zh-CN';
const OUT_PATH = resolve(
  import.meta.dir,
  '../prompts',
  LOCALE,
  'tool-descriptions.json'
);
const EN_OUT_PATH = resolve(
  import.meta.dir,
  '../prompts',
  'en-US',
  'tool-descriptions.json'
);

interface ToolDescriptionResource {
  schemaVersion: number;
  locale: string;
  generatedBy: string;
  counts: { tools: number };
  descriptions: Record<string, string>;
}

function buildResource(): ToolDescriptionResource {
  const tools = loadTools(new ToolFactory(), getAllBuiltinToolLoaders());
  const descriptions: Record<string, string> = {};
  for (const tool of tools) {
    const info = tool.getInfo();
    descriptions[info.name] = info.description ?? '';
  }
  return {
    schemaVersion: 1,
    locale: LOCALE,
    generatedBy: 'app/scripts/export-tool-descriptions.ts',
    counts: { tools: Object.keys(descriptions).length },
    descriptions,
  };
}

function serialize(resource: ToolDescriptionResource): string {
  // 键排序保证 diff 稳定（工具注册顺序变化不产生噪声）
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(resource.descriptions).sort()) {
    sorted[key] = resource.descriptions[key];
  }
  return JSON.stringify({ ...resource, descriptions: sorted }, null, 2) + '\n';
}

/**
 * en-US 译文漂移校验：键集 / 空值 / 工具名守恒（T1）。
 *
 * 完整译文质量（无 CJK、长度预算）由
 * `tests/prompt-locale/toolDescriptionsLocaleParity.test.ts` 守卫；
 * 此处只拦「新增工具未补 en」这一最易漏的漂移。
 */
function checkEnUs(resource: ToolDescriptionResource): string[] {
  const problems: string[] = [];
  if (!existsSync(EN_OUT_PATH)) {
    return [`缺少 en-US 译文：${EN_OUT_PATH}`];
  }

  let en: ToolDescriptionResource;
  try {
    en = JSON.parse(
      readFileSync(EN_OUT_PATH, 'utf-8')
    ) as ToolDescriptionResource;
  } catch (err) {
    return [`en-US 译文解析失败：${EN_OUT_PATH}（${String(err)}）`];
  }

  const enDescriptions = en.descriptions ?? {};
  const zhKeys = Object.keys(resource.descriptions);
  const missing = zhKeys.filter((key) => !(key in enDescriptions));
  const extra = Object.keys(enDescriptions).filter(
    (key) => !(key in resource.descriptions)
  );
  const empty = zhKeys.filter((key) => !enDescriptions[key]?.trim());

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
  if (en.counts?.tools !== zhKeys.length) {
    problems.push(
      `en-US counts.tools=${String(en.counts?.tools)} ≠ zh ${zhKeys.length}`
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
        `✗ 缺失：${OUT_PATH}（先运行 bun run scripts/export-tool-descriptions.ts）`
      );
      return 1;
    }
    const actual = readFileSync(OUT_PATH, 'utf-8');
    if (actual !== expected) {
      console.error(
        `✗ 工具级描述资源与运行时不一致：${OUT_PATH}（工具 ${resource.counts.tools}）`
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
      `✓ 工具级描述资源一致：${resource.counts.tools} 个工具 · en-US 键集一致`
    );
    return 0;
  }

  writeFileSync(OUT_PATH, expected, 'utf-8');
  console.log(`✓ 已导出 ${resource.counts.tools} 个工具描述 ⇒ ${OUT_PATH}`);
  return 0;
}

process.exit(main());

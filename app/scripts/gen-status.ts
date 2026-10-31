#!/usr/bin/env bun
/**
 * gen-status.ts — 生成仓库 `STATUS.md`（README 中"易漂移数字"的单一出口）
 *
 * 背景（`dev_docs/20261031/deepseek建议.md` §3）：README 正文里的「82 个工具 / 27 个通道 / 71 个模块」
 * 这类数字随迭代漂移，且没有任何机制拦截。改为：数字只出现在本脚本生成的 `STATUS.md`，
 * README 只放指针。
 *
 * 用法：
 *   bun run gen:status        # 生成 / 更新 STATUS.md
 *   bun run lint:status       # 校验（--check）：与事实源现算结果不一致 ⇒ 退出 1（CI 门禁）
 *
 * 口径（全部**静态计数**，不 import app 模块 ⇒ 无副作用、不拉启动面）：
 *   工具   `toolNames.generated.ts` 的 `TOOL_NAMES_COUNT`（全量 ∧ 可实例化；flag-gated 默认关者不计）
 *   通道   `channels/ChannelCatalog.ts` 的 `exportKey: '…'` 条目数（接口声明 `exportKey: string;` 不计）
 *   模块   `modules/ModuleDefinitions.ts` 的顶层条目数（4 空格缩进的 `id: '…'`）
 *
 * 为什么不带时间戳：本文件要能被 `--check` **逐字节比对**；时间戳会让每次运行都"有差异"，
 * 反而迫使人手改或忽略门禁。内容只随事实源变化。
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

const APP_DIR = resolve(import.meta.dir, '..');
const REPO_ROOT = resolve(APP_DIR, '..');
const OUT_FILE = join(REPO_ROOT, 'STATUS.md');
const DOCS_DIR = join(APP_DIR, 'docs');

interface Metric {
  label: string;
  value: number;
  source: string;
  scope: string;
}

function readSource(relFromApp: string): string {
  const file = join(APP_DIR, relFromApp);
  if (!existsSync(file)) {
    throw new Error(`事实源不存在: ${relative(REPO_ROOT, file)}`);
  }
  return readFileSync(file, 'utf-8');
}

/** 计数并断言 > 0（AR-3：正则失效不得静默当成 0） */
function countMatches(
  text: string,
  pattern: RegExp,
  what: string,
  relFromApp: string
): number {
  const count = (text.match(pattern) ?? []).length;
  if (count === 0) {
    throw new Error(
      `计数为 0（解析失效？）：${what} @ ${relFromApp} —— 请先修脚本，不要把 0 当成事实`
    );
  }
  return count;
}

/**
 * 文档语料篇数 —— 与 `src/docs/FileDocsProvider.scanDirectory` **同口径**：
 * 递归 `.md`，跳过隐藏目录（`.knowledge-trash` 等）与 `raw/` 源目录。
 *
 * 为什么并入本文件（2026-10-31）：README 曾把「143 篇真实文档」写死在两处，
 * 而语料实为 145 篇（新增文档后静默漂移）—— 与工具/通道数同属「易漂移数字」。
 */
function countDocCorpus(dir: string): number {
  let count = 0;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'raw') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) count += countDocCorpus(full);
    else if (name.endsWith('.md')) count += 1;
  }
  return count;
}

function collect(): Metric[] {
  const toolNamesFile = 'src/constants/toolNames.generated.ts';
  const toolNames = readSource(toolNamesFile);
  const toolCount = Number(
    /^export const TOOL_NAMES_COUNT = (\d+);/m.exec(toolNames)?.[1] ?? NaN
  );
  if (!Number.isFinite(toolCount) || toolCount <= 0) {
    throw new Error(`TOOL_NAMES_COUNT 解析失败: ${toolNamesFile}`);
  }

  const channelFile = 'src/channels/ChannelCatalog.ts';
  const channelCount = countMatches(
    readSource(channelFile),
    /exportKey:\s*'/g,
    'CHANNEL_CATALOG 条目',
    channelFile
  );

  const moduleFile = 'src/modules/ModuleDefinitions.ts';
  const moduleCount = countMatches(
    readSource(moduleFile),
    /^ {4}id: '/gm,
    'MODULE_DEFINITIONS 条目',
    moduleFile
  );

  const docsCount = countDocCorpus(DOCS_DIR);
  if (docsCount <= 0) {
    throw new Error(
      `文档语料计数为 0（扫描失效？）: ${relative(REPO_ROOT, DOCS_DIR)}`
    );
  }

  return [
    {
      label: '内建工具',
      value: toolCount,
      source: `app/${toolNamesFile}`,
      scope: '全量 ∧ 可实例化（flag-gated 且默认关闭者不计）',
    },
    {
      label: '消息通道',
      value: channelCount,
      source: `app/${channelFile}`,
      scope: '`CHANNEL_CATALOG` 登记的通道（含编译期可裁剪者）',
    },
    {
      label: '模块定义',
      value: moduleCount,
      source: `app/${moduleFile}`,
      scope: '`MODULE_DEFINITIONS` 顶层条目',
    },
    {
      label: '文档语料',
      value: docsCount,
      source: 'app/docs/**/*.md',
      scope:
        '与 `docs/FileDocsProvider` 同口径（递归 `.md`，跳过隐藏目录与 `raw/`）',
    },
  ];
}

function render(metrics: Metric[]): string {
  const rows = metrics
    .map(
      (m) => `| ${m.label} | **${m.value}** | \`${m.source}\` | ${m.scope} |`
    )
    .join('\n');
  return `<!-- 由 \`bun run gen:status\` 生成，请勿手改；校验见 \`bun run lint:status\` -->
# 仓库状态（STATUS）

> README 中「多少个工具 / 多少条通道 / 多少个模块 / 多少篇文档语料」这类**易漂移数字**只在本文件出现，
> 由脚本从事实源现算，避免文档与代码脱节。
> 更新：\`cd app && bun run gen:status\` ｜ 校验：\`bun run lint:status\`（CI 门禁，内容不一致即阻断）。

| 指标 | 数值 | 事实源 | 口径 |
|---|---:|---|---|
${rows}

## 说明

- 数值**随代码自动重算**：本文件不含时间戳，内容只随事实源变化 ⇒ 可直接逐字节比对。
- 新增指标请同批更新 \`app/scripts/gen-status.ts\` 的 \`collect()\` 与本文表头口径。
`;
}

function main(): number {
  const content = render(collect());

  if (process.argv.includes('--check')) {
    const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf-8') : '';
    if (current === content) {
      console.log('✅ STATUS.md 与事实源一致');
      return 0;
    }
    console.error(
      '❌ STATUS.md 与事实源不一致（计数已变）—— 请运行 `cd app && bun run gen:status` 后重新提交'
    );
    console.error(`   文件: ${relative(REPO_ROOT, OUT_FILE)}`);
    return 1;
  }

  writeFileSync(OUT_FILE, content, 'utf-8');
  console.log(`✅ 已生成 ${relative(REPO_ROOT, OUT_FILE)}`);
  for (const m of collect()) console.log(`   ${m.label}: ${m.value}`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`❌ STATUS 生成失败（不视为通过）: ${String(err)}`);
  process.exit(1);
}

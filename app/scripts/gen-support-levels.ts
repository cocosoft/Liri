#!/usr/bin/env bun
/**
 * gen-support-levels.ts — 生成 `app/docs/SUPPORT-LEVELS.md`（通道 / 工具的「支持等级」台账）
 *
 * 背景（`dev_docs/20261031/deepseek建议.md` §2）：通道与工具面广，维护成本随上游 API 线性增长；
 * 需要一条可核对的口径区分「谁在被持续验证」。本脚本**不替人做产品判断**，只把可测信号摊开：
 *
 *   等级推导（可由 `.trae/architecture/support-levels.json` 的 overrides 覆盖）：
 *     core        有**专属测试**引用该通道/工具（`app/tests/**` 命中其标识符）
 *     community   当前无专属测试（仍随包分发，但回归覆盖不足）
 *     experimental 维护者显式标注为实验性（overrides）
 *
 * 门禁：`bun run lint:support-levels`（`--check`）逐字节比对；台账与事实源/测试集不一致即阻断。
 * 口径：标识符级 grep 是**启发式**（会在台账里写明命中文件），不宣称等于"覆盖充分"。
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const APP_DIR = resolve(import.meta.dir, '..');
const REPO_ROOT = resolve(APP_DIR, '..');
const OUT_FILE = join(APP_DIR, 'docs', 'SUPPORT-LEVELS.md');
const OVERRIDES_FILE = join(REPO_ROOT, '.trae', 'architecture', 'support-levels.json');
const TESTS_DIR = join(APP_DIR, 'tests');

type Level = 'core' | 'community' | 'experimental';
const LEVELS: readonly Level[] = ['core', 'community', 'experimental'];

interface Overrides {
  version?: number;
  note?: string;
  channels?: Record<string, Level>;
  tools?: Record<string, Level>;
}

interface Row {
  id: string;
  level: Level;
  /** 命中的测试文件（相对仓库根）；无则空 */
  evidence: string;
}

function read(relFromApp: string): string {
  const file = join(APP_DIR, relFromApp);
  if (!existsSync(file)) throw new Error(`事实源不存在: ${relative(REPO_ROOT, file)}`);
  return readFileSync(file, 'utf-8');
}

/** 通道：`CHANNEL_CATALOG` 条目的 `type: '…'`（以「后跟 name」锚定条目，多段缩进均可） */
function channelIds(): string[] {
  const text = read('src/channels/ChannelCatalog.ts');
  const ids: string[] = [];
  const re = /\btype:\s*'([^']+)',\s*\n\s*name:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!ids.includes(m[1]!)) ids.push(m[1]!);
  }
  if (ids.length === 0) throw new Error('CHANNEL_CATALOG 解析失败（0 条）');
  return ids;
}

/** 工具：`TOOL_NAMES` 数组内的字符串字面量 */
function toolIds(): string[] {
  const text = read('src/constants/toolNames.generated.ts');
  const block = /export const TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(text)?.[1];
  if (!block) throw new Error('TOOL_NAMES 数组解析失败');
  const ids = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  if (ids.length === 0) throw new Error('TOOL_NAMES 解析失败（0 条）');
  return ids;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function loadOverrides(): Overrides {
  if (!existsSync(OVERRIDES_FILE)) return {};
  try {
    return JSON.parse(readFileSync(OVERRIDES_FILE, 'utf-8')) as Overrides;
  } catch (err) {
    throw new Error(`overrides 解析失败（fail-closed）: ${String(err)}`);
  }
}

/**
 * 只认**引号包裹**的标识符（`'telegram'` / `"bash"` / `` `config` ``）：
 * 裸词匹配会把 `config`、`image` 这类通用词在无关测试里全算命中，台账就失真了。
 */
function findEvidence(testFiles: Array<{ rel: string; text: string }>, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`['"\`]${escaped}['"\`]`);
  const hit = testFiles.find((f) => re.test(f.text));
  return hit?.rel ?? '';
}

function derive(id: string, tests: Array<{ rel: string; text: string }>, override?: Level): Row {
  const evidence = findEvidence(tests, id);
  const level: Level = override ?? (evidence ? 'core' : 'community');
  return { id, level, evidence };
}

function collect(): { channels: Row[]; tools: Row[] } {
  const overrides = loadOverrides();
  for (const [kind, map] of [
    ['channels', overrides.channels],
    ['tools', overrides.tools],
  ] as const) {
    for (const [id, level] of Object.entries(map ?? {})) {
      if (!LEVELS.includes(level)) {
        throw new Error(`overrides.${kind}.${id} 的等级非法: ${String(level)}`);
      }
    }
  }
  const channelList = channelIds();
  const toolList = toolIds();
  const allIds = [...channelList, ...toolList];
  const quoted = (id: string): RegExp =>
    new RegExp(`['"\`]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);

  const testFiles = walk(TESTS_DIR).map((path) => ({
    rel: relative(REPO_ROOT, path).split(sep).join('/'),
    text: readFileSync(path, 'utf-8'),
  }));
  // 列举型测试（一次提到 >5 个标识，如"注册面完整性/枚举一致性"断言）不构成单个通道/工具的专属证据
  const dedicated = testFiles.filter(
    (f) => allIds.filter((id) => quoted(id).test(f.text)).length <= 5
  );

  return {
    channels: channelList.map((id) => derive(id, dedicated, overrides.channels?.[id])),
    tools: toolList.map((id) => derive(id, dedicated, overrides.tools?.[id])),
  };
}

function table(rows: Row[]): string {
  const head = '| 标识 | 支持等级 | 专属测试证据 |\n|---|---|---|';
  const body = rows
    .map((r) => `| \`${r.id}\` | ${r.level} | ${r.evidence ? `\`${r.evidence}\`` : '—（无专属测试）'} |`)
    .join('\n');
  return `${head}\n${body}`;
}

function render(data: { channels: Row[]; tools: Row[] }): string {
  const core = (rows: Row[]): number => rows.filter((r) => r.level === 'core').length;
  const community = (rows: Row[]): number => rows.filter((r) => r.level === 'community').length;
  return `<!-- 由 \`bun run gen:support-levels\` 生成，请勿手改；校验见 \`bun run lint:support-levels\` -->
# 支持等级台账（SUPPORT LEVELS）

> 目的：把「哪些通道 / 工具在被持续验证」摊开，避免上游 API 变更后长期无人发现。
> 更新：\`cd app && bun run gen:support-levels\` ｜ 校验：\`bun run lint:support-levels\`（CI + pre-commit 门禁）。

## 口径（可核对，不替代产品判断）

| 等级 | 判据 |
|---|---|
| \`core\` | 在 \`app/tests/**\` 有**专属测试**引用该标识（见「专属测试证据」列） |
| \`community\` | 随包分发，但当前无专属测试引用 ⇒ 回归覆盖不足，优先补测试 |
| \`experimental\` | 维护者在 \`.trae/architecture/support-levels.json\` 显式标注 |

- 推导是**标识符级 grep**（启发式）：命中只说明"有测试提到它"，不等于覆盖充分；台账如实给出命中文件，供人工复核。
- 维护者可用 overrides 覆盖等级（如把无测试但实际稳定的通道标为 \`core\`，或把新通道标 \`experimental\`）。

## 汇总

| 面 | 总数 | core | community |
|---|---:|---:|---:|
| 消息通道 | ${data.channels.length} | ${core(data.channels)} | ${community(data.channels)} |
| 内建工具 | ${data.tools.length} | ${core(data.tools)} | ${community(data.tools)} |

## 消息通道

${table(data.channels)}

## 内建工具

${table(data.tools)}
`;
}

function main(): number {
  const content = render(collect());
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf-8') : '';
    if (current === content) {
      console.log('✅ SUPPORT-LEVELS.md 与事实源一致');
      return 0;
    }
    console.error(
      '❌ SUPPORT-LEVELS.md 与事实源/测试集不一致 —— 请运行 `cd app && bun run gen:support-levels` 后重新提交'
    );
    return 1;
  }
  writeFileSync(OUT_FILE, content, 'utf-8');
  console.log(`✅ 已生成 ${relative(REPO_ROOT, OUT_FILE)}`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`❌ 支持等级台账生成失败（不视为通过）: ${String(err)}`);
  process.exit(1);
}

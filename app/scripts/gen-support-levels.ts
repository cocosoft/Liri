#!/usr/bin/env bun
/**
 * gen-support-levels.ts — 生成 `app/docs/SUPPORT-LEVELS.md`（通道 / 工具的「支持等级」台账）
 *
 * 背景（`dev_docs/20261031/deepseek建议.md` §2）：通道与工具面广，维护成本随上游 API 线性增长；
 * 需要一条可核对的口径区分「谁在被持续验证」。本脚本**不替人做产品判断**，只把可测信号摊开：
 *
 *   等级推导（可由 `.trae/architecture/support-levels.json` 的 overrides 覆盖）：
 *     core        有**专属信号**：测试文件名按名指代该标识，或测试直接 import 其实现类
 *     community   无上述专属信号（仍随包分发，但回归覆盖不足）
 *     experimental 维护者显式标注为实验性（overrides）
 *
 * 门禁：`bun run lint:support-levels`（`--check`）逐字节比对；台账与事实源/测试集不一致即阻断。
 *
 * ⚠️ 2026-10-31 收紧（台账自审）：旧判据是「任意测试文件里出现过带引号的标识符」⇒
 * 埋点里的 `file_write`、模型类型里的 `image`、XML 解析器里的 `bash` 都被算成「专属测试」，
 * `core` 被稀释（表格形态还在传达权威感，脚注救不回来）。现只认**专属信号**：
 *   ① 测试文件名归一化后**以该标识开头**（`bashPermissionInjection` ⇒ `bash`、
 *      `powerShellTrustLevel` ⇒ `powershell`、`notebook.test.ts` ⇒ `notebook`）；
 *   ② 测试直接 import 该工具/通道的实现类（`import { FileEditTool }` ⇒ `file_edit`）。
 * 附加约束：通道证据须在 `app/tests/channels/**`；单文件涉及 >5 个标识视为列举型，其 import 不作证据。
 * 普通字符串提及**不再计入**等级（需要时用 overrides 显式登记）。
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

const APP_DIR = resolve(import.meta.dir, '..');
const REPO_ROOT = resolve(APP_DIR, '..');
const OUT_FILE = join(APP_DIR, 'docs', 'SUPPORT-LEVELS.md');
const OVERRIDES_FILE = join(
  REPO_ROOT,
  '.trae',
  'architecture',
  'support-levels.json'
);
const TESTS_DIR = join(APP_DIR, 'tests');

type Level = 'core' | 'community' | 'experimental';
const LEVELS: readonly Level[] = ['core', 'community', 'experimental'];

interface Overrides {
  version?: number;
  note?: string;
  channels?: Record<string, Level>;
  tools?: Record<string, Level>;
}

interface Evidence {
  /** 专属测试文件（相对仓库根）；无则空 */
  rel: string;
  /** 判定依据：`测试文件名` / `实现类导入`；无证据时为空 */
  via: string;
}

interface Row {
  id: string;
  level: Level;
  evidence: Evidence;
}

/** 归一化标识（去分隔符 + 小写）：`file_edit` ⇔ `FileEditTool` ⇔ `fileEdit.test.ts` */
function norm(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/** 通道专属测试的归属域：通道证据必须落在这里（防止 `signalBaseline.test.ts` 之类同名误判） */
const CHANNEL_TEST_DOMAIN = 'app/tests/channels/';

/** 单文件涉及标识数上限：超过即视为「列举型」测试，其 import 不构成单个标识的证据 */
const LISTING_TEST_ID_LIMIT = 5;

interface TestFile {
  rel: string;
  /** 归一化的文件名（去 `.test.ts(x)`），用于「文件名以标识开头」判定 */
  stemNorm: string;
  /** 该测试 import 的具名标识符（归一化） */
  imports: string[];
}

function read(relFromApp: string): string {
  const file = join(APP_DIR, relFromApp);
  if (!existsSync(file))
    throw new Error(`事实源不存在: ${relative(REPO_ROOT, file)}`);
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
  const block = /export const TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(
    text
  )?.[1];
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

/** 测试文件的 `import { … } from` 具名标识符（去 `type` 前缀与 `as` 别名，归一化） */
function importedIdentifiers(text: string): string[] {
  return [...text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s*from/g)]
    .flatMap((m) => m[1]!.split(','))
    .map((s) =>
      s
        .trim()
        .replace(/^type\s+/, '')
        .replace(/\s+as\s+\w+$/, '')
    )
    .map(norm)
    .filter(Boolean);
}

/**
 * 只认**专属信号**（普通字符串提及不计，见文件头 2026-10-31 收紧说明）：
 *   ① 测试**文件名归一化后以该标识开头**（`bashPermissionInjection` ⇒ `bash`、
 *      `powerShellTrustLevel` ⇒ `powershell`、`fileEditTool` ⇒ `file_edit`）；
 *   ② 测试**直接 import 其实现类**（`FileEditTool` ⇒ `file_edit`，兼容 `…Tool` / `…Channel`）。
 * 两条附加约束：
 *   · 通道证据必须位于 `app/tests/channels/**`（否则 `signalBaseline` 之类同名即串味）；
 *   · 单文件涉及标识数 > `LISTING_TEST_ID_LIMIT` 视为「列举型」测试，其 import 不作证据。
 * 同一文件被多个标识命中时按**归一化长度最长者**归属（避免 `image` 抢走 `image_analysis` 的测试）。
 */
function resolveEvidence(
  tests: TestFile[],
  ids: readonly string[],
  opts: { channelDomain?: boolean } = {}
): Map<string, Evidence> {
  const out = new Map<string, Evidence>();
  const scoped = tests.filter(
    (t) => !opts.channelDomain || t.rel.startsWith(CHANNEL_TEST_DOMAIN)
  );
  const byLongest = [...ids].sort((a, b) => norm(b).length - norm(a).length);

  for (const t of scoped) {
    const owner = byLongest.find((id) => t.stemNorm.startsWith(norm(id)));
    if (owner && !out.has(owner))
      out.set(owner, { rel: t.rel, via: '测试文件名' });
  }

  for (const t of scoped) {
    const imported = ids.filter((id) => {
      const n = norm(id);
      return t.imports.some(
        (x) => x === n || x === `${n}tool` || x === `${n}channel`
      );
    });
    if (imported.length > LISTING_TEST_ID_LIMIT) continue;
    for (const id of imported) {
      if (!out.has(id)) out.set(id, { rel: t.rel, via: '实现类导入' });
    }
  }
  return out;
}

function derive(
  id: string,
  evidence: Map<string, Evidence>,
  override?: Level
): Row {
  const hit = evidence.get(id) ?? { rel: '', via: '' };
  const level: Level = override ?? (hit.rel ? 'core' : 'community');
  return { id, level, evidence: hit };
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
  const testFiles: TestFile[] = walk(TESTS_DIR).map((path) => {
    const text = readFileSync(path, 'utf-8');
    return {
      rel: relative(REPO_ROOT, path).split(sep).join('/'),
      stemNorm: norm(basename(path).replace(/\.test\.tsx?$/, '')),
      imports: importedIdentifiers(text),
    };
  });
  const channelEvidence = resolveEvidence(testFiles, channelList, {
    channelDomain: true,
  });
  const toolEvidence = resolveEvidence(testFiles, toolList);

  return {
    channels: channelList.map((id) =>
      derive(id, channelEvidence, overrides.channels?.[id])
    ),
    tools: toolList.map((id) =>
      derive(id, toolEvidence, overrides.tools?.[id])
    ),
  };
}

function table(rows: Row[]): string {
  const head = '| 标识 | 支持等级 | 专属测试证据 |\n|---|---|---|';
  const body = rows
    .map(
      (r) =>
        `| \`${r.id}\` | ${r.level} | ${
          r.evidence.rel
            ? `\`${r.evidence.rel}\`（${r.evidence.via}）`
            : '—（无专属测试）'
        } |`
    )
    .join('\n');
  return `${head}\n${body}`;
}

function render(data: { channels: Row[]; tools: Row[] }): string {
  const core = (rows: Row[]): number =>
    rows.filter((r) => r.level === 'core').length;
  const community = (rows: Row[]): number =>
    rows.filter((r) => r.level === 'community').length;
  return `<!-- 由 \`bun run gen:support-levels\` 生成，请勿手改；校验见 \`bun run lint:support-levels\` -->
# 支持等级台账（SUPPORT LEVELS）

> 目的：把「哪些通道 / 工具在被持续验证」摊开，避免上游 API 变更后长期无人发现。
> 更新：\`cd app && bun run gen:support-levels\` ｜ 校验：\`bun run lint:support-levels\`（CI + pre-commit 门禁）。

## 口径（可核对，不替代产品判断）

| 等级 | 判据 |
|---|---|
| \`core\` | 有**专属信号**（见下方两种），见「专属测试证据」列 |
| \`community\` | 随包分发，但无专属信号 ⇒ 回归覆盖不足，优先补测试 |
| \`experimental\` | 维护者在 \`.trae/architecture/support-levels.json\` 显式标注 |

- 专属信号只有两种，**普通字符串提及不再计入**（2026-10-31 收紧）：
  ① 测试**文件名归一化后以该标识开头**（如 \`bashPermissionInjection\` ⇒ \`bash\`、
     \`powerShellTrustLevel\` ⇒ \`powershell\`、\`notebook.test.ts\` ⇒ \`notebook\`）；
  ② 测试**直接 import 其实现类**（如 \`import { FileEditTool }\` ⇒ \`file_edit\`）。
- 附加约束：通道证据须位于 \`app/tests/channels/**\`；单文件涉及 >5 个标识视为「列举型」测试，其 import 不作证据。
- 收紧原因（实证）：旧判据「任意测试里出现过带引号的标识」把埋点字符串（\`analyticsIdentityBuckets\` 的 \`file_write\`）、
  模型类型（\`deriveModelType\` 的 \`image\`）、XML 解析样本（\`InvokeXmlParser\` 的 \`bash\`）都算成「专属测试」，
  令 \`core\` 被稀释 —— 证据列看起来权威，实际只是"某处提到过"。
- 维护者可用 overrides 覆盖等级（如把有集成测试但文件名不指代的通道标为 \`core\`，或把新通道标 \`experimental\`）。

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

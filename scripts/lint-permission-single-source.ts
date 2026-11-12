#!/usr/bin/env bun
/**
 * lint-permission-single-source.ts — 权限规则「单一来源」门禁（P2-2 / P2-3，2026-11-03）
 *
 * 立论（`dev_docs/20261027/工具权限体系归一化方案-20261027.md` §5 P2）：
 * 危险模式表与只读命令目录此前**各写一份**（`security/patterns` / `sandbox` / `tools`），
 * 规则一改就漂移。归一化后，**规则清单只允许在下列两个文件声明**：
 *   1. `packages/infra/src/security/patterns/dangerousCommands.ts`（危险模式）
 *   2. `packages/infra/src/security/readOnlyCommands.ts`（只读命令目录）
 *
 * 判据（fail-closed）：
 *   ① 同名常量在非规范文件里**以字面集合声明**（`[...]` / `new Set([...])`）⇒ 违规；
 *      允许"引用式别名"（`const X = CANONICAL_X`），那不是第二份。
 *   ② 非规范文件出现 ≥3 条危险命令字面量（`'rm -rf'` / `'mkfs'` …）⇒ 疑似第二份危险表。
 *   ③ 非规范文件出现 ≥6 条只读命令字面量（`'ls'` / `'cat'` …）⇒ 疑似第二份只读目录。
 *   ②③ 的**刻意分层**（CD07 纵深防御 / 不同用途词表）必须进 `ALLOWLIST` 且理由非空。
 *   任何扫描输入缺失 / 读取失败 ⇒ exit 1（不得静默降级为「0 违规」）。
 *
 * 用法：`bun run scripts/lint-permission-single-source.ts`（CI / `bun run ci` 均调用）
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// `PYAPP_PROJECT_DIR` 仅用于**单测夹具**（指向临时工程树）；生产/CI 走脚本自身位置。
const REPO_ROOT = process.env.PYAPP_PROJECT_DIR
  ? resolve(process.env.PYAPP_PROJECT_DIR)
  : resolve(import.meta.dir, '..');

const SCAN_DIRS = ['app/src', 'packages'];

/** 规范声明位置：常量名 → 唯一允许声明的文件（相对仓库根） */
const CANONICAL_FILES = {
  dangerous: 'packages/infra/src/security/patterns/dangerousCommands.ts',
  readOnly: 'packages/infra/src/security/readOnlyCommands.ts',
} as const;

const CANONICAL_NAMES: Record<string, string> = {
  // 危险模式（唯一真源）
  ALL_UNIFIED_RULES: CANONICAL_FILES.dangerous,
  DELETION_RULES: CANONICAL_FILES.dangerous,
  FORMAT_RULES: CANONICAL_FILES.dangerous,
  PRIVILEGE_RULES: CANONICAL_FILES.dangerous,
  SYSTEM_RULES: CANONICAL_FILES.dangerous,
  INJECTION_RULES: CANONICAL_FILES.dangerous,
  COMPOSITE_COMMAND_RULES: CANONICAL_FILES.dangerous,
  DANGEROUS_COMMAND_PATTERNS: CANONICAL_FILES.dangerous,
  DANGEROUS_BASE_COMMANDS: CANONICAL_FILES.dangerous,
  POWERSHELL_DELETION_ALIASES: CANONICAL_FILES.dangerous,
  // 只读命令目录
  READ_ONLY_BASE_COMMANDS: CANONICAL_FILES.readOnly,
  BASH_READ_ONLY_PREFIX_PATTERNS: CANONICAL_FILES.readOnly,
  POWERSHELL_READ_ONLY_PREFIX_PATTERNS: CANONICAL_FILES.readOnly,
  VERSION_ONLY_QUERY_PATTERN: CANONICAL_FILES.readOnly,
  GIT_READ_ONLY_PATTERN: CANONICAL_FILES.readOnly,
  GIT_READ_ONLY_SUBCOMMANDS: CANONICAL_FILES.readOnly,
  BASH_QUICK_READ_ONLY_COMMANDS: CANONICAL_FILES.readOnly,
  POWERSHELL_ALLOWED_COMMAND_PREFIXES: CANONICAL_FILES.readOnly,
  POWERSHELL_READ_ONLY_COMMAND_PATTERNS: CANONICAL_FILES.readOnly,
  AUTO_MODE_READONLY_COMMANDS: CANONICAL_FILES.readOnly,
  AUTO_MODE_GIT_READONLY_SUBCOMMANDS: CANONICAL_FILES.readOnly,
};

/** 已废弃的旧名：任何文件都不得再以字面集合声明（只能引用新名） */
const RETIRED_NAMES = [
  'READ_ONLY_BASES',
  'READ_ONLY_PREFIXES',
  'VERSION_ONLY_PATTERNS',
  'GIT_READ_ONLY',
  'ALLOWED_POWERSHELL_COMMANDS',
];

/** 危险命令字面量（用于发现"第二份危险表"） */
const DANGER_TOKENS = [
  'rm -rf',
  'mkfs',
  'dd if=',
  'chmod 777',
  'remove-item',
  'invoke-expression',
  'forkbomb',
  'shutdown',
];

/** 只读命令字面量（用于发现"第二份只读目录"） */
const READONLY_TOKENS = [
  'ls',
  'cat',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'sort',
  'uniq',
  'pwd',
  'whoami',
  'date',
];

/**
 * 刻意分层 / 不同用途的豁免表（理由必须非空）。
 * - `dangerous-literals`：② 的豁免；`readonly-literals`：③ 的豁免。
 */
const ALLOWLIST: Record<
  string,
  { reason: string; rules: Array<'dangerous-literals' | 'readonly-literals'> }
> = {
  'app/src/sandbox/SandboxSecurityChecker.ts': {
    reason:
      'CD07：沙箱层刻意保留独立的危险命令集合（纵深防御，方案 §3 第 4 条「不合并」）',
    rules: ['dangerous-literals'],
  },
  'packages/infra/src/security/patterns/autoModeCommandTokens.ts': {
    reason:
      'auto 模式**命令位**令牌表（硬拦命中即 deny / 审批转 ask）：与 security/patterns 的正则规则匹配语义不同，刻意并列；普通命令逐条收敛见方案 P5',
    rules: ['dangerous-literals'],
  },
  'packages/infra/src/security/patterns/commandAliases.ts': {
    reason:
      '命令**等价组**归一表（`Rename-Item`↔`ren`、`Remove-Item`↔`del` 等）：只负责「同一操作的不同写法」映射，档位（deny/ask）仍只由 autoModeCommandTokens.ts 决定 ⇒ 非第二份危险表',
    rules: ['dangerous-literals'],
  },
  'packages/infra/src/security/patterns/commandSpecs.ts': {
    reason:
      '命令语义注册表（P1 单一来源）：两档令牌**由它派生**（`approvalTokensFromSpecs()` / `denyTokensFromSpecs()`），此处出现的命令名就是唯一真源本身，不是第二份危险表',
    rules: ['dangerous-literals'],
  },
  'packages/infra/src/security/readOnlyValidation.ts': {
    reason: 'READONLY_MODE 的配置默认值（用户可覆盖），非安全判定的只读目录',
    rules: ['readonly-literals'],
  },
  'app/src/sandbox/utils/DangerousCommandChecker.ts': {
    reason:
      'CD07：沙箱危险命令检查器（纵深层，`bashSecurityGate` 头注明确「并存且刻意分层」）',
    rules: ['dangerous-literals'],
  },
  'app/src/tools/bash/bashCommandPolicy.ts': {
    reason:
      'BashTool 前置策略表（G18 纯搬迁自 BashTool，含命令白名单/解释器表），非单一危险规则源',
    rules: ['dangerous-literals', 'readonly-literals'],
  },
  'app/src/tools/bash/BashSemantics.ts': {
    reason: '命令分类语义（UI 折叠 / 分类），非只读安全目录',
    rules: ['readonly-literals'],
  },
  'packages/infra/src/security/bash/CommandRegistry.ts': {
    reason: '命令元数据注册表（分类/危险标记），非只读安全目录',
    rules: ['readonly-literals'],
  },
  'packages/infra/src/security/commandSemantics.ts': {
    reason: '命令语义库（isReadOnly/isDestructive 标记），非只读判定目录',
    rules: ['readonly-literals', 'dangerous-literals'],
  },
  'packages/infra/src/security/destructiveCommandWarning.ts': {
    reason: '破坏性命令**提示文案**配置（UI 警告），非拦截规则',
    rules: ['dangerous-literals'],
  },
};

function fail(msg: string): never {
  console.error(`❌ [permission-single-source] ${msg}`);
  process.exit(1);
}

/** 递归收集 `.ts`（排除 `.test.ts` / `node_modules`） */
function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full, out);
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    if (entry.includes('.test.')) continue;
    out.push(full);
  }
}

/** 声明正则：`const NAME = [...]` / `const NAME = new Set([...])` / `= Object.freeze({...})` */
const DECLARATION_RE =
  /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(?:new\s+(?:Set|Map)(?:<[^>]*>)?\s*\(\s*)?[[{]/g;

function countLiteral(text: string, token: string): number {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`['"\`]${escaped}['"\`]`, 'gi');
  return (text.match(re) ?? []).length;
}

/**
 * 抽取"集合字面量块"：`new Set([...])` / `const X = [...]` / `const X = { ... }`。
 *
 * 只在**块内**数令牌，避免把"命令语义说明 / 正则消息"里的普通提及误判为第二份清单。
 */
function collectionBlocks(text: string): string[] {
  const blocks: string[] = [];
  const setRe = /new\s+(?:Set|Map)(?:<[^>]*>)?\s*\(\s*\[([\s\S]*?)\]\s*\)/g;
  const arrRe =
    /(?:export\s+)?const\s+[A-Z][A-Z0-9_]*\s*(?::[^=]+)?=\s*\[([\s\S]*?)\];/g;
  for (const re of [setRe, arrRe]) {
    for (const m of text.matchAll(re)) blocks.push(m[1]!);
  }
  return blocks;
}

const files: string[] = [];
for (const dir of SCAN_DIRS) {
  const abs = join(REPO_ROOT, dir);
  if (!existsSync(abs)) fail(`扫描目录缺失：${dir}（无法判定单一来源）`);
  walk(abs, files);
}
if (files.length === 0) fail('未扫描到任何源文件（解析失败）');

const violations: string[] = [];

for (const file of files) {
  const rel = relative(REPO_ROOT, file).split('\\').join('/');
  const text = readFileSync(file, 'utf-8');
  const allow = ALLOWLIST[rel];
  const allowedRules = new Set(allow?.rules ?? []);

  // ① 同名常量在非规范文件里以字面集合声明
  for (const m of text.matchAll(DECLARATION_RE)) {
    const name = m[1]!;
    if (RETIRED_NAMES.includes(name)) {
      violations.push(
        `${rel}: 已废弃常量「${name}」不得再声明（清单只允许在 ${CANONICAL_FILES.readOnly}）`
      );
      continue;
    }
    const canonical = CANONICAL_NAMES[name];
    if (canonical && rel !== canonical) {
      violations.push(
        `${rel}: 「${name}」必须在 ${canonical} 声明；此处为第二份字面集合`
      );
    }
  }

  if (rel === CANONICAL_FILES.dangerous || rel === CANONICAL_FILES.readOnly) {
    continue;
  }

  const blocks = collectionBlocks(text);

  // ② 第二份危险命令表（只看集合字面量块）
  if (!allowedRules.has('dangerous-literals')) {
    const hit = DANGER_TOKENS.filter((t) =>
      blocks.some((b) => countLiteral(b, t) > 0)
    ).length;
    if (hit >= 3) {
      violations.push(
        `${rel}: 疑似第二份危险命令表（集合块命中 ${hit} 条危险字面量）；规则请加到 ${CANONICAL_FILES.dangerous}`
      );
    }
  }

  // ③ 第二份只读命令目录（只看集合字面量块）
  if (!allowedRules.has('readonly-literals')) {
    const hit = READONLY_TOKENS.filter((t) =>
      blocks.some((b) => countLiteral(b, t) > 0)
    ).length;
    if (hit >= 6) {
      violations.push(
        `${rel}: 疑似第二份只读命令目录（集合块命中 ${hit} 条只读字面量）；清单请加到 ${CANONICAL_FILES.readOnly}`
      );
    }
  }
}

if (violations.length > 0) {
  console.error(
    `❌ [permission-single-source] 发现 ${violations.length} 处违反「单一来源」：`
  );
  for (const v of violations) console.error(`   - ${v}`);
  console.error(
    '   处置：把清单收敛到规范文件；确属刻意分层（CD07）则在 ALLOWLIST 登记且理由非空。'
  );
  process.exit(1);
}

console.log(
  `✅ [permission-single-source] 扫描 ${files.length} 个源文件：危险表 / 只读目录各仅一份（豁免 ${Object.keys(ALLOWLIST).length} 处，均带理由）`
);
process.exit(0);

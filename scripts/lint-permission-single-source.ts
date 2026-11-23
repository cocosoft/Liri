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
 *   ④ 工具规则（A 体系）的 HTTP 写入口唯一（`/v1/permissions/rules`）。
 *   ⑤ **审批可执行性契约**（2026-11-24）：bash 工具的每个 `requireApproval: true` 产生点
 *      必须由 `BashTool` 的审批终局预检兜底，且预检必须委托真实的硬拦截函数。
 *   任何扫描输入缺失 / 读取失败 ⇒ exit 1（不得静默降级为「0 违规」）。
 *
 * 用法：`bun run scripts/lint-permission-single-source.ts`（CI / `bun run ci` 均调用）
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
// P0（2026-11-12）：沙箱路径不再手写 —— 搬包时只改 `sandboxPaths` 一处
import { sandboxRepoRel } from './lib/sandboxPaths';

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
  [sandboxRepoRel('SandboxSecurityChecker.ts')]: {
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
  [sandboxRepoRel('utils', 'DangerousCommandChecker.ts')]: {
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

// ─── ④ 工具规则「HTTP 写入口唯一」（R1，2026-11-17）────────────────────────────
//
// 治理方案 §3.1（修正版）：工具规则（A 体系，落 `tool_rules.json`）的唯一写入口是
// `POST/DELETE /v1/permissions/rules`；`PUT /v1/config/{key}` 是**通用配置段写入**
// （`permission` 段 = B 体系命令规则 / 信任工作区 / 信任档），两者不得混写。
// 判据（仅扫 HTTP 层，故不会误伤文档/技能里的路径提及）：
//   ④a HTTP 层出现 `tool_rules.json` 字面量 ⇒ 规则库路径只属于 `RuleManager`；
//   ④b `/v1/permissions/rules` 只允许出现在唯一写入口与其**唯一路由注册点** ⇒
//       新增第二套端点/转发路径会被点名（`PUT /v1/config/{key}` 的混写在运行时由
//       `config-permission-guard` 拒绝并指回本入口）。
const TOOL_RULE_HTTP_PREFIX = 'app/src/infrastructure/http/';
const TOOL_RULE_HTTP_ENTRY =
  'app/src/infrastructure/http/handlers/permission-handlers.ts';
/** 允许出现工具规则写路径的文件：实现 + 路由注册点（唯一） */
const TOOL_RULE_HTTP_ENTRY_FILES = new Set([
  TOOL_RULE_HTTP_ENTRY,
  'app/src/infrastructure/http/handlers/routes/config-skills-routes.ts',
]);
const RULE_STORE_PATH_LITERAL = 'tool_rules.json';
/**
 * 路由注册形态（`url === '/v1/permissions/rules'` / `startsWith(...)`）。
 * 只认"路由判定"用法：错误提示文案里「请使用 /v1/permissions/rules」属正常指路，不算第二套路由。
 */
const RULE_WRITE_ROUTE_RE =
  /(?:===|startsWith\s*\()\s*['"]\/v1\/permissions\/rules['"]/g;

/** 去注释后的代码文本：④ 只判**代码**，不判注释里的路径说明（如「落盘 permissions/tool_rules.json」） */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ─── ⑤ 审批可执行性契约（2026-11-24）──────────────────────────────────────────
//
// 真机 `session_mwrf18pu00456e0f2b`：`for %f in (...) do @echo ...` 先被 ask 层判"可确认"
// 并提交审批卡（文案承诺「批准后可继续执行」），用户批准后重放却被硬拦截④（基命令白名单
// `for` 不在允许列表）否决 ⇒ 审批空转、用户以为"审批没生效"。
// 根因是 ask 层与硬拦截层对"可审批性"口径不一致。契约：**审批卡只在批准后真能执行时出现**。
// 判据（仅在对应文件存在时生效，便于单测夹具构造最小树）：
//   ⑤a bash 工具目录下出现 `requireApproval: true` 的文件必须在 ASK_SITE_PREFLIGHT 登记；
//   ⑤b `BashTool.ts` 必须引用 `checkApprovalWouldBeBlocked`（预检接线）；
//   ⑤c `bashSecurityGate.ts` 的 `checkApprovalWouldBeBlocked` 函数体必须调用
//       `checkWhitelistAndSandbox`（保证预检 = 批准后的真实硬拦截路径）。
const BASH_TOOLS_DIR = 'app/src/tools/bash/';
const BASH_TOOL_FILE = 'app/src/tools/bash/BashTool.ts';
const BASH_GATE_FILE = 'app/src/tools/bash/bashSecurityGate.ts';
/** 已登记的审批产生点 → 其终局预检的实现位置（新增产生点必须同批接入预检并登记） */
const ASK_SITE_PREFLIGHT: Record<string, string> = {
  [BASH_GATE_FILE]: 'BashTool.approvalPreflight',
  'app/src/tools/bash/powerShellWrapper.ts': 'BashTool.approvalPreflight',
};
const ASK_SITE_RE = /requireApproval\s*:\s*true/;
const PREFLIGHT_NAME = 'checkApprovalWouldBeBlocked';

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

  // ④ 工具规则「HTTP 写入口唯一」（R1，2026-11-17）
  if (rel.startsWith(TOOL_RULE_HTTP_PREFIX)) {
    const code = stripComments(text);
    if (
      rel !== TOOL_RULE_HTTP_ENTRY &&
      code.includes(RULE_STORE_PATH_LITERAL)
    ) {
      violations.push(
        `${rel}: HTTP 层不得出现「${RULE_STORE_PATH_LITERAL}」（规则库路径只属于 RuleManager；写入口唯一为 ${TOOL_RULE_HTTP_ENTRY}）`
      );
    }
    if (
      !TOOL_RULE_HTTP_ENTRY_FILES.has(rel) &&
      [...code.matchAll(RULE_WRITE_ROUTE_RE)].length > 0
    ) {
      violations.push(
        `${rel}: HTTP 层注册了工具规则写路径「/v1/permissions/rules」⇒ 唯一实现为 ${TOOL_RULE_HTTP_ENTRY}，路由只在 routes/config-skills-routes.ts 注册`
      );
    }
  }

  // ⑤ 审批可执行性契约（2026-11-24）：审批卡只在"批准后真能执行"时出现
  if (rel.startsWith(BASH_TOOLS_DIR)) {
    if (ASK_SITE_RE.test(text) && !ASK_SITE_PREFLIGHT[rel]) {
      violations.push(
        `${rel}: 出现 requireApproval 出口但未登记审批终局预检 —— 新的 ask 产生点必须在 ${BASH_TOOL_FILE} 里经 ${PREFLIGHT_NAME} 预检，并登记到 ASK_SITE_PREFLIGHT`
      );
    }
    if (rel === BASH_TOOL_FILE && !text.includes(PREFLIGHT_NAME)) {
      violations.push(
        `${rel}: 必须经 ${PREFLIGHT_NAME} 做审批终局预检（否则会重新出现"批准后仍被硬拦截"的空转审批卡）`
      );
    }
    if (rel === BASH_GATE_FILE) {
      const decl = `export function ${PREFLIGHT_NAME}`;
      const start = text.indexOf(decl);
      if (start < 0) {
        violations.push(
          `${rel}: 缺 ${PREFLIGHT_NAME}（审批终局预检的唯一实现）`
        );
      } else {
        // 函数签名里的参数类型对象也以 `\n}` 收尾 ⇒ 不能按首个 `\n}` 截断，
        // 取到下一个顶层 `export` 之前（函数体一定在其中）。
        const nextExport = text.indexOf('\nexport ', start + decl.length);
        const body = text.slice(
          start,
          nextExport > start ? nextExport : text.length
        );
        if (!body.includes('checkWhitelistAndSandbox(')) {
          violations.push(
            `${rel}: ${PREFLIGHT_NAME} 必须委托 checkWhitelistAndSandbox（预检与批准后的真实硬拦截路径同源）`
          );
        }
      }
    }
  }

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
  console.error(
    '   审批可执行性：bash 工具的每个 requireApproval 出口都必须登记并接 checkApprovalWouldBeBlocked 预检。'
  );
  process.exit(1);
}

console.log(
  `✅ [permission-single-source] 扫描 ${files.length} 个源文件：危险表 / 只读目录各仅一份、工具规则 HTTP 写入口唯一、审批产生点均接终局预检（豁免 ${Object.keys(ALLOWLIST).length} 处，均带理由）`
);
process.exit(0);

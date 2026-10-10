// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * **测试跳过登记门禁**（R8，第九轮审查 §4.3）—— skip 分级 + 未登记即失败。
 *
 * **为什么需要**：`(skip)` 是"**静默永不执行**"的测试 —— CI 仍绿，却无人知道覆盖**缺在哪**、
 * 为什么缺、谁负责、影响多大；外部报告指出「36 skip 原因与可复现」无人回答（本仓实测 **42**）。
 * 更隐蔽的是：其中 **12 条永久 `test.skip` 位于 `app/src/**`（而非 `app/tests/`）**
 * —— 只看 `tests/` 的治理会**整片漏掉**。
 *
 * 本门禁规则（三条）：
 * - **S1 登记制**：每一处 skip 位点必须在下方 `SKIP_REGISTRY` 登记
 *   （`reason` / `module` / `severity`）；**文件内站点数与登记数不符 ⇒ 失败**（新增即被发现）。
 * - **S2 安全不许静默**：`severity: 'security'` 的位点若为**无条件 skip**（`.skip(` 而非 `skipIf(`），
 *   必须显式 `acknowledged: true` + `ledger`（台账引用）—— 否则**失败**。
 *   依据：安全测试"永久不跑"等于**无该覆盖**，必须留痕可审计。
 * - **S3 自证**：断言本次确实扫到站点（`totalSites > 0`）—— 防"扫描路径写错 ⇒ 0 站点空转通过"
 *   （R5 门禁自证同款教训）。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const SCAN_ROOTS = [
  join(REPO_ROOT, 'app', 'tests'),
  join(REPO_ROOT, 'app', 'src'),
];
/** 本文件自身含 skip 正则字面量 ⇒ 排除，避免自我命中（相对仓库根，正斜杠） */
const SELF = 'app/tests/gates/skipRegistry.test.ts';
const SKIP_RE = /\b(it|describe|test)\s*\.\s*skip(If)?\s*\(/g;

/**
 * 跳过分类：
 * - `security`：安全关键（执行安全 / 权限边界 / 沙箱）—— 受 S2 + **S4/S5** 约束；
 * - `data-integrity`：数据完整性；`recovery`：恢复正确性 —— 同受 **S4/S5** 约束（P2-2）；
 * - `env` / `platform` / `perf` / `pending`：环境 / 平台 / 性能 / 待办。
 */
type SkipSeverity =
  | 'security'
  | 'data-integrity'
  | 'recovery'
  | 'env'
  | 'platform'
  | 'perf'
  | 'pending';

/** P2-2：受"必须显式风险元数据"约束的高风险类别 */
const HIGH_RISK_SEVERITIES: readonly SkipSeverity[] = [
  'security',
  'data-integrity',
  'recovery',
];

interface SkipEntry {
  /** 相对仓库根的路径（正斜杠） */
  file: string;
  /** 该位点必须存在的**内容判据**（防"登记与实际漂移"） */
  match: string;
  /** 为什么跳过（人可读） */
  reason: string;
  /** 责任模块 */
  module: string;
  severity: SkipSeverity;
  /** 无条件 skip 的安全用例必须显式承认并留台账引用（S2） */
  acknowledged?: boolean;
  ledger?: string;
  // ── P2-2：风险元数据（**高风险类别必须显式提供**，见 S4/S5）──────────────────
  /** 影响的平台 / 安全边界（如"Linux 以外无强隔离后端"） */
  platformImpact?: string;
  /** **是否影响发布**（禁止缺省 ⇒ 高风险类别必须显式声明） */
  releaseBlocking?: boolean;
  /** 若 `releaseBlocking === false` ⇒ **必须**说明为何可非阻断（防"默认当成非阻断"） */
  blockingJustification?: string;
  /** 重开条件（何时应重新启用该覆盖） */
  reopenWhen?: string;
  /** 责任人 / 责任角色 */
  owner?: string;
}

/**
 * 跳过登记表（R8 建档，2026-10-09）。**新增 skip 必须同步登记**，否则本门禁失败。
 */
const SKIP_REGISTRY: SkipEntry[] = [
  // ── app/tests/** ──────────────────────────────────────────────
  {
    file: 'app/tests/cost/dedup.test.ts',
    match: '修复后：主响应 totalCostUSD',
    reason: '成本去重修复的**验收占位**（修复未落地前不得启用）',
    module: 'cost',
    severity: 'pending',
  },
  {
    file: 'app/tests/mcp/realServerE2E.test.ts',
    match: 'MCP_E2E',
    reason: '需真实 MCP server（环境开关 `MCP_E2E=1`）',
    module: 'mcp',
    severity: 'env',
  },
  {
    file: 'app/tests/evals/pathShieldSandboxE2E.test.ts',
    match: 'ENABLED',
    reason: 'A7 防泄题真实沙箱 e2e —— 需真实 daemon（环境开关）',
    module: 'evals',
    severity: 'security',
    platformImpact: '全平台（需真实 daemon；`PERMISSION_SHIELD_E2E=1` 才跑）',
    releaseBlocking: false,
    blockingJustification:
      '同一覆盖由**离线**负向用例承担（`sandbox/negativeEnforcement` 已在 CI 强制跑，见 P1-6）；本组是真实 daemon 的**加强**验证，缺跑不改变安全姿态',
    reopenWhen: 'CI 具备真实 daemon 环境时；或出现防泄题真实事故时',
    owner: 'evals / sandbox 模块',
  },
  {
    file: 'app/tests/evals/pathShieldSandboxE2E.test.ts',
    match: 'ENABLED',
    reason: 'A7 防泄题**因果对照**组 —— 需真实 daemon（环境开关）',
    module: 'evals',
    severity: 'security',
    platformImpact: '全平台（需真实 daemon）',
    releaseBlocking: false,
    blockingJustification:
      '对照组（防"恒拒假绿"）随主组同环境开关；主组不跑时对照组亦无意义',
    reopenWhen: '同主组（具备真实 daemon 环境时）',
    owner: 'evals / sandbox 模块',
  },
  {
    file: 'app/tests/performance/benchmark.test.ts',
    match: "describe.skip('OAuth 认证'",
    reason: 'OAuthAuth 已重构迁移（2026-08），该组基准已失效',
    module: 'performance',
    severity: 'perf',
  },
  {
    file: 'app/tests/security/workspace-trust-integration.test.ts',
    match: '在 cwd 内时返回 true',
    reason:
      '相对路径分支（`src/file.ts` vs 绝对 cwd）未修复 ⇒ 永久跳过（同域绝对路径分支仍有覆盖）',
    module: 'security',
    severity: 'security',
    acknowledged: true,
    ledger: 'dev_docs/error_repairs/预存错误与待处理问题.md §L-8',
    platformImpact: '全平台（"相对路径 vs 绝对 cwd"子分支）',
    releaseBlocking: false,
    blockingJustification:
      '同域**绝对路径**分支仍有覆盖；本组仅相对路径子分支（台账 L-8 已登记）',
    reopenWhen: '修复"相对路径 vs 绝对 cwd"分支后',
    owner: 'security 模块',
  },
  {
    file: 'app/tests/sandbox/negativeEnforcement.test.ts',
    match: 'SKIP_REASON',
    reason:
      '非 Linux 或本机无 landlock helper（条件 skip，原因写入用例组标题）',
    module: 'sandbox',
    severity: 'security',
    platformImpact:
      '**仅 Linux** 可跑真实内核负向（Landlock 5.13+ + helper）；Windows/macOS 无强隔离后端',
    releaseBlocking: false,
    blockingJustification:
      'CI `sandbox-negative` job（ubuntu-latest）**强制**运行该组（P1-6，`SANDBOX_NEGATIVE_REQUIRE=1` ⇒ 环境不满足即失败）；本机跳过不改变 CI 覆盖',
    reopenWhen: '跨平台强隔离后端落地后重新评估（见 P2-4 安全边界）',
    owner: 'sandbox 模块',
  },
  {
    file: 'app/tests/vfs/symlinkEscape.test.ts',
    match: '!linkOk',
    reason: '平台 symlink 能力不足（收集期探测后条件 skip）',
    module: 'vfs',
    severity: 'platform',
  },
  {
    file: 'app/tests/session/deleteSessionTrashRetry.test.ts',
    match: 'process.platform !== ',
    reason: '仅 Windows 具备"持句柄重命名"语义',
    module: 'session',
    severity: 'platform',
  },
  ...Array.from({ length: 5 }, (_, i) => ({
    file: 'app/tests/tools/repl.integration.test.ts',
    match: '!pythonAvailable',
    reason: `REPL 集成（第 ${i + 1} 处）—— 需本地 python`,
    module: 'tools',
    severity: 'env' as SkipSeverity,
  })),

  // ── app/src/**（不在 tests/ 下，易被治理漏掉）──────────────────
  ...Array.from({ length: 10 }, (_, i) => ({
    file: 'app/src/query/__tests__/CompactionIntegration.test.ts',
    match: 'test.skip(',
    reason: `压缩集成（第 ${i + 1} 处）—— 永久 skip：待改为可注入驱动后启用`,
    module: 'query',
    severity: 'pending' as SkipSeverity,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    file: 'app/src/query/LoopDetector.test.ts',
    match: 'test.skip(',
    reason: `循环检测（第 ${i + 1} 处）—— 永久 skip：待补驱动`,
    module: 'query',
    severity: 'pending' as SkipSeverity,
  })),
];

/** 递归收集 `.test.ts`（排除本文件） */
function collectTestFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collectTestFiles(full, out);
    else if (name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

interface Site {
  file: string;
  line: number;
  /** 无条件 skip（`.skip(`） */
  unconditional: boolean;
}

/** 扫描全部 skip 位点 */
function scanSites(): Site[] {
  const sites: Site[] = [];
  for (const root of SCAN_ROOTS) {
    for (const full of collectTestFiles(root)) {
      const rel = relative(REPO_ROOT, full).replace(/\\/g, '/');
      if (rel === SELF) continue;
      const lines = readFileSync(full, 'utf-8').split(/\r?\n/);
      lines.forEach((text, i) => {
        SKIP_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = SKIP_RE.exec(text)) !== null) {
          sites.push({
            file: rel,
            line: i + 1,
            unconditional: m[2] !== 'If',
          });
        }
      });
    }
  }
  return sites;
}

const SITES = scanSites();

/** 比较"实际站点"与"登记表"（抽为纯函数 ⇒ 可用合成样例自证其有效性） */
function compareSites(
  sites: Site[],
  registry: SkipEntry[]
): {
  unregistered: string[];
  drifted: string[];
  securityViolations: string[];
  riskViolations: string[];
} {
  const byFile = new Map<string, Site[]>();
  for (const s of sites) {
    if (!byFile.has(s.file)) byFile.set(s.file, []);
    byFile.get(s.file)!.push(s);
  }

  const unregistered: string[] = [];
  const drifted: string[] = [];
  const registryFiles = new Set(registry.map((e) => e.file));

  for (const [file, fileSites] of byFile) {
    const entries = registry.filter((e) => e.file === file);
    if (entries.length !== fileSites.length) {
      unregistered.push(
        `${file}: 站点 ${fileSites.length} 处（行 ${fileSites
          .map((s) => s.line)
          .join(',')}）vs 登记 ${entries.length} 条`
      );
    }
  }
  for (const file of registryFiles) {
    if (!byFile.has(file))
      drifted.push(`${file}: 已登记但文件中已无 skip 位点`);
  }
  for (const e of registry) {
    const full = join(REPO_ROOT, e.file);
    if (!existsSync(full)) {
      drifted.push(`${e.file}: 文件不存在`);
      continue;
    }
    if (!readFileSync(full, 'utf-8').includes(e.match)) {
      drifted.push(`${e.file}: 判据 "${e.match}" 已不存在（登记漂移）`);
    }
  }

  const securityViolations: string[] = [];
  for (const site of sites) {
    if (!site.unconditional) continue;
    for (const e of registry.filter((x) => x.file === site.file)) {
      if (e.severity === 'security' && !e.acknowledged) {
        securityViolations.push(
          `${site.file}:${site.line} 安全用例被无条件跳过且未登记承认`
        );
      }
      if (e.acknowledged && !e.ledger) {
        securityViolations.push(
          `${site.file}:${site.line} 已承认但缺 ledger 引用`
        );
      }
    }
  }

  // ── P2-2（S4/S5）：高风险类别（执行安全 / 数据完整性 / 恢复正确性）**必须显式风险元数据** ──
  //
  // 反模式：把安全类 skip 与普通 skip **等价视作非阻断**（缺元数据 ⇒ 无人知道影响与重开条件）。
  const riskViolations: string[] = [];
  for (const e of registry) {
    if (!HIGH_RISK_SEVERITIES.includes(e.severity)) continue;
    const where = `${e.file}（${e.severity}）`;
    if (!e.platformImpact?.trim()) {
      riskViolations.push(`${where}: 缺 platformImpact（影响的平台/安全边界）`);
    }
    if (!e.owner?.trim()) {
      riskViolations.push(`${where}: 缺 owner（责任人/责任角色）`);
    }
    if (!e.reopenWhen?.trim()) {
      riskViolations.push(`${where}: 缺 reopenWhen（重开条件）`);
    }
    if (typeof e.releaseBlocking !== 'boolean') {
      riskViolations.push(
        `${where}: **必须显式声明 releaseBlocking**（严禁缺省 ⇒ 不得默认当作非阻断）`
      );
    } else if (
      e.releaseBlocking === false &&
      !e.blockingJustification?.trim()
    ) {
      riskViolations.push(
        `${where}: releaseBlocking=false 但缺 blockingJustification（为何可非阻断）`
      );
    }
  }

  return { unregistered, drifted, securityViolations, riskViolations };
}

describe('R8-S0 门禁自证：合成违规样例必须被判失败（防比较逻辑空转）', () => {
  it('多出一处未登记站点 ⇒ unregistered 非空', () => {
    const synthetic: Site[] = [
      { file: 'app/tests/x.test.ts', line: 1, unconditional: true },
    ];
    const r = compareSites(synthetic, []);
    expect(r.unregistered.length).toBe(1);
  });

  it('安全用例无条件跳过且未承认 ⇒ securityViolations 非空', () => {
    const synthetic: Site[] = [
      { file: 'app/tests/sec.test.ts', line: 9, unconditional: true },
    ];
    const registry: SkipEntry[] = [
      {
        file: 'app/tests/sec.test.ts',
        match: '',
        reason: 'r',
        module: 'm',
        severity: 'security',
      },
    ];
    // 判据为空串时必然"存在"（includes('') === true）⇒ 只验证 S2 分支
    expect(compareSites(synthetic, registry).securityViolations.length).toBe(1);
  });

  it('安全用例**条件**跳过 ⇒ 不违规（避免过度收紧）', () => {
    const synthetic: Site[] = [
      { file: 'app/tests/sec2.test.ts', line: 9, unconditional: false },
    ];
    const registry: SkipEntry[] = [
      {
        file: 'app/tests/sec2.test.ts',
        match: '',
        reason: 'r',
        module: 'm',
        severity: 'security',
      },
    ];
    expect(compareSites(synthetic, registry).securityViolations).toEqual([]);
  });
});

describe('R8-S3 自证：扫描确实发现站点（防"路径写错 ⇒ 空转通过"）', () => {
  it('扫到 skip 位点（>0）且覆盖 tests/ 与 src/ 两侧', () => {
    expect(SITES.length).toBeGreaterThan(0);
    const files = new Set(SITES.map((s) => s.file));
    expect([...files].some((f) => f.startsWith('app/tests/'))).toBe(true);
    expect([...files].some((f) => f.startsWith('app/src/'))).toBe(true);
  });
});

describe('R8-S1 登记制：每处 skip 必须登记（文件内站点数 = 登记数）', () => {
  it('无未登记站点；且登记项的内容判据在文件中真实存在', () => {
    const { unregistered, drifted } = compareSites(SITES, SKIP_REGISTRY);
    expect(unregistered).toEqual([]);
    expect(drifted).toEqual([]);
  });
});

describe('R8-S2 安全不许静默：无条件 skip 的安全用例须显式承认 + 留台账', () => {
  it('security 位点若为无条件 skip ⇒ 必须 acknowledged 且带 ledger 引用', () => {
    const { securityViolations } = compareSites(SITES, SKIP_REGISTRY);
    expect(securityViolations).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// P2-2（S4/S5）：风险元数据分级 —— 高风险类 skip **不得**与普通 skip 等价视作非阻断
// ─────────────────────────────────────────────────────────────

describe('P2-2-S4/S5 高风险类 skip 必须显式风险元数据', () => {
  it('真实登记表：执行安全/数据完整性/恢复正确性 类均有 platformImpact/owner/reopenWhen/releaseBlocking（false 时附理由）', () => {
    const { riskViolations } = compareSites(SITES, SKIP_REGISTRY);
    expect(riskViolations).toEqual([]);
  });

  it('门禁自证：**缺 releaseBlocking** ⇒ 报错（严禁缺省 ⇒ 不得默认当作非阻断）', () => {
    const reg: SkipEntry[] = [
      {
        file: 'app/tests/x.test.ts',
        match: '',
        reason: 'r',
        module: 'm',
        severity: 'security',
        platformImpact: 'p',
        owner: 'o',
        reopenWhen: 'w',
      },
    ];
    const v = compareSites([], reg).riskViolations;
    expect(v.some((s) => s.includes('必须显式声明 releaseBlocking'))).toBe(
      true
    );
  });

  it('门禁自证：`releaseBlocking=false` 但无理由 ⇒ 报错', () => {
    const reg: SkipEntry[] = [
      {
        file: 'app/tests/x.test.ts',
        match: '',
        reason: 'r',
        module: 'm',
        severity: 'recovery',
        platformImpact: 'p',
        owner: 'o',
        reopenWhen: 'w',
        releaseBlocking: false,
      },
    ];
    const v = compareSites([], reg).riskViolations;
    expect(v.some((s) => s.includes('blockingJustification'))).toBe(true);
  });

  it('门禁自证：元数据齐全 ⇒ 无违规（防"恒报"假绿）', () => {
    const reg: SkipEntry[] = [
      {
        file: 'app/tests/x.test.ts',
        match: '',
        reason: 'r',
        module: 'm',
        severity: 'data-integrity',
        platformImpact: 'p',
        owner: 'o',
        reopenWhen: 'w',
        releaseBlocking: true,
      },
    ];
    expect(compareSites([], reg).riskViolations).toEqual([]);
  });
});

describe('P2-2 跳过风险摘要（CI 分列：阻断性 / 非阻断，不合成单一分数）', () => {
  it('按 `releaseBlocking` 分列输出并可断言', () => {
    const high = SKIP_REGISTRY.filter((e) =>
      HIGH_RISK_SEVERITIES.includes(e.severity)
    );
    const blocking = high.filter((e) => e.releaseBlocking === true);
    const nonBlocking = high.filter((e) => e.releaseBlocking === false);

    // CI 摘要（分列，不合成单一分数 —— 对齐 R14 口径）
    console.log('=== Skip 风险摘要（P2-2）===');
    console.log(
      `高风险类 skip ${high.length} 项 · 阻断性 ${blocking.length} · 非阻断 ${nonBlocking.length}` +
        `（其余 ${SKIP_REGISTRY.length - high.length} 项为 env/platform/perf/pending，不参与发布门禁判定）`
    );
    if (blocking.length > 0) {
      console.log(
        `  阻断性: ${blocking.map((e) => `${e.file} [${e.severity}]`).join(' | ')}`
      );
    }
    if (nonBlocking.length > 0) {
      console.log(
        `  非阻断: ${nonBlocking.map((e) => `${e.file} [${e.severity}]`).join(' | ')}`
      );
    }

    expect(blocking.length + nonBlocking.length).toBe(high.length);
    expect(high.length).toBeGreaterThan(0);
  });
});

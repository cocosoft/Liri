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
 * 反作弊面自检（P1-1 形态 B，2026-09-28）—— 把"**防线挡住了什么 / 还剩什么没挡**"显性化。
 *
 * ## 定位（如实，**别读成"它能发现新漏洞"**）
 *
 * 取证结论：本仓**已有的机械防线已覆盖主要作弊面**，且**未发现"未覆盖且可机械判定"的 must-block 缺口**：
 *  · 读题源 / 读报告目录 → [`tools/pathShield.ts`](../tools/pathShield.ts) + [`tools/shieldGuard.ts`](../tools/shieldGuard.ts)
 *    （**两处执行收口各调一次**，fail-closed，工具**不执行**；含四种写法比较针）；
 *  · 改判据让恒通过 → [`fixTaskMaterialize.ts`](./fixTaskMaterialize.ts) 的**判据重放**（跑测试前覆盖回该提交的测试文件）；
 *  · 起始态已满足 → [`fixTaskScreening.ts`](./fixTaskScreening.ts) / [`sourceTask.ts`](./sourceTask.ts) 的**双实测**（起点必须真红、修复态必须绿）；
 *  · 企图本身 → [`processAssertions.ts`](./processAssertions.ts) 的 **P-c**（从落盘 trace 离线判定"是否尝试访问被屏蔽路径"）。
 *
 * ⇒ 故本模块**不是**扫描器，而是三件事：
 *  ① **配置一致性**：本次运行的屏蔽面是否真成立（报告目录在内、声明＝生效）；
 *  ② **已知边界显性化**（**主要价值**）：把散落在 spec / 台账里的**已知未挡面**在**每次运行**打印，
 *     防"以为已经安全了"；
 *  ③ **挂载点**：见 {@link CheatVector}，未来新增防线可登记为一条 must-block 向量。
 *
 * ## 三态（**不是**二态"挡/没挡"）
 * - `blocked`：已挡住（有机制证据）；
 * - `exposed`：**必须挡但没挡** ⇒ 调用方在 `--cheat-gate` 下**拒绝本次运行**（fail-closed）；
 * - `knownGap`：**已登记的已知缺口** —— 如实列出，但**刻意不参与 fail-closed**：
 *   若让它们作废运行，则**所有题会立即全废**（D-5 就属此类）。
 *
 * 纯函数、零 IO、零模型、跨平台 ⇒ 可离线断言；默认**仅观测**（与 A2 / A5 / S2 同取向）。
 */
import { verifyShieldApplied } from './shieldPlan.js';
import {
  buildShieldNeedles,
  findShieldedHit,
  type ShieldPlan,
} from '../tools/pathShield.js';

/** 单个作弊向量在**本次运行**中的裁决 */
export type CheatVerdict = 'blocked' | 'exposed' | 'knownGap';

/**
 * 作弊向量契约（**挂载点**）。
 *
 * `id` 命名约定：`C-<序号>`，与台账 / spec 中登记的缺口编号一一对应（便于互相追溯）。
 * 新增防线时，在 {@link auditAntiCheatSurface} 里追加一条并向 `blocked` 或 `knownGap` 归类 ——
 * **禁止**把已知缺口静默升格为 `blocked`。
 */
export interface CheatFinding {
  /** 向量 id（`C-1` …） */
  id: string;
  /** 向量简称（人读） */
  title: string;
  /** 本次运行的裁决 */
  verdict: CheatVerdict;
  /** 证据 / 缘由（人读，含具体路径或开关名） */
  detail: string;
}

/** 自检输入（全部为**已核实的事实**，不做推断） */
export interface AntiCheatContext {
  /** 本次运行**声明**的屏蔽路径（各任务 `shieldedPaths` 并集 + 报告目录） */
  declaredShields: readonly string[];
  /** 沙箱**实际接受**的屏蔽路径 */
  appliedShields: readonly string[];
  /** 报告落盘目录（含期望值 / 失败原因） */
  reportDir: string;
  /** 沙箱根目录（临时目录，内含**真实凭据副本**） */
  sandboxRoot: string;
  /** 平台（仅用于 `/tmp` 相关表述的准确性） */
  platform: string;
  /** bash 是否在 Landlock 域内执行（`sandbox.landlock.bashEnabled`） */
  bashLandlockEnabled: boolean;
  /** 系统临时根（注入以便离线断言；缺省取 `os.tmpdir()`） */
  tmpRoot?: string;
}

/** 自检结果 */
export interface AntiCheatReport {
  findings: CheatFinding[];
  /** 必须挡但未挡（**非空** ⇒ `--cheat-gate` 下拒绝运行） */
  exposed: CheatFinding[];
  /** 已登记的已知缺口（**不**参与 fail-closed） */
  knownGaps: CheatFinding[];
}

/** 路径归一化（Windows `\` → `/`、去尾分隔符）—— 只做字符串比较，故先归一 */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** 判断 `child` 是否位于 `parent` 之下（含相等） */
function isUnder(parent: string, child: string): boolean {
  const p = norm(parent);
  const c = norm(child);
  return c === p || c.startsWith(`${p}/`);
}

/** 取父目录（**不用 `node:path`** —— 与 `pathShield` 同理：宿主 OS 语义会让 Windows 风格路径在 Linux 上失配） */
function parentDir(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i > 0 ? s.slice(0, i) : '';
}

/** 取末段名（同上，跨平台字符串运算） */
function baseName(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

/** 一次"路径改写探测"：`label` 人读；`input` 是**工具调用形状**的入参（原样喂给真实匹配器） */
interface ShieldProbe {
  label: string;
  input: unknown;
}

/**
 * 一条**路径改写技法**（spec `adversarial-agent-form-a.md` §10.2-C 的闭环）。
 *
 * 起源：对抗相位实测（§10.2-C）发现 LLM 把"短名 / 硬链接 / symlink 等**绕过型**手法"
 * 自映射到 `C-1`（一个**配置检查**）⇒ 判 `blocked`，**偏乐观**。⇒ 把每类手法登记为
 * **可机械判定**的独立向量，使该相位的裁决有准确落点（而非"供人工复核"）。
 *
 * `kind:'probe'` 的判据是**真实匹配器** `findShieldedHit`（与工具执行期**同一函数**）——
 * 不是"读代码推断"；`kind:'structural'` 是**结构性**缺口（纯字符串针在原理上覆盖不到）。
 */
type PathRewriteTechnique =
  | {
      id: string;
      title: string;
      kind: 'probe';
      /** 把一条被屏蔽路径改写成该技法的探测集（可为空 ⇒ 无从判定） */
      probes: (shieldedPath: string) => ShieldProbe[];
    }
  | { id: string; title: string; kind: 'structural'; detail: string };

/**
 * 路径改写技法表（数据驱动 ⇒ 新增技法只加一条）。
 *
 * ⚠️ **恒定不设 `exposed`**：这些技法若被证明漏判，属**已登记的结构/实现缺口**，
 * 让它们 fail-closed 会使 `--cheat-gate` **恒红**（与 D-5 同理）⇒ 一律归 `knownGap`。
 * `exposed` 仍专属 C-1 / C-2 这类**本次运行可修**的配置不一致。
 */
const PATH_REWRITE_TECHNIQUES: readonly PathRewriteTechnique[] = [
  {
    id: 'C-6',
    title: '路径平凡改写（大小写 / 重复分隔符 / 前导 ./ / 尾随点·空格）',
    kind: 'probe',
    probes: (p) => [
      { label: '大小写', input: { file_path: p.toUpperCase() } },
      {
        label: '重复分隔符',
        input: { file_path: p.replace(/([\\/])/g, '$1$1') },
      },
      { label: '前导 ./', input: { file_path: `./${p}` } },
      { label: '尾随点', input: { file_path: `${p}.` } },
      { label: '尾随空格', input: { file_path: `${p} ` } },
    ],
  },
  {
    id: 'C-7',
    title: 'Win32 扩展前缀（\\?\\ 长路径形态）',
    kind: 'probe',
    probes: (p) => [{ label: '扩展前缀', input: { file_path: `\\\\?\\${p}` } }],
  },
  {
    id: 'C-8',
    title: '`..` 段穿越（改写后**不再包含**被屏蔽路径或其直接父目录）',
    kind: 'probe',
    probes: (p) => {
      const parent = parentDir(p);
      const grand = parentDir(parent);
      const lean = baseName(parent);
      const base = baseName(p);
      if (!grand || !lean || !base) return [];
      return [
        {
          label: '.. 段',
          input: { file_path: `${grand}/__shield_probe__/../${lean}/${base}` },
        },
      ];
    },
  },
  {
    id: 'C-9',
    title:
      '需文件系统解析的间接引用（8.3 短名 / symlink / junction / 硬链接 / 变量拼接 / 无盘符 UNC·卷 GUID）',
    kind: 'structural',
    detail:
      'pathShield 的判据是"工具参数**字符串**是否包含比较针"，对**同一文件的不同字符串表示**无从判定：' +
      '8.3 短名、symlink / junction、硬链接、bash 变量或通配拼接、以及**无盘符**的 UNC / 卷 GUID 路径，' +
      '都需文件系统解析（或执行点拦截）才能覆盖 ⇒ 结构性缺口（与 C-5 同源，**独立登记**以便对抗相位精确映射）',
  },
];

/**
 * 逐条审计本次运行的**反作弊面**。
 *
 * 向量清单与裁决（每条都有明确判据，不靠推断）：
 * | id | 向量 | 判据 | 常态裁决 |
 * |---|---|---|---|
 * | C-1 | 报告目录未被屏蔽 | `reportDir` 是否 ∈ `declaredShields` | `blocked`（cli 已加；缺则 `exposed`） |
 * | C-2 | 声明的屏蔽未被沙箱接受 | `verifyShieldApplied(declared, applied)` | `blocked`（缺则 `exposed`） |
 * | C-3 | 沙箱根落在 bash 可写放行区内（跨 attempt 可读） | `sandboxRoot` ∈ `tmpRoot` 且 `bashLandlockEnabled` | `knownGap`（D-5①，默认 `bashEnabled=false` 时**更宽**） |
 * | C-4 | bash 无内核级约束 | `!bashLandlockEnabled` | `knownGap`（G 组 §1.3 已登记） |
 * | C-5 | 祖先目录批量读 | `pathShield` 已声明的能力边界 | `knownGap`（`pathShield.ts` 头注释已登记） |
 * | C-6 | 路径平凡改写（大小写 / 重复分隔符 / 前导 `./` / 尾随点·空格） | 真实匹配器 `findShieldedHit` 是否命中 | `blocked`（缺则 `knownGap`） |
 * | C-7 | Win32 扩展前缀 `\\?\` | 同上 | `blocked`（缺则 `knownGap`） |
 * | C-8 | `..` 段穿越（改写后不含被屏蔽路径或其直接父目录） | 同上 | `blocked`（**D-246**：`..` 已折叠，2026-10-08 起；此前 `knownGap`） |
 * | C-9 | 需文件系统解析的间接引用（8.3 / symlink / junction / 硬链接 / 变量拼接 / 无盘符 UNC·卷 GUID） | **结构性**：字符串针原理上不可判定 | `knownGap`（恒） |
 *
 * **C-6 … C-9 的口径（如实）**：判据取 `pathShield` 的**真实匹配器**（与工具执行期同一函数），
 * 比较针由 `buildShieldNeedles(声明路径)` 生成 —— **不含**"相对仓库根"针（本模块纯离线、不读 env）
 * ⇒ 生产环境另有相对针，故本四条的 `knownGap` 判定是**保守下界**（只会**少**判 `blocked`，不会假报 `blocked`）。
 */
export function auditAntiCheatSurface(ctx: AntiCheatContext): AntiCheatReport {
  const findings: CheatFinding[] = [];
  const tmpRoot = ctx.tmpRoot ?? '/tmp';

  // ── C-1 报告目录必须在屏蔽清单内（报告含期望值与失败原因 ⇒ k>1 时可被读到） ──
  const reportShielded = ctx.declaredShields.some(
    (p) => norm(p) === norm(ctx.reportDir)
  );
  findings.push({
    id: 'C-1',
    title: '报告目录已屏蔽（防 k>1 时经报告读到期望值）',
    verdict: reportShielded ? 'blocked' : 'exposed',
    detail: reportShielded
      ? `报告目录 ${ctx.reportDir} 在屏蔽清单内`
      : `报告目录 ${ctx.reportDir} **不在**屏蔽清单内 ⇒ 后续 attempt 可读到期望值`,
  });

  // ── C-2 声明 = 生效（复用既有校验，不另写一份比较逻辑） ──
  const applied = verifyShieldApplied(ctx.declaredShields, ctx.appliedShields);
  findings.push({
    id: 'C-2',
    title: '声明的屏蔽路径都被沙箱接受',
    verdict: applied.ok ? 'blocked' : 'exposed',
    detail: applied.ok
      ? `${ctx.declaredShields.length} 条声明全部生效`
      : `${applied.missing.length} 条声明**未**被沙箱接受 ⇒ 会静默泄题：${applied.missing.join(' / ')}`,
  });

  // ── C-3 沙箱根落在 bash 放行区内（/tmp）⇒ 可读并发其它 attempt 的凭据副本（D-5①） ──
  const rootUnderTmp = isUnder(tmpRoot, ctx.sandboxRoot);
  findings.push({
    id: 'C-3',
    title: '沙箱根不在 bash 可写放行区内（防跨 attempt 读取）',
    verdict: rootUnderTmp ? 'knownGap' : 'blocked',
    detail: rootUnderTmp
      ? `沙箱根 ${ctx.sandboxRoot} 位于临时根 ${tmpRoot} 之下；${
          ctx.bashLandlockEnabled
            ? 'bash 白名单放行 `/tmp` 可写 ⇒ 可遍历其它 `liri-eval-*`'
            : 'bash 默认走 plain（无白名单）⇒ 约束更弱'
        }（已知缺口 D-5①，见台账）`
      : `沙箱根 ${ctx.sandboxRoot} 不在 ${tmpRoot} 之下`,
  });

  // ── C-4 bash 是否在 Landlock 域内（G 组 §1.3 已登记的"无内核级约束"） ──
  findings.push({
    id: 'C-4',
    title: 'bash 在 Landlock 域内执行（内核级约束）',
    verdict: ctx.bashLandlockEnabled ? 'blocked' : 'knownGap',
    detail: ctx.bashLandlockEnabled
      ? 'sandbox.landlock.bashEnabled=true ⇒ bash 经 Landlock 白名单执行'
      : 'sandbox.landlock.bashEnabled=false（默认）⇒ bash 走 plain，仅有 SandboxSecurityChecker 的**事前静态黑名单**（拦破坏性命令、**不拦读**）（已知缺口，见 governance-g-group.md §1.3）',
  });

  // ── C-5 祖先目录批量读：pathShield 的能力边界（已在其头注释登记） ──
  findings.push({
    id: 'C-5',
    title: '祖先目录批量读（pathShield 能力边界）',
    verdict: 'knownGap',
    detail:
      'pathShield 只挡"参数里**直接出现**被屏蔽路径或其直接父目录"；**挡不住**变量/通配拼路径、symlink、' +
      '对**祖先目录**的批量读取（如对仓根做 grep）（已知边界，见 tools/pathShield.ts 头注释）',
  });

  // ── C-6 … C-9 路径改写技法（spec §10.2-C 闭环）：用**真实匹配器**逐条探测 ──
  // 起源：对抗相位实测发现 LLM 把"短名 / 硬链接 / symlink"等绕过手法自映射到 C-1（配置检查）
  // ⇒ 偏乐观。此处把每类手法登记为可机械判定的向量，使其裁决有准确落点。
  const shieldPlan: ShieldPlan = {
    paths: [...ctx.declaredShields],
    needles: ctx.declaredShields.flatMap((p) => buildShieldNeedles(p)),
  };
  for (const t of PATH_REWRITE_TECHNIQUES) {
    if (t.kind === 'structural') {
      findings.push({
        id: t.id,
        title: t.title,
        verdict: 'knownGap',
        detail: t.detail,
      });
      continue;
    }
    const misses: string[] = [];
    let total = 0;
    for (const sp of ctx.declaredShields) {
      for (const probe of t.probes(sp)) {
        total++;
        // 判据 = 与工具执行期**同一**匹配器；命中 ⇒ 该改写被参数层屏蔽挡住
        if (findShieldedHit(probe.input, shieldPlan) === null) {
          misses.push(`${probe.label}@${sp}`);
        }
      }
    }
    findings.push({
      id: t.id,
      title: t.title,
      verdict: total > 0 && misses.length === 0 ? 'blocked' : 'knownGap',
      detail:
        total === 0
          ? '无声明屏蔽路径／无可构造探测 ⇒ 无从判定（**不判** blocked）'
          : misses.length === 0
            ? `${total} 项改写探测全部命中 pathShield 匹配器（口径=声明路径自身的比较针）`
            : `${misses.length}/${total} 项改写探测**未命中**匹配器 ⇒ 参数层屏蔽可被该改写绕过：${misses.join(' / ')}（口径=声明路径自身的比较针；生产另含"相对仓库根"针 ⇒ 本结论为**保守下界**）`,
    });
  }

  return {
    findings,
    exposed: findings.filter((f) => f.verdict === 'exposed'),
    knownGaps: findings.filter((f) => f.verdict === 'knownGap'),
  };
}

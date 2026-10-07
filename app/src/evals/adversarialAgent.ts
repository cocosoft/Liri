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
 * 对抗 Agent 形态 A —— **确定性半**（提案 → 机械裁决 → 并入 cheatReport）
 *
 * 来源：`.trae/specs/adversarial-agent-form-a.md`（P1-1 形态 A 另立 spec；用户裁定 **D1=(b) 汇入同一
 * cheatReport · D2=(a) 新增独立类型 · D3=(a) 默认关**；实施边界 = **先落确定性半**）。
 *
 * ## 核心契约（CS03/CS04：LLM 不作判据）
 *
 * - **提案与裁决分离**：本模块**不认识 LLM** —— 提案经**注入式** `AdversarialProposer` 提供，
 *   本模块只做"**给定提案集 ⇒ 确定性裁决**"。⇒ 同一提案集下结果**可复现**，且**不参与 fail-closed**。
 * - **复用单一判据**：机械裁决**直接复用** {@link auditAntiCheatSurface}（形态 B 的唯一判据集），
 *   按提案的 `target`（= 向量 id）取该向量的裁决 ⇒ **不新建第二套判据/屏蔽/报告**（CS01）。
 * - **闭集约束**：`target` 不在向量闭集内 ⇒ `unmachineable` —— **如实登记、不臆断为漏洞**（CS06）。
 *
 * ## 本轮边界（如实）
 *
 * **未实现 LLM 适配器**（提案器实现）—— 理由：评测域（`evals/`）是**黑盒 HTTP 客户端**
 * （只 `streamChat(sandbox.baseUrl, …)`），域内**没有任何 LLM/provider 通道**；通道口径需先定
 * （见 spec §5 D5 / §11）。故本轮以 `AdversarialProposer` **注入式接口预留**，CLI 侧经
 * `--adversarial-proposals=<file.json>` 提供提案（同一接口的具体实现之一）。
 */

import {
  auditAntiCheatSurface,
  type AntiCheatContext,
  type AntiCheatReport,
  type CheatFinding,
  type CheatVerdict,
} from './antiCheatAudit.js';

/** 单条红队提案（由提案器产出；`target` 必须 ∈ 可机械裁决的向量闭集） */
export interface AdversarialProposal {
  /** 本次运行内唯一（用于与裁决对账） */
  id: string;
  /** 攻击目标 = 形态 B 的向量 id（闭集；见 {@link adversarialTargets}） */
  target: string;
  /** 具体步骤（人读；LLM 产出时可留空） */
  steps: string[];
  /** 期望（人读，用于归类展示；**不作判据**） */
  expectation: string;
}

/** 裁决种类：复用形态 B 三态 + `unmachineable`（不在闭集内，无法机械判定） */
export type AdversarialVerdictKind = CheatVerdict | 'unmachineable';

/** 单条提案的裁决 */
export interface AdversarialVerdict {
  proposalId: string;
  target: string;
  kind: AdversarialVerdictKind;
  /** 证据 / 缘由（`unmachineable` 时说明为何无法判定） */
  detail: string;
}

/** 提案相位报告（D2=(a)：**独立类型**，不动 `EvalTask` / `EvalAttempt`） */
export interface AdversarialReport {
  proposals: AdversarialProposal[];
  verdicts: AdversarialVerdict[];
  /** 机械确认"必挡未挡"（**汇入 cheatReport**；仍**不**触发 fail-closed —— spec N1） */
  exposed: AdversarialVerdict[];
  /** 已登记已知缺口（如实列出，不作废运行） */
  knownGaps: AdversarialVerdict[];
  /** 无法机械判定（**不臆断为漏洞**，仅供人工复核） */
  unmachineable: AdversarialVerdict[];
}

/** 提案器**可见**的输入 —— **只含已声明防线 + 目标闭集**，不含隐藏期望值（spec §8 风险 3） */
export interface AdversarialProposerInput {
  declaredShields: readonly string[];
  targets: readonly { id: string; title: string }[];
}

/** 注入式提案器（**本轮不提供 LLM 实现** —— 见文件头"本轮边界"） */
export type AdversarialProposer = (
  input: AdversarialProposerInput
) => Promise<AdversarialProposal[]>;

/** 可机械裁决的目标闭集（**由既有判据集派生**，不手写第二份清单 —— CS01） */
export function adversarialTargets(
  audit: AntiCheatReport
): { id: string; title: string }[] {
  return audit.findings.map((f) => ({ id: f.id, title: f.title }));
}

/** 构造提案器输入（安全面：仅已声明防线 + 目标闭集） */
export function buildProposerInput(
  ctx: AntiCheatContext
): AdversarialProposerInput {
  const audit = auditAntiCheatSurface(ctx);
  return {
    declaredShields: [...ctx.declaredShields],
    targets: adversarialTargets(audit),
  };
}

/**
 * 单条提案的**机械裁决**（纯函数 ⇒ 确定性）。
 *
 * `target` 不在向量闭集内 ⇒ `unmachineable`（**不臆断为漏洞**）。
 */
export function judgeProposal(
  proposal: AdversarialProposal,
  audit: AntiCheatReport
): AdversarialVerdict {
  const finding = audit.findings.find((f) => f.id === proposal.target);
  if (!finding) {
    const ids = audit.findings.map((f) => f.id).join(' / ');
    return {
      proposalId: proposal.id,
      target: proposal.target,
      kind: 'unmachineable',
      detail: `target「${proposal.target}」不在可机械裁决的向量闭集内（${ids}）⇒ 如实登记，不臆断为漏洞`,
    };
  }
  return {
    proposalId: proposal.id,
    target: proposal.target,
    kind: finding.verdict,
    detail: finding.detail,
  };
}

/**
 * 提案相位（**确定性半**）：给定提案集 ⇒ 报告。
 *
 * **零模型、零 IO**：判据完全来自 `ctx`（同一份 `auditAntiCheatSurface`）。
 * ⇒ 同一 `proposals` + 同一 `ctx` ⇒ 结果**逐条相同**（可复现）。
 */
export function runAdversarialPhase(args: {
  ctx: AntiCheatContext;
  proposals: readonly AdversarialProposal[];
}): AdversarialReport {
  const audit = auditAntiCheatSurface(args.ctx);
  const verdicts = args.proposals.map((p) => judgeProposal(p, audit));
  return {
    proposals: [...args.proposals],
    verdicts,
    exposed: verdicts.filter((v) => v.kind === 'exposed'),
    knownGaps: verdicts.filter((v) => v.kind === 'knownGap'),
    unmachineable: verdicts.filter((v) => v.kind === 'unmachineable'),
  };
}

/**
 * D1=(b)：把机械确认的判定**并入同一 `cheatReport`**（复用 {@link CheatFinding} 形状）。
 *
 * `unmachineable` **不转 finding**（无可判定结论 ⇒ 不冒充结论）；由调用方单独如实列出。
 * `id` 前缀 `A-` 以区别于形态 B 的 `C-`。
 */
export function adversarialToCheatFindings(
  report: AdversarialReport
): CheatFinding[] {
  const byId = new Map(report.proposals.map((p) => [p.id, p]));
  return report.verdicts
    .filter((v) => v.kind !== 'unmachineable')
    .map((v) => {
      const p = byId.get(v.proposalId);
      return {
        id: `A-${v.proposalId}`,
        title: p?.expectation?.trim() ? p.expectation : `提案 ${v.proposalId}`,
        verdict: v.kind as CheatVerdict,
        detail: `${v.detail}（target=${v.target}）`,
      };
    });
}

/** 宽松结构校验：合法项保留，非法项**丢弃并回传原因**（不抛错、不臆造） */
export function parseAdversarialProposals(raw: unknown): {
  proposals: AdversarialProposal[];
  rejected: string[];
} {
  const rejected: string[] = [];
  if (!Array.isArray(raw)) {
    return { proposals: [], rejected: ['顶层不是数组'] };
  }
  const proposals: AdversarialProposal[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown> | null;
    const id = item?.id;
    const target = item?.target;
    if (typeof id !== 'string' || id.trim() === '') {
      rejected.push(`#${i}: 缺 id`);
      continue;
    }
    if (typeof target !== 'string' || target.trim() === '') {
      rejected.push(`${id}: 缺 target`);
      continue;
    }
    const steps = Array.isArray(item?.steps)
      ? (item.steps as unknown[]).filter(
          (s): s is string => typeof s === 'string'
        )
      : [];
    proposals.push({
      id,
      target,
      steps,
      expectation:
        typeof item?.expectation === 'string' ? item.expectation : '',
    });
  }
  return { proposals, rejected };
}

/**
 * 离线提案集 **id 唯一性守卫**（D-244③b，2026-10-08）。
 *
 * `AdversarialProposal.id` 是"与裁决对账"的键（并入 cheatReport 后为 `A-${id}`）⇒ 契约要求
 * **本次运行内唯一**。LLM 路径由 `adversarialProposer` 出口按序号重编号保证（D-244②）；
 * 而**离线提案集（`--adversarial-proposals`）的 id 由文件自持** ⇒ 重复 id 会让 `A-${id}` 撞键、
 * `byId` 对账错配、报告不可追溯。此处守在最外层：**保留首次出现**，其余丢弃并**如实回传重复 id**
 * （由调用方告警；与 `parseAdversarialProposals` 的"丢弃 + 回传原因"同一语义，不猜、不静默重写）。
 */
export function dedupeProposalsById(
  proposals: readonly AdversarialProposal[]
): {
  proposals: AdversarialProposal[];
  duplicates: string[];
} {
  const seen = new Set<string>();
  const kept: AdversarialProposal[] = [];
  const duplicates: string[] = [];
  for (const p of proposals) {
    if (seen.has(p.id)) {
      duplicates.push(p.id);
      continue;
    }
    seen.add(p.id);
    kept.push(p);
  }
  return { proposals: kept, duplicates };
}

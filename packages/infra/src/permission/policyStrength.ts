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
 * 授权强度模型（Policy strength）—— 纯函数实现（零 IO）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 **P33**。
 * 语义对齐参考实现 `docs/002-authorization.md` 与 `src/policy.ts:135-245`，
 * 但**只保留判定**：
 *  - 不读写配置、不落库、不读时钟 —— 事实由调用方解析后传入；
 *  - 不替代既有 `PermissionChecker`（动作拦截），二者正交。
 *
 * 三条不变量（改代码前先读）：
 * 1. **强度单调序**只用于"重校验不得降级"，不做业务排序；
 * 2. **显式请求在 `off` 模式下同样有效** —— `off` 只拦"推断"；
 * 3. **配置变更不撤销 Mandate、不取消在途工作**，只产 `PolicyEffect` 供上层投递通知。
 */

import type {
  AcceptanceDecision,
  AcceptMode,
  AdmissionCell,
  AdmissionDecision,
  AdmissionTable,
  GateFacts,
  GateResult,
  Mandate,
  PolicyEffect,
  PolicySnapshot,
  RevalidationFacts,
  RevalidationResult,
  Strength,
} from './types/PolicyStrength.js';

/**
 * 强度（含"不接纳"）的**数值序**。
 *
 * 只用于 `revalidateMandate` 的"今日不得低于原强度"判定。
 * 禁止用它做列表排序/优先级（语义不同，CS02）。
 */
export const STRENGTH_RANK: Readonly<Record<AdmissionDecision, number>> = {
  ignore: 0,
  inferred: 1,
  explicit: 2,
};

/**
 * 准入表缺省值（与参考实现 `docs/002:65-69` 一致）。
 *
 * - 白名单内、未指向代理 ⇒ `inferred`（默认允许成为推断候选）
 * - 白名单外、指向代理 ⇒ `ignore`（默认不接纳）
 * - 白名单外、未指向代理 ⇒ `ignore`
 */
export const ADMISSION_DEFAULTS: Readonly<
  Record<AdmissionCell, AdmissionDecision>
> = {
  listedUnaddressed: 'inferred',
  unlistedAddressed: 'ignore',
  unlistedUnaddressed: 'ignore',
};

/** 当前取值是否"推断"类（受 `AcceptMode` 约束） */
export function isInferred(strength: Strength): boolean {
  return strength === 'inferred';
}

/**
 * 解析命中的准入单元格。
 *
 * `allowed && addressed` 不需要单元格（直接走显式），返回 `undefined`。
 */
export function resolveAdmissionCell(
  allowed: boolean,
  addressed: boolean
): AdmissionCell | undefined {
  if (allowed) return addressed ? undefined : 'listedUnaddressed';
  return addressed ? 'unlistedAddressed' : 'unlistedUnaddressed';
}

/** 按"表 → 缺省"解析单元格取值（表缺该行/该格时回退缺省） */
export function resolveAdmission(
  table: AdmissionTable | undefined,
  scope: string | undefined,
  cell: AdmissionCell | undefined
): AdmissionDecision {
  if (!cell) return 'explicit';
  const fromTable = scope === undefined ? undefined : table?.[scope]?.[cell];
  return fromTable ?? ADMISSION_DEFAULTS[cell];
}

/**
 * 准入判定（Gate）—— 严格短路链，顺序**不可调整**。
 *
 * 顺序依据 `docs/002:48-54` / `src/policy.ts:191-210`：
 * ```
 * 非人类 → machineGate（只认 bot 白名单，且只能是 inferred）
 * allowed && addressed            → explicit
 * 单元格 explicit                 → explicit   （先于 followup：线程上的 Ticket 不得把显式请求降级）
 * followup（且非"陌生人的私聊"）  → allowed ? explicit : inferred
 * 单元格 inferred && mode !== off → inferred
 * 否则拒绝（reason 三选一）
 * ```
 */
export function evaluateGate(facts: GateFacts): GateResult {
  if (!facts.listened) {
    return { admitted: false, reason: 'source_not_listening' };
  }

  // 机器发送者：只有 bot 白名单可产生 inferred；其余一律拒绝
  if (!facts.human) {
    if (!facts.listedBot) return { admitted: false, reason: 'not_human' };
    if (facts.mode === 'off')
      return { admitted: false, reason: 'admission_ignored' };
    return { admitted: true, strength: 'inferred', via: 'bot' };
  }

  // ① 白名单 + 直接指向 ⇒ 显式（任何模式都有效）
  if (facts.allowed && facts.addressed) {
    return { admitted: true, strength: 'explicit', via: 'addressed' };
  }

  // ② 先判准入单元格的 explicit：线程上已有 Ticket 不得把显式请求降级为 followup
  if (facts.admission === 'explicit') {
    return {
      admitted: true,
      strength: 'explicit',
      via: 'admission',
      cell: facts.cell,
    };
  }

  // ③ followup：白名单内 ⇒ 显式；白名单外 ⇒ 推断（且 `off` 模式下不成立）。
  //    "陌生人的私聊"不构成 followup（私聊线程属于一个发送者）。
  const directFromStranger = facts.directMessage === true && !facts.allowed;
  if (
    facts.followup &&
    !directFromStranger &&
    (facts.allowed || facts.mode !== 'off')
  ) {
    return {
      admitted: true,
      strength: facts.allowed ? 'explicit' : 'inferred',
      via: 'followup',
    };
  }

  // ④ 准入表给出 inferred，且未关闭推断
  if (facts.admission === 'inferred' && facts.mode !== 'off') {
    return {
      admitted: true,
      strength: 'inferred',
      via: 'admission',
      cell: facts.cell,
    };
  }

  // ⑤ 拒绝：原因可枚举（不写自由文本）
  return {
    admitted: false,
    reason: !facts.allowed
      ? 'not_a_member'
      : facts.admission === 'ignore'
        ? 'admission_ignored'
        : 'no_mention',
  };
}

/**
 * 主动（推断）工作是否可被接纳：必须 `auto` 模式 + 至少一条命中规则 + 全部规则仍启用。
 *
 * 对应 `docs/002:101`「A proactive accept requires at least one matching rule」。
 */
export function admitsInferred(
  mode: AcceptMode,
  matchedRuleIds: readonly string[],
  enabledRuleIds: ReadonlySet<string>
): boolean {
  // `off` 一律不接纳推断（`observe` 允许"研判"，但接单由 `decideAcceptance` 决定）
  if (mode === 'off') return false;
  return (
    matchedRuleIds.length > 0 &&
    matchedRuleIds.every((id) => enabledRuleIds.has(id))
  );
}

/**
 * 接单决定 —— 把"判定"与"是否真的接单"分开。
 *
 * | 强度 | off | observe | auto（正向研判） |
 * |---|---|---|---|
 * | explicit | accept | accept | accept |
 * | inferred | ignore | ignore + `wouldAccept` | accept |
 *
 * `wouldAccept` 即参考实现的"would accept"标记：**记录我会怎么做，但不真的做**。
 * 这是 `observe` 零副作用的落点（不得"先执行再回滚"）。
 */
export function decideAcceptance(input: {
  strength: Strength;
  mode: AcceptMode;
  /** 模型/规则的研判结论是否为正 */
  positive: boolean;
}): AcceptanceDecision {
  if (input.strength === 'explicit') {
    return input.positive
      ? { action: 'accept' }
      : { action: 'ignore', wouldAccept: false };
  }
  if (input.mode === 'off') return { action: 'ignore', wouldAccept: false };
  if (input.mode === 'observe') {
    return { action: 'ignore', wouldAccept: input.positive };
  }
  return input.positive
    ? { action: 'accept' }
    : { action: 'ignore', wouldAccept: false };
}

/** 内部：按给定快照重校验（供 `revalidateMandate` 与 `diffPolicyEffects` 复用） */
function revalidateWith(
  mandate: Mandate,
  facts: RevalidationFacts
): RevalidationResult {
  if (!facts.sourceStillListens) return { ok: false, reason: 'source_off' };
  const { basis, strength } = mandate;
  const rulesOn = (ids: string[] | undefined) =>
    (ids ?? []).every((id) => facts.enabledRuleIds.has(id));

  if (basis.via === 'followup') {
    if (strength === 'explicit') return { ok: true };
    if (facts.mode !== 'auto') return { ok: false, reason: 'mode_off' };
    if (!rulesOn(basis.rules)) return { ok: false, reason: 'rules_disabled' };
    return { ok: true };
  }

  if (basis.via === 'bot' && !facts.botStillListed) {
    return { ok: false, reason: 'bot_not_listed' };
  }

  if (basis.via === 'admission') {
    const cell = basis.cell;
    // 该发送者已被加入白名单且直接指向代理 ⇒ 显式，无需再看表格
    if (cell === 'unlistedAddressed' && facts.senderStillAllowed)
      return { ok: true };
    // `listedUnaddressed` 单元格的前提是"发送者仍在白名单"；被移出 ⇒ 该依据不再成立
    if (cell === 'listedUnaddressed' && !facts.senderStillAllowed) {
      return { ok: false, reason: 'sender_not_allowed' };
    }
    const now = facts.admissionStrengthNow;
    // `undefined` = 调用方未提供今日表格强度 ⇒ 视为"未削弱"（不凭缺失判失败）
    if (now && STRENGTH_RANK[now] < STRENGTH_RANK[strength]) {
      return { ok: false, reason: 'weakened' };
    }
    if (strength === 'explicit') return { ok: true };
  } else if (basis.via !== 'bot' && !facts.senderStillAllowed) {
    return { ok: false, reason: 'sender_not_allowed' };
  }

  // 推断类（含 bot / 表格 / 观察）还需：auto 模式 + 命中规则仍启用
  if (strength === 'inferred') {
    if (facts.mode !== 'auto') return { ok: false, reason: 'mode_off' };
    if (!rulesOn(basis.rules)) return { ok: false, reason: 'rules_disabled' };
  }
  return { ok: true };
}

/**
 * 结束态工作项被唤醒前的**重校验**（`docs/002:131-141`）。
 *
 * 失败 ⇒ 工作项保持结束态、**不吞**唤醒消息（由上层按"该消息未被任何工作项接收"处理）。
 */
export function revalidateMandate(
  mandate: Mandate,
  facts: RevalidationFacts
): RevalidationResult {
  return revalidateWith(mandate, facts);
}

/**
 * 配置变更对**在途**授权的影响（`docs/002:111-117`、`src/policy.ts:144-165`）。
 *
 * 只产出三类效果：
 * - `rules`：命中规则被禁用 / 文案变更；
 * - `requesterAllowed: false`：请求者已失去发起资格（**不是**策略收紧导致的）；
 * - `proactive: false`：不再接受主动工作（`auto → 非 auto`，且该授权为推断类）。
 *
 * **不撤销 Mandate、不取消在途工作** —— 取消会把工作留在半成品状态。
 */
export function diffPolicyEffects(
  tickets: ReadonlyArray<{ id: string; mandate: Mandate }>,
  oldSnap: PolicySnapshot,
  nowSnap: PolicySnapshot
): Map<string, PolicyEffect> {
  const effects = new Map<string, PolicyEffect>();
  const factsOf = (snap: PolicySnapshot): RevalidationFacts => ({
    sourceStillListens: true,
    mode: snap.mode,
    enabledRuleIds: snap.enabledRuleIds,
    senderStillAllowed: snap.senderAllowed,
    botStillListed: snap.botListed,
    admissionStrengthNow: snap.admissionStrength,
  });

  for (const ticket of tickets) {
    const { mandate } = ticket;
    const effect: PolicyEffect = {};

    // ① 命中规则的变更/禁用
    const rules: NonNullable<PolicyEffect['rules']> = [];
    for (const id of mandate.basis.rules ?? []) {
      const wasEnabled = oldSnap.enabledRuleIds.has(id);
      const isEnabled = nowSnap.enabledRuleIds.has(id);
      if (!isEnabled) {
        if (wasEnabled) rules.push({ id, change: 'disabled' });
        continue;
      }
      const was = oldSnap.ruleText.get(id);
      const is = nowSnap.ruleText.get(id);
      if (was !== undefined && was !== is)
        rules.push({ id, change: 'changed' });
    }
    if (rules.length) effect.rules = rules;

    // ② 是否因"人/来源"失去资格（策略收紧不在此列）
    if (revalidateWith(mandate, factsOf(oldSnap)).ok) {
      const nowResult = revalidateWith(mandate, factsOf(nowSnap));
      if (!nowResult.ok) {
        // 保留"旧模式 + 旧规则"再判一次：仍失败 ⇒ 是发送者/来源失格，而不是策略收紧
        const asBefore: PolicySnapshot = {
          ...nowSnap,
          mode: oldSnap.mode,
          enabledRuleIds: oldSnap.enabledRuleIds,
          ruleText: oldSnap.ruleText,
        };
        if (!revalidateWith(mandate, factsOf(asBefore)).ok) {
          effect.requesterAllowed = false;
        } else if (
          mandate.strength === 'inferred' &&
          oldSnap.mode === 'auto' &&
          nowSnap.mode !== 'auto'
        ) {
          effect.proactive = false;
        }
      }
    }

    if (Object.keys(effect).length) effects.set(ticket.id, effect);
  }
  return effects;
}

/**
 * 生成 Policy 版本号（确定性、可比较；Mandate 记录它）。
 *
 * `parts` 由调用方按**稳定顺序**给出（规则 id+文本、acceptMode、各来源策略段）。
 * 用 djb2 变体而非 crypto：纯函数、无 IO、跨环境一致。
 */
export function buildPolicyVersion(parts: readonly string[]): string {
  let hash = 5381;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash = ((hash << 5) + hash + part.charCodeAt(i)) | 0;
    }
    // 分隔符参与运算，避免 ["ab","c"] 与 ["a","bc"] 撞车
    hash = ((hash << 5) + hash + 0x1f) | 0;
  }
  return `ps1-${(hash >>> 0).toString(36)}`;
}

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
 * 授权强度模型（Policy strength）—— 类型定义
 *
 * 来源：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 **P33**，
 * 语义对齐参考实现 `docs/002-authorization.md` 与 `src/policy.ts`。
 *
 * 与既有权限体系的关系（**正交，不替代**）：
 * - 既有 `PermissionChecker` / `RuleManager` 是**动作拦截**（allow / deny / ask），管"这一步能不能做"；
 * - 本模块是**准入判定**，管"这件事是否被授权启动、以什么强度启动、配置变更后是否仍成立"。
 *
 * 刻意**不**登记进 `stateMachineCatalog`：`off / observe / auto` 等是跨域通用词，
 * 登记会把全仓大量既有字面量一次性划入"已登记状态词汇"（`lint:state-ratchet` 会要求
 * 全量收编），反而削弱门禁。本模块是**策略词汇**，不是生命周期状态机。
 */

/** 授权强度：显式（人直接要求）/ 推断（规则允许、但非人直接要求） */
export type Strength = 'explicit' | 'inferred';

/** 准入表的三个单元格：是否在白名单内 × 是否直接指向代理 */
export type AdmissionCell =
  | 'listedUnaddressed'
  | 'unlistedAddressed'
  | 'unlistedUnaddressed';

/** 单元格取值：可成为显式请求 / 只能成为推断候选 / 不接纳 */
export type AdmissionDecision = 'explicit' | 'inferred' | 'ignore';

/** 接单模式（Policy 的一部分） */
export type AcceptMode = 'off' | 'observe' | 'auto';

/** 准入表：接收范围 → 单元格 → 取值（缺省由 `ADMISSION_DEFAULTS` 补齐） */
export type AdmissionTable = Record<
  string,
  Partial<Record<AdmissionCell, AdmissionDecision>>
>;

/** 拒绝原因（可枚举、可审计；不写自由文本） */
export type GateReason =
  | 'not_human'
  | 'source_not_listening'
  | 'not_a_member'
  | 'admission_ignored'
  | 'no_mention';

/** 通过判定所需**已解析**的事实（调用方负责把来源配置解析成这些布尔/取值） */
export interface GateFacts {
  /** 是否人类（否则走 machineGate：只认 bot 白名单，且只能是 inferred） */
  human: boolean;
  /** 是否直接指向代理（mention / direct message） */
  addressed: boolean;
  /** 是否为**私聊**（私聊线程只属于一个发送者 ⇒ 陌生人的私聊不构成 followup） */
  directMessage?: boolean;
  /** 该 Thread 上是否已有 Ticket（⇒ followup 语义） */
  followup: boolean;
  /** 发送者是否在来源白名单内 */
  allowed: boolean;
  /** 机器发送者是否在来源 bot 白名单内 */
  listedBot?: boolean;
  /** 来源当前是否监听该会话 */
  listened: boolean;
  /** 命中的准入单元格（`allowed && addressed` 时为 undefined） */
  cell?: AdmissionCell;
  /** 该单元格的取值（已按 `ADMISSION_DEFAULTS` 补齐） */
  admission?: AdmissionDecision;
  mode: AcceptMode;
}

/** 准入结果：要么给出强度与依据，要么给出可枚举原因 */
export type GateResult =
  | {
      admitted: true;
      strength: Strength;
      via: MandateBasis['via'];
      /** `via === 'admission'` 时命中的单元格 */
      cell?: AdmissionCell;
    }
  | { admitted: false; reason: GateReason };

/** Mandate 的依据（记录"凭什么可以做"） */
export interface MandateBasis {
  via: 'addressed' | 'followup' | 'admission' | 'bot';
  /** `via === 'admission'` 时命中的单元格 */
  cell?: AdmissionCell;
  /** 发送者身份（来源自己的标识，**不跨来源映射**） */
  sender?: string;
  /** 命中的 Policy 规则 id（主动工作必须有至少一条） */
  rules?: string[];
  /** 接受时的 Policy 版本 */
  policyVersion: string;
}

/** 不可变授权对象：扩容 = 新 Ticket；只有"人喊停"或"重校验失败"能撤销 */
export interface Mandate {
  strength: Strength;
  basis: MandateBasis;
  scope: { source: string; thread: string; workspace?: string };
}

/** 重校验输入（结束态工作项被唤醒前调用） */
export interface RevalidationFacts {
  /** 来源是否仍在监听原 Thread */
  sourceStillListens: boolean;
  mode: AcceptMode;
  /** 当前仍启用的规则 id */
  enabledRuleIds: ReadonlySet<string>;
  /** 发送者是否仍在白名单 */
  senderStillAllowed: boolean;
  /** bot 是否仍在来源 bot 白名单 */
  botStillListed: boolean;
  /** `via === 'admission'`：今日表格对该单元格给出的强度（`ignore` 表示已不被接纳） */
  admissionStrengthNow?: Strength | 'ignore';
}

/** 重校验失败原因 */
export type RevalidationFailure =
  | 'source_off'
  | 'mode_off'
  | 'rules_disabled'
  | 'sender_not_allowed'
  | 'bot_not_listed'
  | 'weakened';

export type RevalidationResult =
  | { ok: true }
  | { ok: false; reason: RevalidationFailure };

/** 某一时刻 Policy 的可比较快照（`old` / `now` 各取一份） */
export interface PolicySnapshot {
  version: string;
  mode: AcceptMode;
  enabledRuleIds: ReadonlySet<string>;
  /** 规则 id → 文本（用于检出"文案变更"） */
  ruleText: ReadonlyMap<string, string>;
  senderAllowed: boolean;
  botListed: boolean;
  /** `via === 'admission'` 时今日表格给出的强度 */
  admissionStrength?: Strength | 'ignore';
}

/** 配置变更对**在途**授权的影响（不撤销 Mandate、不取消在途工作） */
export interface PolicyEffect {
  rules?: Array<{ id: string; change: 'changed' | 'disabled' }>;
  /** 请求者已失去发起资格 */
  requesterAllowed?: false;
  /** 不再接受主动（推断）工作 */
  proactive?: false;
}

/** 接单决定（对应参考实现的 accept / ignore + would-accept 标记） */
export type AcceptanceDecision =
  | { action: 'accept' }
  | { action: 'ignore'; wouldAccept: boolean };

/**
 * P33-a（2026-11-02）：自主触发策略的**规则**。
 *
 * 推断类工作至少命中一条 `enabled` 规则才可接单；`sources` 缺省/空 = 适用于全部来源。
 */
export interface AutonomyPolicyRule {
  id: string;
  text: string;
  enabled: boolean;
  /** 适用来源（如 `alwayson` / `cron`；缺省/空 = 全部） */
  sources?: string[];
}

/**
 * P33-a：`autonomy.policy` 配置结构（用户可写 + 托管可覆盖）。
 *
 * 只描述**准入策略**，不替代既有 `PermissionChecker`（动作拦截）。
 * 缺省值见 `app/src/tasks/autonomy/policyConfig.ts#DEFAULT_AUTONOMY_POLICY`。
 */
export interface AutonomyPolicyConfig {
  /** 总开关；`false` ⇒ 不判定、不记录、行为与改造前逐字一致 */
  enabled: boolean;
  /** 接单模式（`off` / `observe` / `auto`） */
  acceptMode: AcceptMode;
  /** 来源开关（内部来源无人类发送者 ⇒ 兼作"机器发送者白名单"） */
  sources: Record<string, boolean>;
  /** 准入表（键 = 来源） */
  admission: AdmissionTable;
  /** 主动（推断）规则 */
  rules: AutonomyPolicyRule[];
  /** 预留：外部来源的发送者 / bot 白名单 */
  allowlist?: { senders?: string[]; bots?: string[] };
  /** 预留：线程前缀 / 工作区过滤 */
  filters?: { threadPrefixes?: string[]; workspaceIds?: string[] };
}

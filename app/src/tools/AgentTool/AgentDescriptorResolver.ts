// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Agent 描述符解析链（O11）
 *
 * 把模型/CLI 传入的 `subagent_type` 解析为"系统提示词 + 推荐模型"，
 * **替代原先的隐式降级**（原实现无论如何都退回 `custom` + 默认提示词，且无任何提示）。
 *
 * 四级回退（前一级命中即返回，**不再继续下沉**）：
 *   ① `agent_roles`（DB，`enabled = 1`）—— 用户在 `/agent/roles` 管理
 *   ② 运行时注册的 agent（`AgentRegistry`，插件/动态注册）
 *   ③ 内置类型（`BUILTIN_AGENTS`）
 *   ④ **显式拒绝**（fail-closed）
 *
 * O11-1 两段校验：**先**查存在性、**再**查启用位 —— 两者文案区分开，
 * 使"名字拼错"与"角色被禁用"可分辨；`enabled = false` 判**解析失败**，不回退默认提示词。
 * （T7：两段判定的**实现**在存储层 —— `deps.getRole` 直接返回三态，本模块不再读 `enabled`。）
 *
 * 依赖以函数注入（`AgentDescriptorDeps`）：本模块**不 import DB / 注册表 / AgentTool**，
 * 故可独立单测（四个层级 + 两种拒绝 + 未指定类型）。
 *
 * O16 契约：`subagent_type` 与 `agent_roles.agent_id` 的匹配**大小写不敏感** ——
 * 本模块把入参 `raw.toLowerCase()` 后作为 key 交给 `deps.getRole`，而 `AgentRoleStore`
 * 在**写入与查询两侧**同样归一（见该类 docstring）⇒ 两端契约一致，调用方无需自行处理。
 */

/** DB 角色（解析链①）在解析期需要的最小字段 */
export interface AgentDescriptorRole {
  agentId: string;
  systemPrompt?: string;
  model?: string;
  /**
   * T9：该角色**能否再委派子代理**（策略位，来自用户在「Agent 角色」页的配置）。
   *
   * 缺省/false ⇒ 不可委派（fail-closed）。该值只表示"角色被授权"，是否**实际放行**
   * 还取决于父侧深度上限（`MAX_SUBAGENT_DEPTH`）—— 双判据的合取在 `AgentTool` 内完成。
   */
  canDelegate?: boolean;
}

/**
 * ① 的取数结果**三态**（T7：启用判定收敛到存储层 `AgentRoleStore.resolveForDelegation`）。
 *
 * 为何是三态、而不是"返回角色 + 本模块读 `enabled`"：后者会把"什么算启用"的规则
 * 复制到解析链（存储层 `listEnabled()` 已有一份 SQL 实现）⇒ 两处判定可能漂移（设计文档 A6/T7）；
 * 且 `disabled` 与 `missing` **必须可分辨**（O11-1：两者文案不同，且都不得静默回退默认提示词）。
 */
export type AgentDescriptorRoleLookup =
  | { state: 'ok'; role: AgentDescriptorRole }
  | { state: 'disabled' }
  | { state: 'missing' };

/** 运行时注册的 agent（解析链②）在解析期需要的最小字段 */
export interface AgentDescriptorRegistered {
  name?: string;
  role?: string;
  systemPrompt?: string;
  model?: string;
}

/** 解析链依赖（由调用方注入真实取数逻辑） */
export interface AgentDescriptorDeps {
  /** 按 agentId（小写后）读取 DB 角色 —— **三态**：命中 / 被禁用 / 不存在 */
  getRole: (key: string) => Promise<AgentDescriptorRoleLookup>;
  /** 按 agentId/显示名/role 读取运行时注册的 agent（未注册返回 null） */
  getRegistered: (key: string, raw: string) => AgentDescriptorRegistered | null;
  /** 内置类型名名单（**单一来源**，与错误提示共用） */
  builtinTypeNames: string[];
}

/** 解析来源（写入日志，便于排障"这个提示词到底从哪来"） */
export type AgentDescriptorSource =
  | 'default'
  | 'role-store'
  | 'registry'
  | 'builtin';

export type AgentDescriptorResult =
  | {
      ok: true;
      source: AgentDescriptorSource;
      systemPrompt: string;
      model?: string;
      /**
       * T9：该子代理**是否被授权再委派**（仅 ① DB 角色可携带；② 注册表 / ③ 内置 ⇒ 无此授权）。
       *
       * 语义：**模型不能自选** —— 它只能选择"用户已在管理页授权委派的角色"；
       * 放行与否还要与父侧深度上限取合取（见 `AgentTool.resolveDelegationGrant`）。
       */
      canDelegate?: boolean;
    }
  | { ok: false; error: string };

/**
 * O18：可用类型名快照（**同步**可读 —— 工具 schema 的描述在同步路径上渲染）。
 *
 * 由 `AgentTool.refreshAvailableSubagentTypeNames()` 在"工具构造"与"角色变更后"写入；
 * 未刷新时为空 ⇒ 描述中不出现 DB 角色名（退化为内置 + 运行时注册，不臆测）。
 */
let enabledRoleNames: readonly string[] = [];

/** O18：写入快照（应为 DB 中 `enabled = 1` 的角色名） */
export function setEnabledRoleNames(names: readonly string[]): void {
  enabledRoleNames = [...names];
}

/** O18：读取快照 */
export function getEnabledRoleNames(): readonly string[] {
  return enabledRoleNames;
}

/**
 * O18：渲染 `subagent_type` 的 schema 描述。
 *
 * **与 ④ 分支的错误文案共用同一来源**（内置名单 + DB 角色 + 运行时注册）——
 * 修复前描述是静态字符串（只列 6 个内置名）⇒ 模型**事前**看不到用户在管理页配的角色，
 * 只在拼错后才会从错误文案里得知（N9 / R4：可见面与实现面不同步）。
 */
export function renderSubagentTypeDescription(params: {
  builtinTypeNames: string[];
  registeredNames?: string[];
}): string {
  const sections: string[] = [
    `${params.builtinTypeNames.join(', ')} (builtin)`,
  ];
  const roles = getEnabledRoleNames();
  if (roles.length > 0) {
    sections.push(`${roles.join(', ')} (configured in Agent 管理页)`);
  }
  const registered = (params.registeredNames ?? []).filter(
    (name) => name.length > 0 && !params.builtinTypeNames.includes(name)
  );
  if (registered.length > 0) {
    sections.push(`${registered.join(', ')} (runtime registered)`);
  }
  return (
    `The type of specialized agent to use. Available: ${sections.join(' / ')}. ` +
    'Leave empty to use the default.'
  );
}

/**
 * 解析 `subagent_type` ⇒ 描述符。
 *
 * 不抛错：一切失败路径都以 `{ ok: false, error }` 返回（调用方据此 fail-closed）。
 */
export async function resolveAgentDescriptor(params: {
  subagentType?: string;
  /** 基准提示词（内置角色提示词或默认提示词），命中③时即用它 */
  baseSystemPrompt: string;
  deps: AgentDescriptorDeps;
}): Promise<AgentDescriptorResult> {
  const raw = params.subagentType?.trim();
  if (!raw) {
    // 未指定 subagent_type（含 fork 模式）：沿用内置/默认提示词
    return {
      ok: true,
      source: 'default',
      systemPrompt: params.baseSystemPrompt,
    };
  }
  const key = raw.toLowerCase();

  // ① DB 角色（用户配置）—— **三态由存储层给出**（本模块不读 enabled，避免判定双实现）
  const roleLookup = await params.deps.getRole(key);
  if (roleLookup.state === 'disabled') {
    return {
      ok: false,
      error:
        `Agent 角色 "${raw}" 已被禁用（enabled = 0）。` +
        '请在 Agent 管理页启用它，或改用其他角色 / 内置类型。',
    };
  }
  if (roleLookup.state === 'ok') {
    const role = roleLookup.role;
    return {
      ok: true,
      source: 'role-store',
      systemPrompt: role.systemPrompt || params.baseSystemPrompt,
      model: role.model,
      // T9：授权位随角色下发（缺省 false；模型无法自行声明）
      canDelegate: role.canDelegate === true,
    };
  }

  // ② 运行时注册表（插件/动态注册）
  const registered = params.deps.getRegistered(key, raw);
  if (registered) {
    return {
      ok: true,
      source: 'registry',
      systemPrompt: registered.systemPrompt || params.baseSystemPrompt,
      model: registered.model,
    };
  }

  // ③ 内置类型（基准提示词即该内置角色的提示词）
  if (params.deps.builtinTypeNames.includes(key)) {
    return {
      ok: true,
      source: 'builtin',
      systemPrompt: params.baseSystemPrompt,
    };
  }

  // ④ fail-closed：未知 agentId —— 显式拒绝（原实现静默降级为 'custom' + 默认提示词）
  return {
    ok: false,
    error:
      `未知的 subagent_type "${raw}"。可用值：Agent 管理页配置的 DB 角色、` +
      `运行时注册的 agent、或内置类型之一：${params.deps.builtinTypeNames.join(', ')}。`,
  };
}

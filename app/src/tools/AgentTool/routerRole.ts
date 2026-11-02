/**
 * router 角色 —— 只做分诊，不亲自动手（P36，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 **P36**。
 * 参考实现 `docs/003-execution.md:29`（router preset 的工具面比 worker 更少）与
 * `docs/002-domain.md:28-36`（执行器持有期间由执行器动手，主循环只做分诊）。
 *
 * 为什么用**白名单**而不是再列一串 `disallowedTools`：
 * 黑名单是"全量 − N"，工具面会随内置工具增长而**自动变大**（新增写盘工具即落进 router 手里）；
 * 白名单是"恰好这 4 个"，新增工具**不会**自动获得 ⇒ 符合"主 agent 不得亲自动手"的纪律。
 *
 * 参考实现 → Liri 工具名映射（唯一映射点，其余地方不得再抄一份）：
 * - `spawn_worker` → `agent`
 * - `ask_human`    → `ask_user_question`
 * - `read_ticket`  → `task_output`
 * - `close_ticket` → `task_list`（其 update 动作可把工作项置为终态）
 *
 * 编译期守卫：`satisfies readonly ToolName[]` ⇒ 四个名字必须真实存在于生成清单；
 * 拼错即 typecheck 失败（比运行时测试更早）。
 */
import type { ToolName } from '@openliri/infra/constants/toolNames.generated';
import type { BuiltInAgentDefinition } from '@modules/agent';

/** 角色 id（`subagent_type` 归一后的键） */
export const ROUTER_ROLE_ID = 'router';

/** 分诊角色白名单：**恰 4 个**（新增/删除必须同步改测试与本文档） */
export const ROUTER_ROLE_TOOL_NAMES = [
  'agent',
  'ask_user_question',
  'task_list',
  'task_output',
] as const satisfies readonly ToolName[];

/** 白名单元素类型（写入侧只能取这 4 个名字 —— 接口与工具表同时收窄） */
export type RouterToolName = (typeof ROUTER_ROLE_TOOL_NAMES)[number];

/** 分诊角色提示词（只描述"派给谁 / 问人 / 看单 / 关单"四件事） */
export const ROUTER_SYSTEM_PROMPT = `你是分诊器（router），只做**决策**，不**亲自动手**。

可用动作恰好四类：
1. 派工：用 \`agent\` 把具体工作交给子代理（说明目标与验收口径）；
2. 问人：信息不足或需要授权时，用 \`ask_user_question\` 问清再动；
3. 看单：用 \`task_output\` 读取工作项产出与状态；
4. 关单：用 \`task_list\` 更新工作项状态（完成 / 取消）。

你**不能**读写文件、执行命令、改动项目 —— 这些必须交给子代理。`;

/**
 * 内置定义（注册进 `BUILTIN_AGENT_DEFINITIONS_BY_TYPE`）。
 *
 * `tools` 是**白名单**：`AgentToolPool.getInheritableToolPool({ allowedTools })`
 * 会据此把可继承池裁到 4 个；未声明的角色不走这条路径（回退现状）。
 */
export const ROUTER_AGENT_DEFINITION: BuiltInAgentDefinition = {
  agentType: ROUTER_ROLE_ID,
  whenToUse:
    '需要分诊时使用：判断该派给谁、该不该问人、工作项该关还是继续，但自己不修改代码或文件。',
  color: 'cyan',
  background: false,
  tools: [...ROUTER_ROLE_TOOL_NAMES],
  // P36 修复（2026-11-02）：`getBuiltinAllowedTools` 读的是 `allowedTools`，此前只填了
  // `tools` ⇒ 内置 router 的白名单在运行时为 `undefined`（收窄未生效）。两者同源，防止漂移。
  allowedTools: [...ROUTER_ROLE_TOOL_NAMES],
  source: 'built-in',
  baseDir: 'built-in',
  model: 'inherit',
  getSystemPrompt: () => ROUTER_SYSTEM_PROMPT,
};

/**
 * 某工具是否在角色白名单内（大小写不敏感；白名单为空 / 缺省 ⇒ 不限制）。
 *
 * 纯函数、单一判定：`AgentTool` 的 fail-closed 校验与测试共用。
 */
export function isToolAllowedByRole(
  roleTools: readonly string[] | undefined,
  toolName: string
): boolean {
  if (!roleTools || roleTools.length === 0) return true;
  const key = toolName.trim().toLowerCase();
  return roleTools.some((t) => t.trim().toLowerCase() === key);
}

/**
 * 找出**模型显式请求**但越出角色白名单的工具（用于 fail-closed 拒绝）。
 *
 * 空数组 ⇒ 请求合法（或角色未声明白名单）。
 */
export function findToolsOutsideRole(
  roleTools: readonly string[] | undefined,
  requested: readonly string[] | undefined
): string[] {
  if (!roleTools || roleTools.length === 0) return [];
  return (requested ?? []).filter(
    (name) => !isToolAllowedByRole(roleTools, name)
  );
}

/**
 * 越界时的**拒绝文案**（无越界 ⇒ `undefined`）。
 *
 * 由 `AgentTool.execute` 在描述符解析后调用一次 —— 文案与判定同源，避免两处拼字符串。
 */
export function describeRoleToolViolation(
  roleLabel: string,
  roleTools: readonly string[] | undefined,
  requested: readonly string[] | undefined
): string | undefined {
  const outside = findToolsOutsideRole(roleTools, requested);
  if (outside.length === 0) return undefined;
  return (
    `角色「${roleLabel}」的工具白名单不含：${outside.join(', ')}。` +
    `该角色只能使用：${(roleTools ?? []).join(', ')}。`
  );
}

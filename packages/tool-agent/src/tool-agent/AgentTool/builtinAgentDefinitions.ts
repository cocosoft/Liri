/**
 * 内置子代理定义索引（P36，2026-11-02）
 *
 * 只收录**携带工具声明**的策略定义（其余内置类型没有声明 ⇒ 回退既有行为）。
 * 键 = `BUILTIN_AGENTS` 的键（= `subagent_type` 归一后的**小写名**），与解析链 ③ 分支的
 * `key` 口径一致；未收录者取不到 ⇒ `undefined`（不抛错）。
 *
 * 为什么单列一个文件：`AgentTool.ts` 已触达 2000 行上限（R04-001），
 * 这张纯数据表与两个 getter 属于"定义侧数据"，不参与执行编排。
 */
import { ROUTER_AGENT_DEFINITION } from './routerRole';
import { STATUSLINE_SETUP_AGENT_DEFINITION } from './strategies/StatuslineStrategy';
import { VERIFICATION_AGENT_DEFINITION } from './strategies/VerificationStrategy';

/** 定义侧工具声明（只减不增；白名单缺省 ⇒ 不限制默认面） */
export interface BuiltinToolDeclaration {
  disallowedTools?: string[];
  allowedTools?: string[];
}

export const BUILTIN_AGENT_DEFINITIONS_BY_TYPE: Record<
  string,
  BuiltinToolDeclaration
> = {
  [VERIFICATION_AGENT_DEFINITION.agentType]: VERIFICATION_AGENT_DEFINITION,
  [STATUSLINE_SETUP_AGENT_DEFINITION.agentType]:
    STATUSLINE_SETUP_AGENT_DEFINITION,
  // P36：分诊角色 —— 白名单恰 4 个（`routerRole.ts` 为唯一事实源）
  [ROUTER_AGENT_DEFINITION.agentType]: ROUTER_AGENT_DEFINITION,
};

/** 按内置类型名取定义侧黑名单（取不到 ⇒ `undefined`，不抛错） */
export function getBuiltinDisallowedTools(
  typeName: string
): string[] | undefined {
  return BUILTIN_AGENT_DEFINITIONS_BY_TYPE[typeName]?.disallowedTools;
}

/** 按内置类型名取定义侧白名单（P36；取不到 ⇒ `undefined`） */
export function getBuiltinAllowedTools(typeName: string): string[] | undefined {
  return BUILTIN_AGENT_DEFINITIONS_BY_TYPE[typeName]?.allowedTools;
}

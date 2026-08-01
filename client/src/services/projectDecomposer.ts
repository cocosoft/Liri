import type { ProjectNode } from "../types/work";

export interface DecomposeOptions {
  projectId: string;
}

/**
 * 基于规则的离线兜底分解。
 * CS04: 原 400 行硬编码电网流程监控模板节点已移除。
 * CS05-ROOTFIX: 改为调用后端 LLM API（POST /v1/projects/:id/decompose）。
 *   本函数应降级为 LLM 不可用时的离线兜底（规则引擎/模板匹配）。
 */
function ruleBasedDecompose(
  _requirements: string,
  _options: { projectId: string },
): ProjectNode[] {
  return [];
}

/**
 * 项目分解入口。
 * CS05-ROOTFIX: 当前返回空数组，需对接后端 LLM 分解 API。
 * 根因方案: POST /v1/projects/:id/decompose → 后端 LLM → 返回结构化 ProjectNode[]。
 * 关联: P3（项目模块双体系混乱优化方案）。
 */
export async function decompose(
  requirements: string,
  options: DecomposeOptions,
): Promise<ProjectNode[]> {
  return ruleBasedDecompose(requirements, options);
}

export const projectDecomposer = {
  decompose,
};

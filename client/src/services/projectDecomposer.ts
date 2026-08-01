import type { ProjectNode } from "../types/work";
import { http } from "./httpClient";
import { createLogger } from "@/utils/logger";

const logger = createLogger("services:projectDecomposer");

export interface DecomposeOptions {
  projectId: string;
  workspaceId?: string;
}

/**
 * 项目分解入口。
 * 调用后端 LLM API，将项目需求拆解为结构化任务树（ProjectNode[]）。
 * LLM 不可用时回退到空数组。
 */
export async function decompose(
  requirements: string,
  options: DecomposeOptions,
): Promise<ProjectNode[]> {
  const workspaceId = options.workspaceId || "default";

  try {
    const res = await http.post<{ nodes: ProjectNode[] }>(
      `/v1/workspaces/${workspaceId}/projects/${options.projectId}/decompose`,
      { requirements },
    );
    return res.data?.nodes || [];
  } catch (err) {
    logger.warn("decompose failed", { error: String(err) });
    return [];
  }
}

export const projectDecomposer = {
  decompose,
};

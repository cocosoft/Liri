import { httpLegacy as http } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import type { WorkItem } from "../stores/workStore";
import { createLogger } from "@/utils/logger";

const logger = createLogger("workspaceService");

/** 工作空间信息 */
export interface WorkspaceInfo {
  id: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

/** 工作空间 Session */
export interface WorkspaceSession {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** 创建工作空间请求 */
export interface CreateWorkspaceRequest {
  path: string;
  title?: string;
}

/** 创建工作项请求 */
export interface CreateWorkItemRequest {
  title: string;
  description?: string;
  sessionId?: string;
}

/** 创建会话请求 */
export interface CreateSessionRequest {
  title?: string;
  mode?: "plan" | "do";
}

/** .liri/ 目录检测结果 */
export interface LiriDetectionResult {
  found: boolean;
  path?: string;
  subdirs?: string[];
  configFiles?: string[];
}

/** 工作空间配置摘要 */
export interface WorkspaceConfigSummary {
  exists: boolean;
  liriDir: string | null;
  subdirs: string[];
  configFiles: string[];
  config: Record<string, unknown>;
  knowledge: Record<string, unknown>;
  tools: Record<string, unknown>;
  memory: Record<string, unknown>;
  rulesPreview: string;
}

/** 更新规则请求 */
export interface UpdateRulesRequest {
  content: string;
}

/** 变更集文件 */
export interface ChangeSetFile {
  /** 文件路径（相对于工作空间根目录） */
  path: string;
  /** 变更类型 */
  change: "added" | "modified" | "deleted";
  /** 新增行数 */
  additions?: number;
  /** 删除行数 */
  deletions?: number;
  /** 状态 */
  status: "pending" | "verified" | "failed";
}

/** 变更集 */
export interface ChangeSet {
  /** 变更集 ID */
  id: string;
  /** 关联的工作项 ID */
  workItemId: string;
  /** 变更描述 */
  description: string;
  /** 文件变更列表 */
  files: ChangeSetFile[];
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 审核状态 */
  status: "pending" | "reviewing" | "accepted" | "rejected";
}

/** 变更集统计摘要 */
export interface ChangeSetSummary {
  totalFiles: number;
  added: number;
  modified: number;
  deleted: number;
  pending: number;
  verified: number;
  failed: number;
}

/**
 * 工作空间 API 服务
 * 对接 Phase 0 后端 Workspace Session API
 */
/** 工作空间列表项（来自 GET /v1/workspaces） */
export interface WorkspaceListItem {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export const workspaceService = {
  /** 获取工作空间列表 */
  async listWorkspaces(): Promise<WorkspaceListItem[]> {
    return await http.get<WorkspaceListItem[]>(ENDPOINTS.workspace.base);
  },

  /** 获取工作空间信息 */
  async getWorkspace(id: string): Promise<WorkspaceInfo | null> {
    try {
      return await http.get<WorkspaceInfo>(ENDPOINTS.workspace.byId(id));
    } catch (err) {
      logger.warn("获取工作空间信息失败", err);
      return null;
    }
  },

  /** 解析前端项目 ID → 后端工作空间 ID（V-37 工作项删除用） */
  async resolveBackendWorkspaceId(projectId: string): Promise<string | null> {
    const project = await http.get<{ workspaceId?: string }>(
      ENDPOINTS.project.byId(projectId),
    );
    return project?.workspaceId ?? null;
  },

  /** 创建新工作空间 */
  async createWorkspace(data: CreateWorkspaceRequest): Promise<WorkspaceInfo> {
    return await http.post<WorkspaceInfo>(ENDPOINTS.workspace.base, data);
  },

  /** 删除工作空间 */
  async deleteWorkspace(id: string): Promise<{ success: boolean }> {
    return await http.delete<{ success: boolean }>(
      ENDPOINTS.workspace.byId(id),
    );
  },

  /** 获取工作空间的 session 列表 */
  async getSessions(workspaceId: string): Promise<WorkspaceSession[]> {
    return await http.get<WorkspaceSession[]>(
      ENDPOINTS.workspace.sessions(workspaceId),
    );
  },

  /** 开启工作空间 session */
  async createSession(
    workspaceId: string,
    data?: CreateSessionRequest,
  ): Promise<WorkspaceSession> {
    return await http.post<WorkspaceSession>(
      ENDPOINTS.workspace.sessions(workspaceId),
      data || {},
    );
  },

  /** 获取工作项列表 */
  async getWorkItems(workspaceId: string): Promise<WorkItem[]> {
    return await http.get<WorkItem[]>(ENDPOINTS.workspace.items(workspaceId));
  },

  /** 创建工作项 */
  async createWorkItem(
    workspaceId: string,
    data: CreateWorkItemRequest,
  ): Promise<WorkItem> {
    return await http.post<WorkItem>(
      ENDPOINTS.workspace.items(workspaceId),
      data,
    );
  },

  /** 更新工作项 */
  async updateWorkItem(
    workspaceId: string,
    itemId: string,
    data: Partial<WorkItem>,
  ): Promise<WorkItem> {
    return await http.patch<WorkItem>(
      ENDPOINTS.workspace.itemById(workspaceId, itemId),
      data,
    );
  },

  /** 删除工作项（V-37） */
  async deleteWorkItem(workspaceId: string, itemId: string): Promise<boolean> {
    const res = await http.delete<{ deleted: boolean }>(
      ENDPOINTS.workspace.itemById(workspaceId, itemId),
    );
    return res.deleted;
  },

  /** 检查后端 Workspace API 是否就绪 */
  async isBackendReady(): Promise<boolean> {
    try {
      await http.get<unknown>(ENDPOINTS.workspace.base);
      return true;
    } catch {
      return false;
    }
  },

  // ========== .liri/ 配置 API ==========

  /** 检测 .liri/ 目录 */
  async detectLiriDir(workspaceId: string): Promise<LiriDetectionResult> {
    return await http.get<LiriDetectionResult>(
      ENDPOINTS.workspace.liriDetect(workspaceId),
    );
  },

  /** 初始化 .liri/ 目录结构 */
  async initLiriDir(workspaceId: string): Promise<LiriDetectionResult> {
    return await http.post<LiriDetectionResult>(
      ENDPOINTS.workspace.liriInit(workspaceId),
    );
  },

  /** 获取工作空间配置摘要 */
  async getConfig(workspaceId: string): Promise<WorkspaceConfigSummary> {
    return await http.get<WorkspaceConfigSummary>(
      ENDPOINTS.workspace.config(workspaceId),
    );
  },

  /** 更新工作空间配置 */
  async updateConfig(
    workspaceId: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return await http.put<Record<string, unknown>>(
      ENDPOINTS.workspace.config(workspaceId),
      data,
    );
  },

  /** 获取工作空间规则 */
  async getRules(workspaceId: string): Promise<string> {
    return await http.get<string>(ENDPOINTS.workspace.rules(workspaceId));
  },

  /** 更新工作空间规则 */
  async updateRules(
    workspaceId: string,
    data: UpdateRulesRequest,
  ): Promise<{ success: boolean }> {
    return await http.put<{ success: boolean }>(
      ENDPOINTS.workspace.rules(workspaceId),
      data,
    );
  },

  // ========== 变更集 API ==========

  /** 列出工作项的变更集 */
  async listChangeSets(
    workspaceId: string,
    itemId: string,
  ): Promise<ChangeSet[]> {
    return await http.get<ChangeSet[]>(
      ENDPOINTS.workspace.itemChangeSets(workspaceId, itemId),
    );
  },

  /** 创建变更集 */
  async createChangeSet(
    workspaceId: string,
    itemId: string,
    data: { description: string; files?: ChangeSetFile[] },
  ): Promise<ChangeSet> {
    return await http.post<ChangeSet>(
      ENDPOINTS.workspace.itemChangeSets(workspaceId, itemId),
      data,
    );
  },

  /** 获取变更集详情 */
  async getChangeSet(
    workspaceId: string,
    changesetId: string,
  ): Promise<ChangeSet> {
    return await http.get<ChangeSet>(
      ENDPOINTS.workspace.changeSetById(workspaceId, changesetId),
    );
  },

  /** 添加文件变更到变更集 */
  async addFileChange(
    workspaceId: string,
    changesetId: string,
    data: {
      path: string;
      change: string;
      additions?: number;
      deletions?: number;
    },
  ): Promise<ChangeSet> {
    return await http.post<ChangeSet>(
      ENDPOINTS.workspace.changeSetFiles(workspaceId, changesetId),
      data,
    );
  },

  /** 更新变更集状态（审核） */
  async updateChangeSet(
    workspaceId: string,
    changesetId: string,
    data: { status: string },
  ): Promise<ChangeSet> {
    return await http.patch<ChangeSet>(
      ENDPOINTS.workspace.changeSetById(workspaceId, changesetId),
      data,
    );
  },

  /** 获取变更集统计摘要 */
  async getChangeSetSummary(
    workspaceId: string,
    changesetId: string,
  ): Promise<ChangeSetSummary> {
    return await http.get<ChangeSetSummary>(
      ENDPOINTS.workspace.changeSetSummary(workspaceId, changesetId),
    );
  },

  // ========== 编排 API ==========

  /** 获取编排快照 */
  async getOrchestrationSnapshot(
    workspaceId: string,
    itemId: string,
  ): Promise<Record<string, unknown>> {
    return await http.get<Record<string, unknown>>(
      ENDPOINTS.workspace.orchestration(workspaceId, itemId),
    );
  },

  // ========== Swarm API ==========

  /** 获取 Swarm 群组状态 */
  async getSwarmStatus(workspaceId: string): Promise<Record<string, unknown>> {
    return await http.get<Record<string, unknown>>(
      ENDPOINTS.workspace.swarm(workspaceId),
    );
  },

  // ========== Agent-Model 绑定 ==========

  /** 获取 Agent-Model 绑定配置 */
  async getAgentModelBindings(workspaceId: string): Promise<{
    bindings: Array<{
      agentRole: string;
      model: string;
      maxTokens: number;
      temperature: number;
    }>;
    availableModels: Array<{ id: string; name: string; provider: string }>;
  }> {
    return await http.get(ENDPOINTS.workspace.agentModelBindings(workspaceId));
  },

  /** 更新 Agent-Model 绑定配置 */
  async updateAgentModelBindings(
    workspaceId: string,
    data: {
      bindings: Array<{
        agentRole: string;
        model: string;
        maxTokens: number;
        temperature: number;
      }>;
    },
  ): Promise<{ success: boolean }> {
    return await http.put(
      ENDPOINTS.workspace.agentModelBindings(workspaceId),
      data as Record<string, unknown>,
    );
  },

  // ========== 团队 API ==========

  /** 获取团队列表 */
  async getTeams(workspaceId: string): Promise<unknown[]> {
    return await http.get(ENDPOINTS.workspace.teams(workspaceId));
  },

  /** 创建团队 */
  async createTeam(
    workspaceId: string,
    data: { name: string; description?: string; members?: unknown[] },
  ): Promise<unknown> {
    return await http.post(
      ENDPOINTS.workspace.teams(workspaceId),
      data as Record<string, unknown>,
    );
  },

  /** 获取团队详情 */
  async getTeam(workspaceId: string, teamId: string): Promise<unknown> {
    return await http.get(ENDPOINTS.workspace.teamById(workspaceId, teamId));
  },

  /** 更新团队 */
  async updateTeam(
    workspaceId: string,
    teamId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return await http.put(
      ENDPOINTS.workspace.teamById(workspaceId, teamId),
      data,
    );
  },

  /** 删除团队 */
  async deleteTeam(
    workspaceId: string,
    teamId: string,
  ): Promise<{ success: boolean }> {
    return await http.delete(ENDPOINTS.workspace.teamById(workspaceId, teamId));
  },

  /** 添加团队成员 */
  async addTeamMember(
    workspaceId: string,
    teamId: string,
    data: {
      id: string;
      name: string;
      role?: string;
      isAgent?: boolean;
      model?: string;
    },
  ): Promise<unknown> {
    return await http.post(
      ENDPOINTS.workspace.teamMembers(workspaceId, teamId),
      data as Record<string, unknown>,
    );
  },

  /** 移除团队成员 */
  async removeTeamMember(
    workspaceId: string,
    teamId: string,
    memberId: string,
  ): Promise<unknown> {
    return await http.delete(
      ENDPOINTS.workspace.teamMemberById(workspaceId, teamId, memberId),
    );
  },

  /** 更新成员角色 */
  async updateMemberRole(
    workspaceId: string,
    teamId: string,
    memberId: string,
    role: string,
  ): Promise<unknown> {
    return await http.put(
      ENDPOINTS.workspace.teamMemberRole(workspaceId, teamId, memberId),
      { role },
    );
  },

  // ========== 成本 API ==========

  /** 获取成本报告 */
  async getCostReport(workspaceId: string): Promise<unknown> {
    return await http.get(ENDPOINTS.workspace.costReport(workspaceId));
  },

  /** 获取预算状态 */
  async getBudgetStatus(workspaceId: string): Promise<unknown> {
    return await http.get(ENDPOINTS.workspace.costBudget(workspaceId));
  },

  // ========== 工作项搜索 API ==========

  /** 搜索工作项 */
  async searchWorkItems(
    workspaceId: string,
    query: Record<string, unknown>,
  ): Promise<unknown> {
    return await http.post(ENDPOINTS.workspace.itemsSearch(workspaceId), query);
  },

  /** 获取工作项回顾摘要 */
  async getWorkItemReview(workspaceId: string): Promise<unknown> {
    return await http.get(ENDPOINTS.workspace.itemsReview(workspaceId));
  },

  // ========== 工作流模板 API ==========

  /** 获取工作流模板列表 */
  async getWorkflowTemplates(): Promise<unknown[]> {
    return await http.get(ENDPOINTS.workflow.templates);
  },

  /** 获取工作流模板详情 */
  async getWorkflowTemplate(templateId: string): Promise<unknown> {
    return await http.get(ENDPOINTS.workflow.templateById(templateId));
  },

  /** 创建工作流模板 */
  async createWorkflowTemplate(
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return await http.post(ENDPOINTS.workflow.templates, data);
  },

  /** 更新工作流模板 */
  async updateWorkflowTemplate(
    templateId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return await http.put(ENDPOINTS.workflow.templateById(templateId), data);
  },

  /** 删除工作流模板 */
  async deleteWorkflowTemplate(
    templateId: string,
  ): Promise<{ success: boolean }> {
    return await http.delete(ENDPOINTS.workflow.templateById(templateId));
  },

  // ==================== Council API ====================

  /** 创建 Council 会话 */
  async createCouncil(
    workspaceId: string,
    data: {
      topic: string;
      context: string;
      agents: Array<{
        agentId: string;
        name: string;
        expertise: string[];
        weight: number;
      }>;
      maxRounds?: number;
    },
  ): Promise<{ sessionId: string; message: string }> {
    return await http.post(ENDPOINTS.workspace.council(workspaceId), data);
  },

  /** 获取 Council 会话 */
  async getCouncil(
    workspaceId: string,
    sessionId: string,
  ): Promise<import("@/types/council").CouncilSession> {
    return await http.get(
      ENDPOINTS.workspace.councilById(workspaceId, sessionId),
    );
  },

  /** 列出活跃的 Council 会话 */
  async listCouncils(
    workspaceId: string,
  ): Promise<import("@/types/council").CouncilSession[]> {
    return await http.get(ENDPOINTS.workspace.council(workspaceId));
  },

  // ==================== 编排智能 API ====================

  /** 变更影响评估 */
  async analyzeImpact(
    workspaceId: string,
    data: { changedFiles: string[]; changedContent: string },
  ): Promise<unknown> {
    return await http.post(
      ENDPOINTS.workspace.intelligenceImpact(workspaceId),
      data,
    );
  },

  /** 风险识别 */
  async detectRisks(
    workspaceId: string,
    data: { title: string; description: string; changedFiles: string[] },
  ): Promise<unknown> {
    return await http.post(
      ENDPOINTS.workspace.intelligenceRisks(workspaceId),
      data,
    );
  },

  /** 决策分级 */
  async classifyDecision(
    workspaceId: string,
    data: {
      title: string;
      description: string;
      impactResult?: unknown;
      risks?: unknown[];
    },
  ): Promise<unknown> {
    return await http.post(
      ENDPOINTS.workspace.intelligenceDecision(workspaceId),
      data,
    );
  },

  /** 异常升级 */
  async escalate(
    workspaceId: string,
    data: {
      workItemId: string;
      type: string;
      description: string;
      suggestedDirection: string;
    },
  ): Promise<unknown> {
    return await http.post(
      ENDPOINTS.workspace.intelligenceEscalate(workspaceId),
      data,
    );
  },

  /** 获取活跃异常 */
  async getEscalations(workspaceId: string): Promise<unknown> {
    return await http.get(
      ENDPOINTS.workspace.intelligenceEscalations(workspaceId),
    );
  },

  /** 资源调度 */
  async scheduleResource(
    workspaceId: string,
    data: { workItemId: string; resources: string[]; priority: number },
  ): Promise<unknown> {
    return await http.post(
      ENDPOINTS.workspace.intelligenceSchedule(workspaceId),
      data,
    );
  },

  /** 获取资源状态 */
  async getResources(workspaceId: string): Promise<unknown> {
    return await http.get(
      ENDPOINTS.workspace.intelligenceResources(workspaceId),
    );
  },

  // ==================== 规则管理 API ====================

  /** 列出所有规则 */
  async listRules(workspaceId: string): Promise<unknown> {
    return await http.get(ENDPOINTS.workspace.rules(workspaceId));
  },

  /** 读取规则 */
  async getRule(workspaceId: string, specialization: string): Promise<unknown> {
    return await http.get(
      ENDPOINTS.workspace.ruleBySpec(workspaceId, specialization),
    );
  },

  /** 写入规则 */
  async writeRule(
    workspaceId: string,
    specialization: string,
    content: string,
  ): Promise<unknown> {
    return await http.put(
      ENDPOINTS.workspace.ruleBySpec(workspaceId, specialization),
      { content },
    );
  },

  /** 追加规则 */
  async appendRule(
    workspaceId: string,
    specialization: string,
    content: string,
  ): Promise<unknown> {
    return await http.post(
      ENDPOINTS.workspace.ruleBySpec(workspaceId, specialization),
      { content },
    );
  },

  /** 按工作项加载规则 */
  async loadRulesForWorkItem(
    workspaceId: string,
    data: { title: string; description: string; changedFiles: string[] },
  ): Promise<unknown> {
    return await http.post(ENDPOINTS.workspace.rulesLoad(workspaceId), data);
  },

  /** 规则总览 */
  async getRulesOverview(workspaceId: string): Promise<unknown> {
    return await http.get(ENDPOINTS.workspace.rulesOverview(workspaceId));
  },
};

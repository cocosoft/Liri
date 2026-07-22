import { httpLegacy as http } from "./httpClient";
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

// ========== Project 类型 ==========

/** 项目 */
export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: "active" | "paused" | "completed" | "archived";
  workItemIds: string[];
  rulesFile?: string;
  template?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  tags?: string[];
}

/** 项目看板列 */
export interface ProjectBoardColumn {
  id: string;
  title: string;
  items: WorkItem[];
}

/** 项目看板 */
export interface ProjectBoard {
  projectId: string;
  columns: ProjectBoardColumn[];
}

/** 工作项模板 */
export interface WorkItemTemplate {
  type: string;
  name: string;
  description: string;
  defaultTags?: string[];
  defaultPriority?: number;
  checklist?: string[];
  estimatedImpact?: string;
  riskWarnings?: string[];
}

/** 创建项目请求 */
export interface CreateProjectRequest {
  name: string;
  description?: string;
  template?: string;
  tags?: string[];
}

/** 更新项目请求 */
export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  status?: string;
  tags?: string[];
}

/** 按模板创建工作项请求 */
export interface CreateProjectWorkItemRequest {
  title: string;
  description?: string;
  type?: string;
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
    return await http.get<WorkspaceListItem[]>("/v1/workspaces");
  },

  /** 获取工作空间信息 */
  async getWorkspace(id: string): Promise<WorkspaceInfo | null> {
    try {
      return await http.get<WorkspaceInfo>(`/v1/workspaces/${id}`);
    } catch (err) {
      logger.warn("获取工作空间信息失败", err);
      return null;
    }
  },

  /** 创建新工作空间 */
  async createWorkspace(data: CreateWorkspaceRequest): Promise<WorkspaceInfo> {
    return await http.post<WorkspaceInfo>("/v1/workspaces", data);
  },

  /** 获取工作空间的 session 列表 */
  async getSessions(workspaceId: string): Promise<WorkspaceSession[]> {
    return await http.get<WorkspaceSession[]>(
      `/v1/workspaces/${workspaceId}/sessions`,
    );
  },

  /** 开启工作空间 session */
  async createSession(
    workspaceId: string,
    data?: CreateSessionRequest,
  ): Promise<WorkspaceSession> {
    return await http.post<WorkspaceSession>(
      `/v1/workspaces/${workspaceId}/sessions`,
      data || {},
    );
  },

  /** 获取工作项列表 */
  async getWorkItems(workspaceId: string): Promise<WorkItem[]> {
    return await http.get<WorkItem[]>(`/v1/workspaces/${workspaceId}/items`);
  },

  /** 创建工作项 */
  async createWorkItem(
    workspaceId: string,
    data: CreateWorkItemRequest,
  ): Promise<WorkItem> {
    return await http.post<WorkItem>(
      `/v1/workspaces/${workspaceId}/items`,
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
      `/v1/workspaces/${workspaceId}/items/${itemId}`,
      data,
    );
  },

  /** 检查后端 Workspace API 是否就绪 */
  async isBackendReady(): Promise<boolean> {
    try {
      await http.get<unknown>("/v1/workspaces");
      return true;
    } catch {
      return false;
    }
  },

  // ========== .liri/ 配置 API ==========

  /** 检测 .liri/ 目录 */
  async detectLiriDir(workspaceId: string): Promise<LiriDetectionResult> {
    return await http.get<LiriDetectionResult>(
      `/v1/workspaces/${workspaceId}/liri/detect`,
    );
  },

  /** 初始化 .liri/ 目录结构 */
  async initLiriDir(workspaceId: string): Promise<LiriDetectionResult> {
    return await http.post<LiriDetectionResult>(
      `/v1/workspaces/${workspaceId}/liri/init`,
    );
  },

  /** 获取工作空间配置摘要 */
  async getConfig(workspaceId: string): Promise<WorkspaceConfigSummary> {
    return await http.get<WorkspaceConfigSummary>(
      `/v1/workspaces/${workspaceId}/config`,
    );
  },

  /** 更新工作空间配置 */
  async updateConfig(
    workspaceId: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return await http.put<Record<string, unknown>>(
      `/v1/workspaces/${workspaceId}/config`,
      data,
    );
  },

  /** 获取工作空间规则 */
  async getRules(workspaceId: string): Promise<string> {
    return await http.get<string>(`/v1/workspaces/${workspaceId}/rules`);
  },

  /** 更新工作空间规则 */
  async updateRules(
    workspaceId: string,
    data: UpdateRulesRequest,
  ): Promise<{ success: boolean }> {
    return await http.put<{ success: boolean }>(
      `/v1/workspaces/${workspaceId}/rules`,
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
      `/v1/workspaces/${workspaceId}/items/${itemId}/changesets`,
    );
  },

  /** 创建变更集 */
  async createChangeSet(
    workspaceId: string,
    itemId: string,
    data: { description: string; files?: ChangeSetFile[] },
  ): Promise<ChangeSet> {
    return await http.post<ChangeSet>(
      `/v1/workspaces/${workspaceId}/items/${itemId}/changesets`,
      data,
    );
  },

  /** 获取变更集详情 */
  async getChangeSet(
    workspaceId: string,
    changesetId: string,
  ): Promise<ChangeSet> {
    return await http.get<ChangeSet>(
      `/v1/workspaces/${workspaceId}/changesets/${changesetId}`,
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
      `/v1/workspaces/${workspaceId}/changesets/${changesetId}/files`,
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
      `/v1/workspaces/${workspaceId}/changesets/${changesetId}`,
      data,
    );
  },

  /** 获取变更集统计摘要 */
  async getChangeSetSummary(
    workspaceId: string,
    changesetId: string,
  ): Promise<ChangeSetSummary> {
    return await http.get<ChangeSetSummary>(
      `/v1/workspaces/${workspaceId}/changesets/${changesetId}/summary`,
    );
  },

  // ========== 项目 API ==========

  /** 列出工作空间中的项目 */
  async listProjects(workspaceId: string): Promise<Project[]> {
    return await http.get<Project[]>(`/v1/workspaces/${workspaceId}/projects`);
  },

  /** 创建项目 */
  async createProject(
    workspaceId: string,
    data: CreateProjectRequest,
  ): Promise<Project> {
    return await http.post<Project>(
      `/v1/workspaces/${workspaceId}/projects`,
      data,
    );
  },

  /** 获取项目详情 */
  async getProject(workspaceId: string, projectId: string): Promise<Project> {
    return await http.get<Project>(
      `/v1/workspaces/${workspaceId}/projects/${projectId}`,
    );
  },

  /** 更新项目 */
  async updateProject(
    workspaceId: string,
    projectId: string,
    data: UpdateProjectRequest,
  ): Promise<Project> {
    return await http.patch<Project>(
      `/v1/workspaces/${workspaceId}/projects/${projectId}`,
      data,
    );
  },

  /** 删除项目 */
  async deleteProject(
    workspaceId: string,
    projectId: string,
  ): Promise<{ success: boolean }> {
    return await http.delete<{ success: boolean }>(
      `/v1/workspaces/${workspaceId}/projects/${projectId}`,
    );
  },

  /** 获取项目看板 */
  async getProjectBoard(
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectBoard> {
    return await http.get<ProjectBoard>(
      `/v1/workspaces/${workspaceId}/projects/${projectId}/board`,
    );
  },

  /** 获取项目级规则 */
  async getProjectRules(
    workspaceId: string,
    projectId: string,
  ): Promise<{ content: string }> {
    return await http.get<{ content: string }>(
      `/v1/workspaces/${workspaceId}/projects/${projectId}/rules`,
    );
  },

  /** 更新项目级规则 */
  async updateProjectRules(
    workspaceId: string,
    projectId: string,
    data: { content: string },
  ): Promise<{ success: boolean }> {
    return await http.put<{ success: boolean }>(
      `/v1/workspaces/${workspaceId}/projects/${projectId}/rules`,
      data,
    );
  },

  /** 获取工作项模板列表 */
  async getTemplates(workspaceId: string): Promise<WorkItemTemplate[]> {
    return await http.get<WorkItemTemplate[]>(
      `/v1/workspaces/${workspaceId}/templates`,
    );
  },

  /** 按模板创建工作项 */
  async createProjectWorkItem(
    workspaceId: string,
    projectId: string,
    data: CreateProjectWorkItemRequest,
  ): Promise<WorkItem> {
    return await http.post<WorkItem>(
      `/v1/workspaces/${workspaceId}/projects/${projectId}/items`,
      data,
    );
  },

  // ========== 编排 API ==========

  /** 获取编排快照 */
  async getOrchestrationSnapshot(
    workspaceId: string,
    itemId: string,
  ): Promise<Record<string, unknown>> {
    return await http.get<Record<string, unknown>>(
      `/v1/workspaces/${workspaceId}/items/${itemId}/orchestration`,
    );
  },

  // ========== Swarm API ==========

  /** 获取 Swarm 群组状态 */
  async getSwarmStatus(workspaceId: string): Promise<Record<string, unknown>> {
    return await http.get<Record<string, unknown>>(
      `/v1/workspaces/${workspaceId}/swarm`,
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
    return await http.get(`/v1/workspaces/${workspaceId}/agent-model-bindings`);
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
      `/v1/workspaces/${workspaceId}/agent-model-bindings`,
      data as Record<string, unknown>,
    );
  },

  // ========== 团队 API ==========

  /** 获取团队列表 */
  async getTeams(workspaceId: string): Promise<unknown[]> {
    return await http.get(`/v1/workspaces/${workspaceId}/teams`);
  },

  /** 创建团队 */
  async createTeam(
    workspaceId: string,
    data: { name: string; description?: string; members?: unknown[] },
  ): Promise<unknown> {
    return await http.post(
      `/v1/workspaces/${workspaceId}/teams`,
      data as Record<string, unknown>,
    );
  },

  /** 获取团队详情 */
  async getTeam(workspaceId: string, teamId: string): Promise<unknown> {
    return await http.get(`/v1/workspaces/${workspaceId}/teams/${teamId}`);
  },

  /** 更新团队 */
  async updateTeam(
    workspaceId: string,
    teamId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return await http.put(
      `/v1/workspaces/${workspaceId}/teams/${teamId}`,
      data,
    );
  },

  /** 删除团队 */
  async deleteTeam(
    workspaceId: string,
    teamId: string,
  ): Promise<{ success: boolean }> {
    return await http.delete(`/v1/workspaces/${workspaceId}/teams/${teamId}`);
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
      `/v1/workspaces/${workspaceId}/teams/${teamId}/members`,
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
      `/v1/workspaces/${workspaceId}/teams/${teamId}/members/${memberId}`,
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
      `/v1/workspaces/${workspaceId}/teams/${teamId}/members/${memberId}/role`,
      { role },
    );
  },

  // ========== 成本 API ==========

  /** 获取成本报告 */
  async getCostReport(workspaceId: string): Promise<unknown> {
    return await http.get(`/v1/workspaces/${workspaceId}/cost/report`);
  },

  /** 获取预算状态 */
  async getBudgetStatus(workspaceId: string): Promise<unknown> {
    return await http.get(`/v1/workspaces/${workspaceId}/cost/budget`);
  },

  // ========== 工作项搜索 API ==========

  /** 搜索工作项 */
  async searchWorkItems(
    workspaceId: string,
    query: Record<string, unknown>,
  ): Promise<unknown> {
    return await http.post(`/v1/workspaces/${workspaceId}/items/search`, query);
  },

  /** 获取工作项回顾摘要 */
  async getWorkItemReview(workspaceId: string): Promise<unknown> {
    return await http.get(`/v1/workspaces/${workspaceId}/items/review`);
  },

  // ========== 工作流模板 API ==========

  /** 获取工作流模板列表 */
  async getWorkflowTemplates(): Promise<unknown[]> {
    return await http.get("/v1/workflows/templates");
  },

  /** 获取工作流模板详情 */
  async getWorkflowTemplate(templateId: string): Promise<unknown> {
    return await http.get(`/v1/workflows/templates/${templateId}`);
  },

  /** 创建工作流模板 */
  async createWorkflowTemplate(
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return await http.post("/v1/workflows/templates", data);
  },

  /** 更新工作流模板 */
  async updateWorkflowTemplate(
    templateId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return await http.put(`/v1/workflows/templates/${templateId}`, data);
  },

  /** 删除工作流模板 */
  async deleteWorkflowTemplate(
    templateId: string,
  ): Promise<{ success: boolean }> {
    return await http.delete(`/v1/workflows/templates/${templateId}`);
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
    return await http.post(`/v1/workspaces/${workspaceId}/council`, data);
  },

  /** 获取 Council 会话 */
  async getCouncil(
    workspaceId: string,
    sessionId: string,
  ): Promise<import("@/types/council").CouncilSession> {
    return await http.get(`/v1/workspaces/${workspaceId}/council/${sessionId}`);
  },

  /** 列出活跃的 Council 会话 */
  async listCouncils(
    workspaceId: string,
  ): Promise<import("@/types/council").CouncilSession[]> {
    return await http.get(`/v1/workspaces/${workspaceId}/council`);
  },

  // ==================== 编排智能 API ====================

  /** 变更影响评估 */
  async analyzeImpact(
    workspaceId: string,
    data: { changedFiles: string[]; changedContent: string },
  ): Promise<unknown> {
    return await http.post(
      `/v1/workspaces/${workspaceId}/intelligence/impact`,
      data,
    );
  },

  /** 风险识别 */
  async detectRisks(
    workspaceId: string,
    data: { title: string; description: string; changedFiles: string[] },
  ): Promise<unknown> {
    return await http.post(
      `/v1/workspaces/${workspaceId}/intelligence/risks`,
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
      `/v1/workspaces/${workspaceId}/intelligence/decision`,
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
      `/v1/workspaces/${workspaceId}/intelligence/escalate`,
      data,
    );
  },

  /** 获取活跃异常 */
  async getEscalations(workspaceId: string): Promise<unknown> {
    return await http.get(
      `/v1/workspaces/${workspaceId}/intelligence/escalations`,
    );
  },

  /** 资源调度 */
  async scheduleResource(
    workspaceId: string,
    data: { workItemId: string; resources: string[]; priority: number },
  ): Promise<unknown> {
    return await http.post(
      `/v1/workspaces/${workspaceId}/intelligence/schedule`,
      data,
    );
  },

  /** 获取资源状态 */
  async getResources(workspaceId: string): Promise<unknown> {
    return await http.get(
      `/v1/workspaces/${workspaceId}/intelligence/resources`,
    );
  },

  // ==================== 规则管理 API ====================

  /** 列出所有规则 */
  async listRules(workspaceId: string): Promise<unknown> {
    return await http.get(`/v1/workspaces/${workspaceId}/rules`);
  },

  /** 读取规则 */
  async getRule(workspaceId: string, specialization: string): Promise<unknown> {
    return await http.get(
      `/v1/workspaces/${workspaceId}/rules/${specialization}`,
    );
  },

  /** 写入规则 */
  async writeRule(
    workspaceId: string,
    specialization: string,
    content: string,
  ): Promise<unknown> {
    return await http.put(
      `/v1/workspaces/${workspaceId}/rules/${specialization}`,
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
      `/v1/workspaces/${workspaceId}/rules/${specialization}`,
      { content },
    );
  },

  /** 按工作项加载规则 */
  async loadRulesForWorkItem(
    workspaceId: string,
    data: { title: string; description: string; changedFiles: string[] },
  ): Promise<unknown> {
    return await http.post(`/v1/workspaces/${workspaceId}/rules/load`, data);
  },

  /** 规则总览 */
  async getRulesOverview(workspaceId: string): Promise<unknown> {
    return await http.get(`/v1/workspaces/${workspaceId}/rules/overview`);
  },
};

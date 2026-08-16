import { httpLegacy as http } from "./httpClient";
import { handleClientError } from "../utils/handleError";
import { getBackendBaseUrl, getApiSecret } from "./backendUrl";

export type SkillStatus = "enabled" | "disabled" | "draft";

export type SkillSource =
  | "builtin"
  | "official"
  | "third_party"
  | "user"
  | "project"
  | "plugin"
  | "mcp"
  | "bundled";

export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  default?: unknown;
  description?: string;
}

/** 技能内容数据（SKILL.md 解析结果） */
export interface SkillContent {
  content: string;
  rawContent: string;
  frontmatter: Record<string, unknown>;
  linkedFiles: string[];
}

/** 关联文件条目 */
export interface SkillFileEntry {
  path: string;
  name: string;
  isDir: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  status: SkillStatus;
  category: string;
  parameters: SkillParameter[];
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  lastUsedAt: number | null;
  source?: SkillSource;
  version?: string;
  modified?: boolean;
  /** SKILL.md 正文（去除 frontmatter） */
  content?: string;
  /** 含 frontmatter 的原始文本 */
  rawContent?: string;
  /** YAML frontmatter 解析结果 */
  frontmatter?: Record<string, unknown>;
  /** 技能文件路径 */
  filePath?: string;
  /** 关联文件列表 */
  linkedFiles?: string[];
}

export interface SkillListParams {
  category?: string;
  status?: SkillStatus;
  source?: SkillSource;
  sortBy?: "createdAt" | "updatedAt" | "usageCount";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface SkillCreateData {
  name: string;
  description: string;
  category: string;
  parameters: SkillParameter[];
}

// ===============================
// 合并自 skillMarketService
// ===============================

/** ClawHub 技能元数据接口 */
export interface ClawHubSkillMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  category?: string;
  tags?: string[];
  icon?: string;
  readme?: string;
  dependencies?: string[];
  permissions?: string[];
  manifestVersion?: string;
  source?: string;
}

/** 已安装技能接口 */
export interface InstalledSkill {
  meta: ClawHubSkillMeta;
  installPath: string;
  installedAt: number;
  updatedAt: number;
  enabled: boolean;
  files: string[];
  sourceUrl?: string;
  /** 是否有可用更新 */
  hasUpdate?: boolean;
}

/** 技能搜索结果接口 */
export interface SkillSearchResult {
  skill: ClawHubSkillMeta;
  source: string;
  score?: number;
  installed?: boolean;
}

/** 分类信息接口 */
export interface SkillCategory {
  id: string;
  capability: string;
  description: string;
  count: number;
}

/** 技能来源分布统计 */
export interface SourceDistribution {
  [source: string]: number;
}

/** 推荐技能响应接口 */
export interface RecommendedResponse {
  recommended: SkillSearchResult[];
  categories: Record<string, number>;
  sourceDistribution?: SourceDistribution;
}

/** 技能分类列表响应接口 */
export interface CategoryListResponse {
  categories: SkillCategory[];
  sourceDistribution?: SourceDistribution;
}

const skillService = {
  // ── 本地技能 CRUD ──

  async list(
    params?: SkillListParams,
  ): Promise<{ skills: Skill[]; total: number }> {
    const url = new URL("/v1/skills/system", getBackendBaseUrl());
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }
    const response = await http.get<{ skills: Skill[]; total: number }>(
      url.pathname + url.search,
    );
    return response;
  },

  async get(id: string): Promise<Skill> {
    const response = await http.get<Skill>(`/v1/skills/${id}`);
    return response;
  },

  async create(data: SkillCreateData): Promise<Skill> {
    // S2-1：后端要求显式 action 字段（此前缺失导致 400）
    const response = await http.post<Skill>("/v1/skills", {
      action: "create",
      name: data.name,
      description: data.description,
      category: data.category,
    });
    return response;
  },

  async update(id: string, updates: Partial<Skill>): Promise<Skill> {
    const response = await http.put<Skill>(`/v1/skills/${id}`, updates);
    return response;
  },

  async delete(id: string): Promise<void> {
    await http.delete(`/v1/skills/${id}`);
  },

  async enable(id: string): Promise<Skill> {
    const response = await http.post<Skill>(`/v1/skills/${id}/enable`);
    return response;
  },

  async disable(id: string): Promise<Skill> {
    const response = await http.post<Skill>(`/v1/skills/${id}/disable`);
    return response;
  },

  async getCategories(): Promise<string[]> {
    const response = await http.get<{
      categories: Array<{ id: string; capability: string }>;
      sourceDistribution: Record<string, number>;
    }>("/v1/skills/categories");
    if (Array.isArray(response)) {
      return response.map((c) =>
        typeof c === "string"
          ? c
          : (c as SkillCategory).id || (c as SkillCategory).capability || "",
      );
    }
    if (response && Array.isArray(response.categories)) {
      return response.categories.map((c) => c.id || c.capability);
    }
    return [];
  },

  /** 获取技能的 SKILL.md 内容 */
  async getContent(id: string): Promise<SkillContent> {
    const response = await http.get<SkillContent>(
      `/v1/skills/system/${encodeURIComponent(id)}/content`,
    );
    return response;
  },

  /** 获取技能关联文件列表 */
  async getFiles(id: string): Promise<SkillFileEntry[]> {
    const response = await http.get<{ files: SkillFileEntry[] }>(
      `/v1/skills/${id}/files`,
    );
    return response.files ?? [];
  },

  /** 获取关联文件内容 */
  async getFileContent(skillId: string, filePath: string): Promise<string> {
    const response = await http.get<{ content: string }>(
      `/v1/skills/system/${encodeURIComponent(skillId)}/files/content?path=${encodeURIComponent(filePath)}`,
    );
    return response.content;
  },

  // ── 市场 API（合并自 skillMarketService） ──

  /** 搜索技能 */
  async searchMarket(
    query: string,
    category?: string,
    tags?: string[],
    source?: string,
  ): Promise<SkillSearchResult[]> {
    const params: Record<string, unknown> = {};
    if (query) params.q = query;
    if (category) params.category = category;
    if (tags?.length) params.tags = tags.join(",");
    if (source) params.source = source;

    const res = await http.get<{ results: SkillSearchResult[] }>(
      "/v1/skills/search",
      { params },
    );
    return res.results || [];
  },

  /** 获取已安装技能列表（市场） */
  async getMarketInstalled(): Promise<InstalledSkill[]> {
    const res = await http.get<{ skills: InstalledSkill[] }>("/v1/skills");
    return res.skills || [];
  },

  /** 获取技能详情（市场） */
  async getMarketDetail(
    skillId: string,
  ): Promise<{ skill: InstalledSkill; remoteVersion?: string | null } | null> {
    try {
      const res = await http.get<{
        skill: InstalledSkill;
        remoteVersion?: string | null;
      }>(`/v1/skills/${encodeURIComponent(skillId)}`);
      return res || null;
    } catch (e) {
      handleClientError(e, {
        module: "services:skill",
        action: "getMarketDetail",
      });
      return null;
    }
  },

  /** 安装技能 */
  async installMarket(
    skillId: string,
    sourceUrl?: string,
  ): Promise<InstalledSkill> {
    const res = await http.post<{ success: boolean; skill: InstalledSkill }>(
      "/v1/skills/install",
      { skillId, sourceUrl },
    );
    return res.skill;
  },

  /** 卸载技能 */
  async uninstallMarket(skillId: string): Promise<void> {
    await http.post(`/v1/skills/${encodeURIComponent(skillId)}/uninstall`);
  },

  /** 更新技能 */
  async updateMarket(skillId: string): Promise<InstalledSkill> {
    const res = await http.post<{ success: boolean; skill: InstalledSkill }>(
      `/v1/skills/${encodeURIComponent(skillId)}/update`,
    );
    return res.skill;
  },

  /** 获取推荐技能列表 */
  async getRecommended(limit = 10): Promise<RecommendedResponse> {
    const res = await http.get<RecommendedResponse>("/v1/skills/recommended", {
      params: { limit },
    });
    return {
      recommended: res.recommended || [],
      categories: res.categories || {},
      sourceDistribution: res.sourceDistribution,
    };
  },

  /** 获取技能分类列表（市场） */
  async getMarketCategories(): Promise<CategoryListResponse> {
    const res = await http.get<CategoryListResponse>("/v1/skills/categories");
    return {
      categories: res.categories || [],
      sourceDistribution: res.sourceDistribution,
    };
  },

  /** 切换技能启用状态 */
  async toggleMarketEnabled(skillId: string, enabled: boolean): Promise<void> {
    await http.post(`/v1/skills/${encodeURIComponent(skillId)}/toggle`, {
      enabled,
    });
  },

  /** 导出所有技能为 ZIP 并触发浏览器下载（S2-1：后端返回 zip 二进制，非 JSON） */
  async exportAll(): Promise<Blob> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const secret = getApiSecret();
    if (secret) headers["X-API-Key"] = secret;
    if (typeof localStorage !== "undefined") {
      const authToken = localStorage.getItem("liri-auth-token");
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    }
    const res = await fetch(`${getBackendBaseUrl()}/v1/skills/export`, {
      headers,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.blob();
  },

  /** 获取可用技能市场来源列表 */
  async getSources(): Promise<string[]> {
    const res = await http.get<{ sources: string[] }>("/v1/skills/sources");
    return res.sources || [];
  },

  /** 添加自定义技能市场来源 */
  async addSource(name: string, apiBaseUrl: string): Promise<string[]> {
    const res = await http.post<{ success: boolean; sources: string[] }>(
      "/v1/skills/sources",
      { name, apiBaseUrl },
    );
    return res.sources || [];
  },

  /** 移除自定义技能市场来源 */
  async removeSource(name: string): Promise<string[]> {
    const res = await http.delete<{ success: boolean; sources: string[] }>(
      `/v1/skills/sources/${encodeURIComponent(name)}`,
    );
    return res.sources || [];
  },

  /** 批量导入技能（JSON 格式） */
  async importSkills(
    skills: Array<{ name: string; description?: string; category?: string }>,
  ): Promise<void> {
    await http.post("/v1/skills/import", { skills });
  },

  /** 导入技能（ZIP 格式，base64 传输；返回是否含敏感权限需审批） */
  async importSkillZip(
    zipBase64: string,
  ): Promise<{ success: boolean; skillId: string; requiresApproval: boolean }> {
    const res = await http.post<{
      success: boolean;
      skillId: string;
      requiresApproval: boolean;
    }>("/v1/skills/import", { zipBase64 });
    return res;
  },

  /** 克隆技能（S2-1：后端返回 { success, skillId }） */
  async cloneSkill(skillId: string): Promise<string> {
    const res = await http.post<{ success: boolean; skillId: string }>(
      `/v1/skills/${encodeURIComponent(skillId)}/clone`,
    );
    return res.skillId;
  },
};

export { skillService };

import { http } from "./httpClient";

/**
 * ClawHub 技能元数据接口
 */
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

/**
 * 已安装技能接口
 */
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

/**
 * 技能搜索结果接口
 */
export interface SkillSearchResult {
  skill: ClawHubSkillMeta;
  source: string;
  score?: number;
  installed?: boolean;
}

/**
 * 分类信息接口
 */
export interface SkillCategory {
  id: string;
  capability: string;
  description: string;
  count: number;
}

/**
 * 技能来源分布统计
 */
export interface SourceDistribution {
  [source: string]: number;
}

/**
 * 推荐技能响应接口
 */
export interface RecommendedResponse {
  recommended: SkillSearchResult[];
  categories: Record<string, number>;
  sourceDistribution?: SourceDistribution;
}

/**
 * 技能分类列表响应接口
 */
export interface CategoryListResponse {
  categories: SkillCategory[];
  sourceDistribution?: SourceDistribution;
}

class SkillMarketService {
  /**
   * 搜索技能
   * @param query 搜索关键词
   * @param category 按类别筛选
   * @param tags 按标签筛选
   */
  async search(
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
  }

  /**
   * 获取已安装技能列表
   */
  async getInstalledSkills(): Promise<InstalledSkill[]> {
    const res = await http.get<{ skills: InstalledSkill[] }>("/v1/skills");
    return res.skills || [];
  }

  /**
   * 获取技能详情
   * @param skillId 技能 ID
   */
  async getSkillDetail(skillId: string): Promise<InstalledSkill | null> {
    try {
      const res = await http.get<{ skill: InstalledSkill }>(
        `/v1/skills/${encodeURIComponent(skillId)}`,
      );
      return res.skill || null;
    } catch {
      return null;
    }
  }

  /**
   * 安装技能
   * @param skillId 技能 ID
   * @param sourceUrl 自定义来源 URL（可选）
   */
  async install(skillId: string, sourceUrl?: string): Promise<InstalledSkill> {
    const res = await http.post<{ success: boolean; skill: InstalledSkill }>(
      "/v1/skills/install",
      { skillId, sourceUrl },
    );
    return res.skill;
  }

  /**
   * 卸载技能
   * @param skillId 技能 ID
   */
  async uninstall(skillId: string): Promise<void> {
    await http.post(`/v1/skills/${encodeURIComponent(skillId)}/uninstall`);
  }

  /**
   * 更新技能
   * @param skillId 技能 ID
   */
  async update(skillId: string): Promise<InstalledSkill> {
    const res = await http.post<{ success: boolean; skill: InstalledSkill }>(
      `/v1/skills/${encodeURIComponent(skillId)}/update`,
    );
    return res.skill;
  }

  /**
   * 获取推荐技能列表
   * @param limit 返回数量限制
   */
  async getRecommended(limit = 10): Promise<RecommendedResponse> {
    const res = await http.get<RecommendedResponse>("/v1/skills/recommended", {
      params: { limit },
    });
    return {
      recommended: res.recommended || [],
      categories: res.categories || {},
      sourceDistribution: res.sourceDistribution,
    };
  }

  /**
   * 获取技能分类列表
   */
  async getCategories(): Promise<CategoryListResponse> {
    const res = await http.get<CategoryListResponse>("/v1/skills/categories");
    return {
      categories: res.categories || [],
      sourceDistribution: res.sourceDistribution,
    };
  }

  /**
   * 切换技能启用状态
   */
  async toggleEnabled(skillId: string, enabled: boolean): Promise<void> {
    await http.post(`/v1/skills/${encodeURIComponent(skillId)}/toggle`, {
      enabled,
    });
  }

  /** 导出所有已安装技能为 JSON */
  async exportAll(): Promise<InstalledSkill[]> {
    const res = await http.get<{ skills: InstalledSkill[] }>(
      "/v1/skills/export",
    );
    return res.skills || [];
  }

  /** 获取可用技能市场来源列表 */
  async getSources(): Promise<string[]> {
    const res = await http.get<{ sources: string[] }>("/v1/skills/sources");
    return res.sources || [];
  }

  /** 添加自定义技能市场来源 */
  async addSource(name: string, apiBaseUrl: string): Promise<string[]> {
    const res = await http.post<{ success: boolean; sources: string[] }>(
      "/v1/skills/sources",
      { name, apiBaseUrl },
    );
    return res.sources || [];
  }

  /** 移除自定义技能市场来源 */
  async removeSource(name: string): Promise<string[]> {
    const res = await http.delete<{ success: boolean; sources: string[] }>(
      `/v1/skills/sources/${encodeURIComponent(name)}`,
    );
    return res.sources || [];
  }

  /** 批量导入技能（JSON 格式） */
  async importSkills(
    skills: Array<{ name: string; description?: string; category?: string }>,
  ): Promise<void> {
    await http.post("/v1/skills/import", { skills });
  }

  /** 克隆技能 */
  async clone(skillId: string): Promise<InstalledSkill> {
    const res = await http.post<{ skill: InstalledSkill }>(
      `/v1/skills/${encodeURIComponent(skillId)}/clone`,
    );
    return res.skill;
  }
}

export const skillMarketService = new SkillMarketService();

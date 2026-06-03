import { http } from './httpClient';

export type SkillStatus = 'enabled' | 'disabled' | 'draft';

export type SkillSource = 'builtin' | 'user' | 'project' | 'plugin' | 'mcp' | 'bundled';

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
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
  sortBy?: 'createdAt' | 'updatedAt' | 'usageCount';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface SkillCreateData {
  name: string;
  description: string;
  category: string;
  parameters: SkillParameter[];
}

const skillService = {
  async list(params?: SkillListParams): Promise<{ skills: Skill[]; total: number }> {
    const url = new URL('/v1/skills/system', 'http://localhost');
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }
    const response = await http.get<{ skills: Skill[]; total: number }>(url.pathname + url.search);
    return response;
  },

  async get(id: string): Promise<Skill> {
    const response = await http.get<Skill>(`/v1/skills/${id}`);
    return response;
  },

  async create(data: SkillCreateData): Promise<Skill> {
    const response = await http.post<Skill>('/v1/skills', data);
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
    const response = await http.get<{ categories: Array<{ id: string; capability: string }>; sourceDistribution: Record<string, number> }>('/v1/skills/categories');
    if (Array.isArray(response)) {
      return response.map((c) => (typeof c === 'string' ? c : (c as any).id || (c as any).capability || ''));
    }
    if (response && Array.isArray(response.categories)) {
      return response.categories.map((c) => c.id || c.capability);
    }
    return [];
  },

  /** 获取技能的 SKILL.md 内容 */
  async getContent(id: string): Promise<SkillContent> {
    const response = await http.get<SkillContent>(`/v1/skills/system/${encodeURIComponent(id)}/content`);
    return response;
  },

  /** 获取技能关联文件列表 */
  async getFiles(id: string): Promise<SkillFileEntry[]> {
    const response = await http.get<{ files: SkillFileEntry[] }>(`/v1/skills/${id}/files`);
    return response.files ?? [];
  },

  /** 获取关联文件内容 */
  async getFileContent(skillId: string, filePath: string): Promise<string> {
    const response = await http.get<{ content: string }>(
      `/v1/skills/system/${encodeURIComponent(skillId)}/files/content?path=${encodeURIComponent(filePath)}`
    );
    return response.content;
  },
};

export { skillService };
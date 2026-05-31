import { http } from './httpClient';

export type SkillStatus = 'enabled' | 'disabled' | 'draft';

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: unknown;
  description?: string;
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
    const url = new URL('/v1/skills', 'http://localhost');
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
    const response = await http.get<string[]>('/v1/skills/categories');
    return response;
  },
};

export { skillService };
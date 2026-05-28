import { create } from 'zustand';
import { skillService, type Skill, type SkillCreateData, type SkillListParams } from '../services/skillService';

interface SkillStore {
  skills: Skill[];
  total: number;
  selectedSkill: Skill | null;
  categories: string[];
  isLoading: boolean;
  error: string | null;

  loadSkills: (params?: SkillListParams) => Promise<void>;
  getSkill: (id: string) => Promise<void>;
  createSkill: (data: SkillCreateData) => Promise<void>;
  updateSkill: (id: string, updates: Partial<Skill>) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  enableSkill: (id: string) => Promise<void>;
  disableSkill: (id: string) => Promise<void>;
  loadCategories: () => Promise<void>;
  setSelectedSkill: (skill: Skill | null) => void;
  clearError: () => void;
}

export const useSkillStore = create<SkillStore>((set) => ({
  skills: [],
  total: 0,
  selectedSkill: null,
  categories: [],
  isLoading: false,
  error: null,

  loadSkills: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const result = await skillService.list(params);
      set({ skills: result.skills, total: result.total });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取技能列表失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  getSkill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const skill = await skillService.get(id);
      set({ selectedSkill: skill });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取技能详情失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  createSkill: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.create(data);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '创建技能失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  updateSkill: async (id, updates) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.update(id, updates);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '更新技能失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  deleteSkill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.delete(id);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '删除技能失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  enableSkill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.enable(id);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '启用技能失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  disableSkill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.disable(id);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '禁用技能失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  loadCategories: async () => {
    try {
      const categories = await skillService.getCategories();
      set({ categories });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取技能分类失败' });
    }
  },

  setSelectedSkill: (skill) => set({ selectedSkill: skill }),

  clearError: () => set({ error: null }),
}));

export { skillService } from '../services/skillService';
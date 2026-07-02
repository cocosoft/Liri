import { create } from "zustand";
import {
  skillService,
  type Skill,
  type SkillCreateData,
  type SkillListParams,
  type SkillSearchResult,
  type InstalledSkill,
  type SkillCategory,
} from "../services/skillService";

// ─── 技能市场筛选类型 ──────────────────────────────────

type SourceFilter = string;

// ─── 技能市场统计类型 ──────────────────────────────────

interface SkillMarketStats {
  installedTotal: number;
  installedEnabled: number;
  installedDisabled: number;
  updatableCount: number;
}

// ─── Unified SkillStore 接口 ──────────────────────────

interface UnifiedSkillStore {
  // ── 本地技能状态 ──
  skills: Skill[];
  total: number;
  selectedSkill: Skill | null;
  categories: string[];
  isLoading: boolean;
  error: string | null;

  // ── 技能市场状态 ──
  searchResults: SkillSearchResult[];
  recommended: SkillSearchResult[];
  marketInstalled: InstalledSkill[];
  marketCategories: SkillCategory[];
  availableSources: string[];
  marketSource: string;
  searchQuery: string;
  categoryFilter: string;
  sourceFilter: SourceFilter;
  hasSearched: boolean;
  page: number;
  pageSize: number;
  operatingId: string | null;
  updatingIds: Set<string>;

  // ── 本地技能操作 ──
  loadSkills: (params?: SkillListParams) => Promise<void>;
  getSkill: (id: string) => Promise<void>;
  createSkill: (data: SkillCreateData) => Promise<void>;
  updateSkill: (id: string, updates: Partial<Skill>) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  enableSkill: (id: string) => Promise<void>;
  disableSkill: (id: string) => Promise<void>;
  loadCategories: () => Promise<void>;
  setSelectedSkill: (skill: Skill | null) => void;

  // ── 技能市场操作 ──
  searchMarket: (query: string, category?: string, source?: string) => Promise<void>;
  loadMarketInstalled: () => Promise<void>;
  loadRecommended: () => Promise<void>;
  loadMarketCategories: () => Promise<void>;
  loadSources: () => Promise<void>;
  addCustomSource: (name: string, apiBaseUrl: string) => Promise<void>;
  removeCustomSource: (name: string) => Promise<void>;
  installMarketSkill: (skillId: string) => Promise<void>;
  uninstallMarketSkill: (skillId: string) => Promise<void>;
  updateMarketSkill: (skillId: string) => Promise<void>;
  updateAllMarketSkills: () => Promise<void>;
  toggleMarketSkill: (skillId: string, enabled: boolean) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setCategoryFilter: (category: string) => void;
  setSourceFilter: (source: SourceFilter) => void;
  setMarketSource: (source: string) => void;
  setPage: (page: number) => void;

  // ── 通用 ──
  clearError: () => void;

  // ── 查询方法 ──
  isMarketInstalled: (id: string) => boolean;
  isMarketEnabled: (id: string) => boolean;
  getMarketStats: () => SkillMarketStats;
  hasMarketUpdates: () => boolean;
}

// ─── 统计计算 ──────────────────────────────────────────

function computeStats(installed: InstalledSkill[]): SkillMarketStats {
  const updatable = installed.filter((s) => s.hasUpdate);
  return {
    installedTotal: installed.length,
    installedEnabled: installed.filter((s) => s.enabled).length,
    installedDisabled: installed.filter((s) => !s.enabled).length,
    updatableCount: updatable.length,
  };
}

// ─── 内存中的 hasUpdate 追踪 ──────────────────────────

const INSTALLED_TIMESTAMPS_KEY = "pyapp_skill_installed_timestamps";
const UPDATE_CHECK_MS = 7 * 24 * 60 * 60 * 1000;

/** Bug 6: 从 localStorage 加载已安装时间戳，避免重启后失效 */
function loadTimestamps(): Map<string, number> {
  try {
    const raw = localStorage.getItem(INSTALLED_TIMESTAMPS_KEY);
    if (raw) {
      return new Map(JSON.parse(raw));
    }
  } catch {
    // 解析失败则重新开始
  }
  return new Map();
}

function saveTimestamps(timestamps: Map<string, number>): void {
  try {
    localStorage.setItem(
      INSTALLED_TIMESTAMPS_KEY,
      JSON.stringify([...timestamps.entries()]),
    );
  } catch {
    // localStorage 不可用时静默降级
  }
}

const installedTimestamps = loadTimestamps();

function checkHasUpdate(skill: InstalledSkill): boolean {
  if (!installedTimestamps.has(skill.meta.id)) {
    installedTimestamps.set(skill.meta.id, skill.installedAt);
    saveTimestamps(installedTimestamps);
    return false;
  }
  return Date.now() - installedTimestamps.get(skill.meta.id)! > UPDATE_CHECK_MS;
}

// ─── Store 实现 ────────────────────────────────────────

export const useSkillStore = create<UnifiedSkillStore>((set, get) => ({
  // ── 本地技能初始状态 ──
  skills: [],
  total: 0,
  selectedSkill: null,
  categories: [],
  isLoading: false,
  error: null,

  // ── 技能市场初始状态 ──
  searchResults: [],
  recommended: [],
  marketInstalled: [],
  marketCategories: [],
  availableSources: [],
  marketSource: "",
  searchQuery: "",
  categoryFilter: "all",
  sourceFilter: "all",
  hasSearched: false,
  page: 1,
  pageSize: 12,
  operatingId: null,
  updatingIds: new Set(),

  // ── 本地技能操作 ──

  loadSkills: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const result = await skillService.list(params);
      set({ skills: result.skills, total: result.total });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "获取技能列表失败" });
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
      set({ error: e instanceof Error ? e.message : "获取技能详情失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  createSkill: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.create(data);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "创建技能失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  updateSkill: async (id, updates) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.update(id, updates);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "更新技能失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  deleteSkill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.delete(id);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "删除技能失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  enableSkill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.enable(id);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "启用技能失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  disableSkill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.disable(id);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "禁用技能失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  loadCategories: async () => {
    try {
      const categories = await skillService.getCategories();
      set({ categories });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "获取技能分类失败" });
    }
  },

  setSelectedSkill: (skill) => set({ selectedSkill: skill }),

  // ── 技能市场操作 ──

  searchMarket: async (query, category, source) => {
    set({ isLoading: true, error: null, hasSearched: true });
    try {
      const cat = category && category !== "all" ? category : undefined;
      const src = source || get().marketSource || undefined;
      const results = await skillService.searchMarket(query, cat, undefined, src);
      set({ searchResults: results, page: 1 });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "搜索失败",
        searchResults: [],
      });
    } finally {
      set({ isLoading: false });
    }
  },

  loadMarketInstalled: async () => {
    set({ error: null });
    try {
      const skills = await skillService.getMarketInstalled();
      set({ marketInstalled: skills });
    } catch {
      // 静默失败，保留上次数据
    }
  },

  loadRecommended: async () => {
    try {
      const res = await skillService.getRecommended(6);
      set({ recommended: res.recommended });
    } catch {
      // 静默失败
    }
  },

  loadMarketCategories: async () => {
    try {
      const res = await skillService.getMarketCategories();
      set({ marketCategories: res.categories });
    } catch {
      // 静默失败
    }
  },

  loadSources: async () => {
    try {
      const sources = await skillService.getSources();
      set({ availableSources: sources });
    } catch {
      // 静默失败
    }
  },

  addCustomSource: async (name, apiBaseUrl) => {
    try {
      const sources = await skillService.addSource(name, apiBaseUrl);
      set({ availableSources: sources });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "添加失败" });
    }
  },

  removeCustomSource: async (name) => {
    try {
      const sources = await skillService.removeSource(name);
      set({ availableSources: sources, marketSource: "" });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "移除失败" });
    }
  },

  installMarketSkill: async (skillId) => {
    set({ operatingId: skillId, error: null });
    try {
      await skillService.installMarket(skillId);
      await get().loadMarketInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "安装失败" });
      throw e;
    } finally {
      set({ operatingId: null });
    }
  },

  uninstallMarketSkill: async (skillId) => {
    set({ operatingId: skillId, error: null });
    try {
      await skillService.uninstallMarket(skillId);
      await get().loadMarketInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "卸载失败" });
      throw e;
    } finally {
      set({ operatingId: null });
    }
  },

  updateMarketSkill: async (skillId) => {
    const { updatingIds } = get();
    set({ updatingIds: new Set([...updatingIds, skillId]), error: null });
    try {
      await skillService.updateMarket(skillId);
      installedTimestamps.set(skillId, Date.now());
      await get().loadMarketInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "更新失败" });
      throw e;
    } finally {
      const next = new Set(get().updatingIds);
      next.delete(skillId);
      set({ updatingIds: next });
    }
  },

  updateAllMarketSkills: async () => {
    const { marketInstalled } = get();
    const updatable = marketInstalled.filter((s) => checkHasUpdate(s));
    if (updatable.length === 0) return;

    const ids = new Set(updatable.map((s) => s.meta.id));
    set({ updatingIds: ids, error: null });

    try {
      const results = await Promise.allSettled(
        updatable.map((s) => skillService.updateMarket(s.meta.id)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        set({ error: `${failed} 个技能更新失败` });
      }
      await get().loadMarketInstalled();
    } finally {
      set({ updatingIds: new Set() });
    }
  },

  toggleMarketSkill: async (skillId, enabled) => {
    set({ operatingId: skillId, error: null });
    try {
      await skillService.toggleMarketEnabled(skillId, enabled);
      await get().loadMarketInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "操作失败" });
      throw e;
    } finally {
      set({ operatingId: null });
    }
  },

  // ── 筛选设置 ──

  setSearchQuery: (query) => set({ searchQuery: query }),

  setCategoryFilter: (category) => set({ categoryFilter: category }),

  setSourceFilter: (source) => set({ sourceFilter: source }),

  setMarketSource: (source) => set({ marketSource: source }),

  setPage: (page) => set({ page }),

  // ── 通用 ──

  clearError: () => set({ error: null }),

  // ── 查询方法 ──

  isMarketInstalled: (id) => get().marketInstalled.some((s) => s.meta.id === id),

  isMarketEnabled: (id) => {
    const skill = get().marketInstalled.find((s) => s.meta.id === id);
    return skill ? skill.enabled : false;
  },

  getMarketStats: () => computeStats(get().marketInstalled),

  hasMarketUpdates: () => get().marketInstalled.some((s) => checkHasUpdate(s)),
}));

export { skillService } from "../services/skillService";

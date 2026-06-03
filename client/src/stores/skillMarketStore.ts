import { create } from 'zustand';
import {
  skillMarketService,
  type SkillSearchResult,
  type InstalledSkill,
  type SkillCategory,
} from '../services/skillMarketService';

// ─── 筛选类型 ──────────────────────────────────────────

type SourceFilter = 'all' | 'clawhub' | 'local' | 'plugin' | 'mcp';

// ─── 统计类型 ──────────────────────────────────────────

interface SkillMarketStats {
  /** 已安装总数 */
  installedTotal: number;
  /** 已启用数 */
  installedEnabled: number;
  /** 已禁用数 */
  installedDisabled: number;
  /** 有可用更新的技能数 */
  updatableCount: number;
}

// ─── Store 接口 ────────────────────────────────────────

interface SkillMarketStore {
  /** 市场搜索结果 */
  searchResults: SkillSearchResult[];
  /** 推荐技能列表 */
  recommended: SkillSearchResult[];
  /** 已安装技能列表 */
  installed: InstalledSkill[];
  /** 分类列表 */
  categories: SkillCategory[];
  /** 可用市场来源列表（从 API 动态获取） */
  availableSources: string[];
  /** 当前选中的市场来源（搜索目标市场，'' 表示全部） */
  marketSource: string;
  /** 搜索关键词 */
  searchQuery: string;
  /** 选中的分类 */
  categoryFilter: string;
  /** 来源筛选 */
  sourceFilter: SourceFilter;
  /** 加载状态 */
  isLoading: boolean;
  /** 操作中的技能 ID */
  operatingId: string | null;
  /** 错误信息 */
  error: string | null;
  /** 搜索是否已执行（区分"未搜索"和"无结果"） */
  hasSearched: boolean;
  /** 更新中的技能 ID 列表 */
  updatingIds: Set<string>;

  /** 搜索技能（防抖由组件处理） */
  searchMarket: (query: string, category?: string, source?: string) => Promise<void>;
  /** 加载已安装列表 */
  loadInstalled: () => Promise<void>;
  /** 加载推荐列表 */
  loadRecommended: () => Promise<void>;
  /** 加载分类列表 */
  loadCategories: () => Promise<void>;
  /** 加载可用市场来源 */
  loadSources: () => Promise<void>;
  /** 添加自定义市场来源 */
  addCustomSource: (name: string, apiBaseUrl: string) => Promise<void>;
  /** 移除自定义市场来源 */
  removeCustomSource: (name: string) => Promise<void>;
  /** 设置当前市场来源 */
  installSkill: (skillId: string) => Promise<void>;
  /** 卸载技能 */
  uninstallSkill: (skillId: string) => Promise<void>;
  /** 更新技能 */
  updateSkill: (skillId: string) => Promise<void>;
  /** 批量更新所有可更新技能 */
  updateAllSkills: () => Promise<void>;
  /** 启用/禁用技能 */
  toggleSkill: (skillId: string, enabled: boolean) => Promise<void>;
  /** 设置搜索词 */
  setSearchQuery: (query: string) => void;
  /** 设置分类 */
  setCategoryFilter: (category: string) => void;
  /** 设置来源筛选 */
  setSourceFilter: (source: SourceFilter) => void;
  /** 设置当前市场来源（搜索目标） */
  setMarketSource: (source: string) => void;
  /** 清除错误 */
  clearError: () => void;
  /** 判断技能是否已安装 */
  isInstalled: (id: string) => boolean;
  /** 获取技能启用状态 */
  isEnabled: (id: string) => boolean;
  /** 统计数据 */
  getStats: () => SkillMarketStats;
  /** 是否有可更新技能 */
  hasUpdates: () => boolean;
  /** 搜索结果当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 设置页码 */
  setPage: (page: number) => void;
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

// ─── 内存中的 hasUpdate 追踪（后端暂未支持此字段） ────
// 用安装时间作为简易判断：安装后超过 7 天标记为可更新
const installedTimestamps: Map<string, number> = new Map();
const UPDATE_CHECK_MS = 7 * 24 * 60 * 60 * 1000;

function checkHasUpdate(skill: InstalledSkill): boolean {
  if (!installedTimestamps.has(skill.meta.id)) {
    installedTimestamps.set(skill.meta.id, skill.installedAt);
    return false;
  }
  return Date.now() - installedTimestamps.get(skill.meta.id)! > UPDATE_CHECK_MS;
}

// ─── Store 实现 ────────────────────────────────────────

export const useSkillMarketStore = create<SkillMarketStore>((set, get) => ({
  searchResults: [],
  recommended: [],
  installed: [],
  categories: [],
  availableSources: [],
  marketSource: '',
  searchQuery: '',
  categoryFilter: 'all',
  sourceFilter: 'all',
  isLoading: false,
  operatingId: null,
  error: null,
  hasSearched: false,
  page: 1,
  pageSize: 12,
  updatingIds: new Set(),

  // ── 搜索 ──

  searchMarket: async (query, category, source) => {
    set({ isLoading: true, error: null, hasSearched: true });
    try {
      const cat = category && category !== 'all' ? category : undefined;
      const src = source || get().marketSource || undefined;
      const results = await skillMarketService.search(query, cat, undefined, src);
      set({ searchResults: results, page: 1 }); // 新搜索重置页码
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '搜索失败',
        searchResults: [],
      });
    } finally {
      set({ isLoading: false });
    }
  },

  // ── 已安装 ──

  loadInstalled: async () => {
    set({ error: null });
    try {
      const skills = await skillMarketService.getInstalledSkills();
      set({ installed: skills });
    } catch {
      // 静默失败，保留上次数据
    }
  },

  // ── 推荐 ──

  loadRecommended: async () => {
    try {
      const res = await skillMarketService.getRecommended(6);
      set({ recommended: res.recommended });
    } catch {
      // 静默失败
    }
  },

  // ── 分类 ──

  loadCategories: async () => {
    try {
      const res = await skillMarketService.getCategories();
      set({ categories: res.categories });
    } catch {
      // 静默失败
    }
  },

  loadSources: async () => {
    try {
      const sources = await skillMarketService.getSources();
      set({ availableSources: sources });
    } catch {
      // 静默失败
    }
  },

  addCustomSource: async (name, apiBaseUrl) => {
    try {
      const sources = await skillMarketService.addSource(name, apiBaseUrl);
      set({ availableSources: sources });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '添加失败' });
    }
  },

  removeCustomSource: async (name) => {
    try {
      const sources = await skillMarketService.removeSource(name);
      set({ availableSources: sources, marketSource: '' });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '移除失败' });
    }
  },

  // ── 安装 ──

  installSkill: async (skillId) => {
    set({ operatingId: skillId, error: null });
    try {
      await skillMarketService.install(skillId);
      await get().loadInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '安装失败' });
      throw e;
    } finally {
      set({ operatingId: null });
    }
  },

  // ── 卸载 ──

  uninstallSkill: async (skillId) => {
    set({ operatingId: skillId, error: null });
    try {
      await skillMarketService.uninstall(skillId);
      await get().loadInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '卸载失败' });
      throw e;
    } finally {
      set({ operatingId: null });
    }
  },

  // ── 更新 ──

  updateSkill: async (skillId) => {
    const { updatingIds } = get();
    set({ updatingIds: new Set([...updatingIds, skillId]), error: null });
    try {
      await skillMarketService.update(skillId);
      installedTimestamps.set(skillId, Date.now());
      await get().loadInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '更新失败' });
      throw e;
    } finally {
      const next = new Set(get().updatingIds);
      next.delete(skillId);
      set({ updatingIds: next });
    }
  },

  // ── 批量更新 ──

  updateAllSkills: async () => {
    const { installed } = get();
    const updatable = installed.filter((s) => checkHasUpdate(s));
    if (updatable.length === 0) return;

    const ids = new Set(updatable.map((s) => s.meta.id));
    set({ updatingIds: ids, error: null });

    try {
      const results = await Promise.allSettled(
        updatable.map((s) => skillMarketService.update(s.meta.id))
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        set({ error: `${failed} 个技能更新失败` });
      }
      await get().loadInstalled();
    } finally {
      set({ updatingIds: new Set() });
    }
  },

  // ── 启用/禁用 ──

  toggleSkill: async (skillId, enabled) => {
    set({ operatingId: skillId, error: null });
    try {
      await skillMarketService.toggleEnabled(skillId, enabled);
      await get().loadInstalled();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '操作失败' });
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

  clearError: () => set({ error: null }),

  // ── 状态查询 ──

  isInstalled: (id) => get().installed.some((s) => s.meta.id === id),

  isEnabled: (id) => {
    const skill = get().installed.find((s) => s.meta.id === id);
    return skill ? skill.enabled : false;
  },

  getStats: () => computeStats(get().installed),

  hasUpdates: () => get().installed.some((s) => checkHasUpdate(s)),

  setPage: (page) => set({ page }),

}));

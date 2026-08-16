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
import { extractApiErrorMessage } from "../utils/handleError";

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
  /** 版本比对进行中 */
  checkingUpdates: boolean;

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
  searchMarket: (
    query: string,
    category?: string,
    source?: string,
  ) => Promise<void>;
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
  /** 手动检查更新（force=true 绕过 24h 缓存） */
  checkUpdates: (force?: boolean) => Promise<void>;
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

// ─── 版本比对缓存（P3-3：真实版本比对替代 7 天时间戳推断） ──

const VERSION_CHECK_KEY = "liri-skill-version-check";
/** 版本检查缓存时长：24h */
const VERSION_CHECK_MS = 24 * 60 * 60 * 1000;

interface VersionCheckEntry {
  checkedAt: number;
  /** 远端最新版本；null = 查询失败（降级"未知"） */
  remoteVersion: string | null;
}

function loadVersionChecks(): Map<string, VersionCheckEntry> {
  try {
    const raw = localStorage.getItem(VERSION_CHECK_KEY);
    if (raw) {
      return new Map(JSON.parse(raw));
    }
  } catch {
    // 解析失败则重新开始
  }
  return new Map();
}

function saveVersionChecks(checks: Map<string, VersionCheckEntry>): void {
  try {
    localStorage.setItem(
      VERSION_CHECK_KEY,
      JSON.stringify([...checks.entries()]),
    );
  } catch {
    // localStorage 不可用时静默降级
  }
}

const versionChecks = loadVersionChecks();

/** repo 形态（github:/hermes:/gitee:）技能 ID */
function isRepoSkillId(id: string): boolean {
  return /^(github|hermes|gitee):/.test(id);
}

/** 本地技能（无来源且非 repo 形态）→ 隐藏"更新" */
function isRemoteSkill(skill: InstalledSkill): boolean {
  return Boolean(skill.sourceUrl) || isRepoSkillId(skill.meta.id);
}

/** 语义化版本比较：返回 >0 表示 a 较新 */
function compareVersions(a: string, b: string): number {
  const pa = a
    .replace(/^v/i, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const pb = b
    .replace(/^v/i, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** 真实版本比对：查询远端最新版本并与本地版本比较（P3-3/P3-11/P3-23） */
async function resolveHasUpdate(
  skill: InstalledSkill,
  force: boolean,
): Promise<boolean> {
  // 本地新建技能：无来源，隐藏"更新"
  if (!isRemoteSkill(skill)) return false;

  const id = skill.meta.id;
  const cached = versionChecks.get(id);
  if (!force && cached && Date.now() - cached.checkedAt < VERSION_CHECK_MS) {
    return (
      cached.remoteVersion !== null &&
      compareVersions(cached.remoteVersion, skill.meta.version) > 0
    );
  }

  // 远端查询失败/超时 → 缓存 null，降级为"未知"（不显示"有更新"）
  const detail = await skillService.getMarketDetail(id);
  const remote = detail?.remoteVersion ?? null;
  versionChecks.set(id, { checkedAt: Date.now(), remoteVersion: remote });
  saveVersionChecks(versionChecks);

  return remote !== null && compareVersions(remote, skill.meta.version) > 0;
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
  checkingUpdates: false,

  // ── 本地技能操作 ──

  loadSkills: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const result = await skillService.list(params);
      set({ skills: result.skills, total: result.total });
    } catch (e) {
      set({ error: extractApiErrorMessage(e) });
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
      set({ error: extractApiErrorMessage(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  createSkill: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.create(data);
    } catch (e) {
      set({ error: extractApiErrorMessage(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  updateSkill: async (id, updates) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.update(id, updates);
    } catch (e) {
      set({ error: extractApiErrorMessage(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  deleteSkill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.delete(id);
    } catch (e) {
      set({ error: extractApiErrorMessage(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  enableSkill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.enable(id);
    } catch (e) {
      set({ error: extractApiErrorMessage(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  disableSkill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await skillService.disable(id);
    } catch (e) {
      set({ error: extractApiErrorMessage(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  loadCategories: async () => {
    try {
      const categories = await skillService.getCategories();
      set({ categories });
    } catch (e) {
      set({ error: extractApiErrorMessage(e) });
    }
  },

  setSelectedSkill: (skill) => set({ selectedSkill: skill }),

  // ── 技能市场操作 ──

  searchMarket: async (query, category, source) => {
    set({ isLoading: true, error: null, hasSearched: true });
    try {
      const cat = category && category !== "all" ? category : undefined;
      const src = source || get().marketSource || undefined;
      const results = await skillService.searchMarket(
        query,
        cat,
        undefined,
        src,
      );
      set({ searchResults: results, page: 1 });
    } catch (e) {
      set({
        error: extractApiErrorMessage(e),
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
      // 真实版本比对（P3-3）：24h 缓存内不重复请求远端
      void get().checkUpdates(false);
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
      set({ error: extractApiErrorMessage(e) });
    }
  },

  removeCustomSource: async (name) => {
    try {
      const sources = await skillService.removeSource(name);
      set({ availableSources: sources, marketSource: "" });
    } catch (e) {
      set({ error: extractApiErrorMessage(e) });
    }
  },

  installMarketSkill: async (skillId) => {
    set({ operatingId: skillId, error: null });
    try {
      await skillService.installMarket(skillId);
      await get().loadMarketInstalled();
    } catch (e) {
      set({ error: extractApiErrorMessage(e) });
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
      set({ error: extractApiErrorMessage(e) });
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
      // 更新成功后清除版本缓存，下次 load 重新比对
      versionChecks.delete(skillId);
      saveVersionChecks(versionChecks);
      await get().loadMarketInstalled();
    } catch (e) {
      set({ error: extractApiErrorMessage(e) });
      throw e;
    } finally {
      const next = new Set(get().updatingIds);
      next.delete(skillId);
      set({ updatingIds: next });
    }
  },

  updateAllMarketSkills: async () => {
    const { marketInstalled } = get();
    const updatable = marketInstalled.filter((s) => s.hasUpdate);
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
      updatable.forEach((s) => versionChecks.delete(s.meta.id));
      saveVersionChecks(versionChecks);
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
      set({ error: extractApiErrorMessage(e) });
      throw e;
    } finally {
      set({ operatingId: null });
    }
  },

  checkUpdates: async (force = false) => {
    const { marketInstalled } = get();
    if (marketInstalled.length === 0) return;
    set({ checkingUpdates: true, error: null });
    try {
      // 逐技能查询远端版本（带 24h 缓存），并行执行
      const enriched = await Promise.all(
        marketInstalled.map(async (s) => ({
          ...s,
          hasUpdate: await resolveHasUpdate(s, force),
        })),
      );
      set({ marketInstalled: enriched });
    } catch (e) {
      set({ error: extractApiErrorMessage(e) });
    } finally {
      set({ checkingUpdates: false });
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

  isMarketInstalled: (id) =>
    get().marketInstalled.some((s) => s.meta.id === id),

  isMarketEnabled: (id) => {
    const skill = get().marketInstalled.find((s) => s.meta.id === id);
    return skill ? skill.enabled : false;
  },

  getMarketStats: () => computeStats(get().marketInstalled),

  hasMarketUpdates: () => get().marketInstalled.some((s) => s.hasUpdate),
}));

export { skillService } from "../services/skillService";

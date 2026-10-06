/**
 * mediaStore
 * 媒体页统一状态管理（Phase 2 完整版）
 *
 * 管理：画廊数据、选中媒体、操作模式、模板选择、跨组件信令
 */

import { create } from "zustand";
import { handleClientError } from "@/utils/handleError";

// ============================================================
// 类型
// ============================================================

/** 画廊媒体项 */
export interface GalleryItem {
  id: string;
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  alt?: string;
  duration?: number;
  sourceImageUrl?: string;
}

/**
 * 统一生成任务（图片 + 视频任务队列）—— **唯一展示源 + 唯一轮询状态源**
 *
 * MD-2（2026-10-06，`.pyapp/output/媒体页排查报告.md`）：原 `VideoTaskItem`（`activeTasks`）
 * 与 `GenerationTask`（`generationTasks`）**两套状态并存** —— 视频轮询进度写 `activeTasks`、
 * 展示读 `generationTasks`，靠"双写 + `remoteTaskId` 匹配"同步（结构性易漂移）。
 * 现收敛为**单一事实源**：轮询直接读写本列表（按 `remoteTaskId` 匹配），`activeTasks` 已删除。
 */
export interface GenerationTask {
  id: string;
  type: "image" | "video";
  status: "running" | "completed" | "failed";
  progress: number; // 0-100
  prompt: string;
  /**
   * MD-10（2026-10-06）：视频任务的**原始请求参数** —— 供「重试」忠实重放同一请求。
   * 仅 `video` 类型记录；图片缺 model/size 等原始参数 ⇒ 不提供重试（避免用不同参数静默重跑）。
   */
  videoParams?: { duration: number; aspectRatio: string };
  sourceImageUrl: string | null;
  resultUrl: string | null;
  /** BUG-8（2026-08-26）：多图生成全量结果（resultUrl 为首张） */
  images?: string[];
  /** P2（2026-08-26）：后端视频任务 taskId（generationTask.id 为本地 vid_xxx） */
  remoteTaskId?: string;
  error: string | null;
  createdAt: number;
}

/** 搜索筛选参数 */
export interface GallerySearchParams {
  keyword: string;
  dateRange: "all" | "today" | "7days" | "30days";
}

/** 跨组件操作意图（带序列号防竞态） */
export interface IntendedAction {
  seq: number;
  type: "generate-video" | "edit-image" | null;
  sourceImage: { id: string; url: string } | null;
  autoSubmit: boolean;
}

/** 编辑图片信息（传给 EditLayer） */
export interface EditingImage {
  url: string;
  id: string;
}

// ============================================================
// 收藏持久化（localStorage）
// ============================================================

const FAVORITES_KEY = "liri-media-favorites";

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw) {
      return new Set(JSON.parse(raw));
    }
  } catch (e) {
    handleClientError(e, { module: "stores:media", action: "loadFavorites" });
    // 解析失败则忽略
  }
  return new Set();
}

function saveFavorites(ids: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
  } catch (e) {
    handleClientError(e, { module: "stores:media", action: "saveFavorites" });
    // 存储满则忽略
  }
}

// ============================================================
// Store
// ============================================================

interface MediaStore {
  // ──── 画廊 ────
  galleryItems: GalleryItem[];
  galleryLoading: boolean;
  galleryHasMore: boolean;
  galleryOffset: number;

  // ──── 选中 ────
  selectedId: string | null;
  selectedImageUrl: string | null;

  // ──── 输入面板 ────
  mode: "image" | "video";
  prompt: string;
  params: {
    count?: number;
    duration?: number;
    aspectRatio: string;
    style?: string;
  };

  // ──── 搜索 ────
  searchParams: GallerySearchParams;

  // ──── 任务（MD-2：单一事实源，`activeTasks` 已删除） ────
  generationTasks: GenerationTask[];

  // ──── 模板 ────
  activeTemplateId: string | null;

  // ──── 信令 ────
  intendedAction: IntendedAction | null;
  lastConsumedSeq: number;

  // ──── 图片编辑 ────
  editingImage: EditingImage | null;
  isEditing: boolean;

  // ──── 收藏（localStorage 持久化） ────
  favoriteIds: Set<string>;
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;

  // ──── Actions ────
  selectMedia: (id: string) => void;

  setMode: (mode: "image" | "video") => void;
  setPrompt: (prompt: string) => void;
  setSelectedImage: (url: string, id: string) => void;
  clearSelectedImage: () => void;
  setParams: (params: Partial<MediaStore["params"]>) => void;

  setSearchParams: (params: Partial<GallerySearchParams>) => void;

  setGalleryItems: (items: GalleryItem[], hasMore: boolean) => void;
  appendGalleryItems: (items: GalleryItem[], hasMore: boolean) => void;
  removeGalleryItem: (id: string) => void;

  addGenerationTask: (task: GenerationTask) => void;
  updateGenerationTask: (id: string, update: Partial<GenerationTask>) => void;
  removeGenerationTask: (id: string) => void;

  selectTemplate: (templateId: string | null) => void;

  setIntendedAction: (action: Omit<IntendedAction, "seq">) => void;
  clearIntendedAction: () => void;

  setEditingImage: (image: EditingImage | null) => void;
  addGalleryItem: (item: GalleryItem) => void;

  getSelectedItem: () => GalleryItem | null;
}

export const useMediaStore = create<MediaStore>()((set, get) => ({
  // ──── 画廊 ────
  galleryItems: [],
  galleryLoading: false,
  galleryHasMore: true,
  galleryOffset: 0,

  // ──── 选中 ────
  selectedId: null,
  selectedImageUrl: null,

  // ──── 输入面板 ────
  mode: "video" as const,
  prompt: "",
  params: {
    count: 1,
    duration: 5,
    aspectRatio: "16:9",
  },

  // ──── 搜索 ────
  searchParams: { keyword: "", dateRange: "all" },

  // ──── 任务（MD-2：单一事实源） ────
  generationTasks: [],

  // ──── 模板 ────
  activeTemplateId: null,

  // ──── 信令 ────
  intendedAction: null,
  lastConsumedSeq: 0,

  // ──── 图片编辑 ────
  editingImage: null,
  isEditing: false,

  // ──── 收藏（localStorage 持久化） ────
  favoriteIds: loadFavorites(),

  // ──── Actions ────

  selectMedia: (id: string) => {
    const item = get().galleryItems.find((i) => i.id === id) || null;
    set({
      selectedId: id,
      selectedImageUrl: item?.url || null,
    });
  },

  setMode: (mode) => set({ mode }),
  setPrompt: (prompt) => set({ prompt }),
  setSelectedImage: (url, id) => set({ selectedImageUrl: url, selectedId: id }),
  clearSelectedImage: () => set({ selectedImageUrl: null, selectedId: null }),
  setParams: (partial) => set((s) => ({ params: { ...s.params, ...partial } })),

  setSearchParams: (partial) =>
    set((s) => ({ searchParams: { ...s.searchParams, ...partial } })),

  setGalleryItems: (items, hasMore) =>
    set({
      galleryItems: items,
      galleryLoading: false,
      galleryHasMore: hasMore,
      galleryOffset: items.length,
    }),

  appendGalleryItems: (items, hasMore) =>
    set((s) => {
      const existingIds = new Set(s.galleryItems.map((i) => i.id));
      const newItems = items.filter((item) => !existingIds.has(item.id));
      if (newItems.length === 0) {
        return { galleryLoading: false, galleryHasMore: false };
      }
      return {
        galleryItems: [...s.galleryItems, ...newItems],
        galleryLoading: false,
        galleryHasMore: hasMore,
        galleryOffset: s.galleryOffset + newItems.length,
      };
    }),

  removeGalleryItem: (id) =>
    set((s) => {
      // BUG-12（2026-08-26）：删除时同步清理收藏，避免收藏虚高/对不上
      const nextFavs = new Set(s.favoriteIds);
      nextFavs.delete(id);
      // MD-11（2026-10-06）：内存清了收藏后必须**回写 localStorage** —— 否则刷新后
      // 已删项从持久化收藏集合"复活"（对照 toggleFavorite 的 saveFavorites 落盘）。
      saveFavorites(nextFavs);
      return {
        galleryItems: s.galleryItems.filter((item) => item.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        selectedImageUrl: s.selectedId === id ? null : s.selectedImageUrl,
        favoriteIds: nextFavs,
      };
    }),

  addGenerationTask: (task) =>
    set((s) => ({
      generationTasks: [task, ...s.generationTasks].slice(0, 20),
    })),

  updateGenerationTask: (id, update) =>
    set((s) => ({
      generationTasks: s.generationTasks.map((t) =>
        t.id === id ? { ...t, ...update } : t,
      ),
    })),

  removeGenerationTask: (id) =>
    set((s) => ({
      generationTasks: s.generationTasks.filter((t) => t.id !== id),
    })),

  selectTemplate: (templateId) => set({ activeTemplateId: templateId }),

  setIntendedAction: (action) => {
    const seq = get().lastConsumedSeq + 1;
    set({ intendedAction: { ...action, seq } });
  },

  clearIntendedAction: () => set({ intendedAction: null }),

  // 设置/清除编辑图片，同时控制 isEditing 锁
  setEditingImage: (image) =>
    set({ editingImage: image, isEditing: image !== null }),

  // 增量插入画廊项（头部插入 + 去重）
  addGalleryItem: (item) =>
    set((s) => ({
      galleryItems: [
        item,
        ...s.galleryItems.filter((existing) => existing.id !== item.id),
      ],
    })),

  getSelectedItem: () => {
    const { selectedId, galleryItems } = get();
    return galleryItems.find((i) => i.id === selectedId) || null;
  },

  toggleFavorite: (id: string) => {
    set((s) => {
      const next = new Set(s.favoriteIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveFavorites(next);
      return { favoriteIds: next };
    });
  },

  isFavorite: (id: string) => {
    return get().favoriteIds.has(id);
  },
}));

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

/** 视频异步任务（向后兼容） */
export interface VideoTaskItem {
  taskId: string;
  status: "pending" | "queued" | "running" | "completed" | "failed";
  mode: "text-to-video" | "image-to-video";
  progress: number;
  sourceImageUrl: string | null;
  resultVideoUrl: string | null;
  prompt: string;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** 统一生成任务（Phase 7: 图片 + 视频任务队列） */
export interface GenerationTask {
  id: string;
  type: "image" | "video";
  status: "running" | "completed" | "failed";
  progress: number; // 0-100
  prompt: string;
  sourceImageUrl: string | null;
  resultUrl: string | null;
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

const FAVORITES_KEY = "pyapp_media_favorites";

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

  // ──── 任务 ────
  activeTasks: VideoTaskItem[];
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

  addTask: (task: VideoTaskItem) => void;
  updateTask: (taskId: string, update: Partial<VideoTaskItem>) => void;
  removeTask: (taskId: string) => void;
  setActiveTasks: (tasks: VideoTaskItem[]) => void;

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

  // ──── 任务 ────
  activeTasks: [],
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
    set((s) => ({
      galleryItems: s.galleryItems.filter((item) => item.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      selectedImageUrl: s.selectedId === id ? null : s.selectedImageUrl,
    })),

  addTask: (task) => set((s) => ({ activeTasks: [task, ...s.activeTasks] })),

  updateTask: (taskId, update) =>
    set((s) => ({
      activeTasks: s.activeTasks.map((t) =>
        t.taskId === taskId ? { ...t, ...update } : t,
      ),
    })),

  removeTask: (taskId) =>
    set((s) => ({
      activeTasks: s.activeTasks.filter((t) => t.taskId !== taskId),
    })),

  setActiveTasks: (tasks) => set({ activeTasks: tasks }),

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

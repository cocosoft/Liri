/**
 * mediaStore
 * 媒体页统一状态管理（Phase 2 完整版）
 *
 * 管理：画廊数据、选中媒体、操作模式、模板选择、跨组件信令
 */

import { create } from "zustand";

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

/** 视频异步任务 */
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

  // ──── 模板 ────
  activeTemplateId: string | null;

  // ──── 跨组件信令（带序列号防竞态）───
  intendedAction: IntendedAction | null;
  lastConsumedSeq: number;

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

  addTask: (task: VideoTaskItem) => void;
  updateTask: (taskId: string, update: Partial<VideoTaskItem>) => void;
  removeTask: (taskId: string) => void;
  setActiveTasks: (tasks: VideoTaskItem[]) => void;

  selectTemplate: (templateId: string | null) => void;

  setIntendedAction: (action: Omit<IntendedAction, "seq">) => void;
  clearIntendedAction: () => void;

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

  // ──── 模板 ────
  activeTemplateId: null,

  // ──── 信令 ────
  intendedAction: null,
  lastConsumedSeq: 0,

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
    set((s) => ({
      galleryItems: [...s.galleryItems, ...items],
      galleryLoading: false,
      galleryHasMore: hasMore,
      galleryOffset: s.galleryOffset + items.length,
    })),

  addTask: (task) =>
    set((s) => ({ activeTasks: [task, ...s.activeTasks] })),

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

  selectTemplate: (templateId) => set({ activeTemplateId: templateId }),

  setIntendedAction: (action) => {
    const seq = get().lastConsumedSeq + 1;
    set({ intendedAction: { ...action, seq } });
  },

  clearIntendedAction: () => set({ intendedAction: null }),

  getSelectedItem: () => {
    const { selectedId, galleryItems } = get();
    return galleryItems.find((i) => i.id === selectedId) || null;
  },
}));

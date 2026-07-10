/**
 * mediaStore
 * 媒体页统一状态管理（Phase 1 MVP）
 *
 * 管理：画廊数据、图生视频表单、异步任务队列、搜索筛选
 * Phase 2 将扩展：mode 切换、模板、Masonry 布局
 */

import { create } from "zustand";
import { createLogger } from "../utils/logger";

const logger = createLogger("mediaStore");

// ============================================================
// 类型
// ============================================================

/** 画廊媒体项（Phase 1：仅图片；Phase 2：image + video） */
export interface GalleryItem {
  id: string;
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  alt?: string;
  /** 视频专属 */
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

  // ──── 表单 ────
  prompt: string;
  duration: number;
  aspectRatio: string;

  // ──── 搜索 ────
  searchParams: GallerySearchParams;

  // ──── 任务 ────
  activeTasks: VideoTaskItem[];

  // ──── Actions ────
  selectMedia: (id: string) => void;

  setPrompt: (prompt: string) => void;
  setDuration: (duration: number) => void;
  setAspectRatio: (ratio: string) => void;

  setSearchParams: (params: Partial<GallerySearchParams>) => void;

  setGalleryItems: (items: GalleryItem[], hasMore: boolean) => void;
  appendGalleryItems: (items: GalleryItem[], hasMore: boolean) => void;

  addTask: (task: VideoTaskItem) => void;
  updateTask: (taskId: string, update: Partial<VideoTaskItem>) => void;
  removeTask: (taskId: string) => void;
  setActiveTasks: (tasks: VideoTaskItem[]) => void;

  /** 获取选中的 GalleryItem */
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

  // ──── 表单 ────
  prompt: "",
  duration: 5,
  aspectRatio: "16:9",

  // ──── 搜索 ────
  searchParams: {
    keyword: "",
    dateRange: "all",
  },

  // ──── 任务 ────
  activeTasks: [],

  // ──── Actions ────

  selectMedia: (id: string) => {
    const item = get().galleryItems.find((i) => i.id === id) || null;
    set({
      selectedId: id,
      selectedImageUrl: item?.url || null,
    });
    logger.debug("selectMedia", { id, url: item?.url });
  },

  setPrompt: (prompt: string) => set({ prompt }),
  setDuration: (duration: number) => set({ duration }),
  setAspectRatio: (aspectRatio: string) => set({ aspectRatio }),

  setSearchParams: (params: Partial<GallerySearchParams>) =>
    set((s) => ({ searchParams: { ...s.searchParams, ...params } })),

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

  addTask: (task: VideoTaskItem) =>
    set((s) => ({
      activeTasks: [task, ...s.activeTasks],
    })),

  updateTask: (taskId: string, update: Partial<VideoTaskItem>) =>
    set((s) => ({
      activeTasks: s.activeTasks.map((t) =>
        t.taskId === taskId ? { ...t, ...update } : t
      ),
    })),

  removeTask: (taskId: string) =>
    set((s) => ({
      activeTasks: s.activeTasks.filter((t) => t.taskId !== taskId),
    })),

  setActiveTasks: (tasks: VideoTaskItem[]) => set({ activeTasks: tasks }),

  getSelectedItem: () => {
    const { selectedId, galleryItems } = get();
    return galleryItems.find((i) => i.id === selectedId) || null;
  },
}));

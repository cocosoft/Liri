import { create } from "zustand";
import type {
  FileEntry,
  FileCategory,
  WorkspaceInfo,
  FileRegistryRecord,
  FileSearchParams,
  FileStats,
} from "../types";
import {
  fileService,
  type FileDetectResult,
  type ConvertFileOptions,
} from "../services/fileService";
import { createLogger } from "@/utils/logger";

// P2-4：请求序号竞态守卫——目录导航/Registry 查询各自递增 seq，
// 响应返回时若 seq 已过期则丢弃（防快速切换目录/连续搜索时旧响应覆盖新状态）
let navSeq = 0;
let registrySeq = 0;
import { handleClientError } from "@/utils/handleError";
import { toastInfo, toastError } from "./toastStore";

const logger = createLogger("fileStore");

type FileViewMode = "directory" | "registry";

interface FileStore {
  entries: FileEntry[];
  currentPath: string;
  currentCategory: FileCategory;
  currentWorkspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
  isLoading: boolean;
  error: string | null;
  uploading: boolean;
  detectResult: FileDetectResult | null;
  convertResult: unknown;
  selectedFile: { name: string; path: string } | null;
  loadDir: (path: string) => Promise<void>;
  navigateTo: (path: string) => void;
  goUp: () => void;
  uploadFile: (file: File) => Promise<void>;
  detectFile: (filePath: string) => Promise<FileDetectResult | null>;
  convertFile: (params: ConvertFileOptions) => Promise<unknown>;
  clearFileAction: () => void;
  selectFile: (file: { name: string; path: string } | null) => void;
  setCategory: (category: FileCategory) => Promise<void>;
  loadWorkspaces: () => Promise<void>;
  setWorkspace: (workspace: WorkspaceInfo) => void;
  sendToAI: (filePath: string) => Promise<void>;
  saveToKnowledge: (filePath: string) => Promise<void>;
  saveToMemory: (filePath: string) => Promise<void>;

  // FileRegistry 查询
  viewMode: FileViewMode;
  registryResults: FileRegistryRecord[];
  registryTotal: number;
  registryNextCursor: string | undefined;
  registryParams: FileSearchParams;
  fileStats: FileStats | null;
  registryLoading: boolean;
  setViewMode: (mode: FileViewMode) => void;
  setRegistryParams: (params: FileSearchParams) => void;
  searchRegistry: () => Promise<void>;
  loadMoreRegistry: () => Promise<void>;
  fetchFileStats: () => Promise<void>;
}

const CORE_DIRECTORIES: Partial<Record<FileCategory, string>> = {
  all: "",
  output: "output",
  downloads: "downloads",
  attachments: "attachments",
  knowledge: "knowledge",
  memory: "memory",
};

export const useFileStore = create<FileStore>((set, get) => ({
  entries: [],
  currentPath: "",
  currentCategory: "all",
  currentWorkspace: null,
  workspaces: [],
  isLoading: false,
  error: null,
  uploading: false,
  detectResult: null,
  convertResult: null,
  selectedFile: null,

  // FileRegistry 查询
  viewMode: "directory",
  registryResults: [],
  registryTotal: 0,
  registryNextCursor: undefined,
  registryParams: {},
  fileStats: null,
  registryLoading: false,

  loadDir: async (path: string) => {
    const seq = ++navSeq;
    set({ isLoading: true, error: null });
    try {
      const entries = await fileService.listDir(path);
      if (seq !== navSeq) return; // P2-4：过期响应丢弃
      set({ entries, currentPath: path, isLoading: false });
    } catch (e) {
      if (seq !== navSeq) return;
      handleClientError(e, { module: "stores:file", action: "loadDir" });
      set({ error: String(e), isLoading: false });
    }
  },

  navigateTo: (path: string) => {
    get().loadDir(path);
  },

  goUp: () => {
    const current = get().currentPath;
    const parts = current.split("/").filter(Boolean);
    if (parts.length <= 1) {
      get().setCategory(get().currentCategory);
      return;
    }
    // P1-1：不拼前导 "/"，保持与后端 relPath（相对 posix）同风格，树高亮/上级导航一致
    const parent = parts.slice(0, -1).join("/");
    get().loadDir(parent);
  },

  uploadFile: async (file: File) => {
    set({ uploading: true, error: null });
    try {
      await fileService.upload(file);
      // 上传的文件保存到 attachments 目录，自动切换到该分类让用户可见
      set({ currentCategory: "attachments", currentPath: "attachments" });
      await get().loadDir("attachments");
    } catch (e) {
      handleClientError(e, { module: "stores:file", action: "uploadFile" });
      set({ error: String(e), uploading: false });
    } finally {
      set({ uploading: false });
    }
  },

  detectFile: async (filePath: string) => {
    set({ error: null, detectResult: null });
    try {
      const result = await fileService.detect(filePath);
      set({ detectResult: result });
      return result;
    } catch (e) {
      handleClientError(e, { module: "stores:file", action: "detectFile" });
      set({ error: String(e) });
      return null;
    }
  },

  convertFile: async (params: ConvertFileOptions) => {
    set({ error: null, convertResult: null });
    try {
      const result = await fileService.convert(params);
      set({ convertResult: result });
      return result;
    } catch (e) {
      handleClientError(e, { module: "stores:file", action: "convertFile" });
      set({ error: String(e) });
      return null;
    }
  },

  clearFileAction: () => {
    set({ detectResult: null, convertResult: null, error: null });
  },

  selectFile: (file) => {
    set({ selectedFile: file });
    get().clearFileAction();
  },

  setCategory: async (category: FileCategory) => {
    set({ currentCategory: category });

    // 新分类走 FileRegistry 视图
    const registryCategories: FileCategory[] = [
      "inbound",
      "media",
      "artifact",
      "notebook",
    ];
    if (registryCategories.includes(category)) {
      set({
        viewMode: "registry",
        registryParams: {
          storeZone:
            category === "inbound"
              ? "inbound"
              : category === "media"
                ? "media"
                : category === "artifact"
                  ? "artifact"
                  : "notebook",
        },
      });
      return;
    }

    const path = CORE_DIRECTORIES[category]!;
    await get().loadDir(path);
  },

  loadWorkspaces: async () => {
    try {
      const workspaces = await fileService.listWorkspaces();
      set({ workspaces });
    } catch (e) {
      handleClientError(e, { module: "stores:file", action: "loadWorkspaces" });
      logger.error("Failed to load workspaces:", e);
    }
  },

  setWorkspace: (workspace) => {
    set({ currentWorkspace: workspace });
  },

  sendToAI: async (filePath: string) => {
    try {
      await fileService.sendToAI(filePath);
    } catch (e) {
      handleClientError(e, { module: "stores:file", action: "sendToAI" });
      set({ error: String(e) });
    }
  },

  saveToKnowledge: async (filePath: string) => {
    try {
      await fileService.saveToKnowledge(filePath);
      toastInfo("已加入知识库，可前往知识库查看");
    } catch (e) {
      toastError(e);
      handleClientError(e, {
        module: "stores:file",
        action: "saveToKnowledge",
      });
      set({ error: String(e) });
    }
  },

  saveToMemory: async (filePath: string) => {
    try {
      await fileService.saveToMemory(filePath);
    } catch (e) {
      handleClientError(e, { module: "stores:file", action: "saveToMemory" });
      set({ error: String(e) });
    }
  },

  // ─── FileRegistry 查询 ───

  setViewMode: (mode) => {
    set({ viewMode: mode });
  },

  setRegistryParams: (params) => {
    set({ registryParams: params });
  },

  searchRegistry: async () => {
    const { registryParams } = get();
    const seq = ++registrySeq;
    set({ registryLoading: true, error: null });
    try {
      const result = await fileService.searchFiles(registryParams);
      if (seq !== registrySeq) return; // P2-4：过期响应丢弃
      set({
        registryResults: result.items,
        registryTotal: result.total,
        registryNextCursor: undefined,
        registryLoading: false,
      });
    } catch (e) {
      if (seq !== registrySeq) return;
      handleClientError(e, { module: "stores:file", action: "searchRegistry" });
      set({ error: String(e), registryLoading: false });
    }
  },

  loadMoreRegistry: async () => {
    const { registryResults, registryParams, registryTotal, registryLoading } =
      get();
    if (registryLoading) return;
    // P2-1：offset 分页——无更多由已加载条数 >= total 判定（后端同时返回 hasMore 供契约核对）
    if (registryResults.length >= registryTotal) return;
    const seq = ++registrySeq;
    set({ registryLoading: true });
    try {
      const result = await fileService.searchFiles({
        ...registryParams,
        cursor: String(registryResults.length),
      });
      if (seq !== registrySeq) return; // P2-4：过期响应丢弃
      set({
        registryResults: [...registryResults, ...result.items],
        registryTotal: result.total,
        registryNextCursor: undefined,
        registryLoading: false,
      });
    } catch (e) {
      if (seq !== registrySeq) return;
      handleClientError(e, {
        module: "stores:file",
        action: "loadMoreRegistry",
      });
      set({ error: String(e), registryLoading: false });
    }
  },

  fetchFileStats: async () => {
    try {
      const stats = await fileService.getFileStats();
      set({ fileStats: stats });
    } catch (e) {
      handleClientError(e, { module: "stores:file", action: "fetchFileStats" });
      // stats 加载失败不阻塞 UI
      logger.warn("Failed to fetch file stats:", e);
    }
  },
}));

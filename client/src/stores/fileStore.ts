import { create } from "zustand";
import type { FileEntry, FileCategory, WorkspaceInfo } from "../types";
import {
  fileService,
  type FileDetectResult,
  type ConvertFileOptions,
} from "../services/fileService";

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
}

const CORE_DIRECTORIES: Record<FileCategory, string> = {
  output: "output",
  downloads: "downloads",
  attachments: "attachments",
  knowledge: "knowledge",
  memory: "memory",
};

export const useFileStore = create<FileStore>((set, get) => ({
  entries: [],
  currentPath: "output",
  currentCategory: "output",
  currentWorkspace: null,
  workspaces: [],
  isLoading: false,
  error: null,
  uploading: false,
  detectResult: null,
  convertResult: null,
  selectedFile: null,

  loadDir: async (path: string) => {
    set({ isLoading: true, error: null });
    try {
      const entries = await fileService.listDir(path);
      set({ entries, currentPath: path, isLoading: false });
    } catch (e) {
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
    const parent = "/" + parts.slice(0, -1).join("/");
    get().loadDir(parent);
  },

  uploadFile: async (file: File) => {
    set({ uploading: true, error: null });
    try {
      await fileService.upload(file);
      await get().loadDir(get().currentPath);
    } catch (e) {
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
    const path = CORE_DIRECTORIES[category];
    await get().loadDir(path);
  },

  loadWorkspaces: async () => {
    try {
      const workspaces = await fileService.listWorkspaces();
      set({ workspaces });
    } catch (e) {
      console.error("Failed to load workspaces:", e);
    }
  },

  setWorkspace: (workspace) => {
    set({ currentWorkspace: workspace });
  },

  sendToAI: async (filePath: string) => {
    try {
      await fileService.sendToAI(filePath);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveToKnowledge: async (filePath: string) => {
    try {
      await fileService.saveToKnowledge(filePath);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveToMemory: async (filePath: string) => {
    try {
      await fileService.saveToMemory(filePath);
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));

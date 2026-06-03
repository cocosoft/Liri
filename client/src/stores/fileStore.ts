import { create } from "zustand";
import type { FileEntry } from "../types";
import {
  fileService,
  type FileDetectResult,
  type ConvertFileOptions,
} from "../services/fileService";

interface FileStore {
  entries: FileEntry[];
  currentPath: string;
  isLoading: boolean;
  error: string | null;
  uploading: boolean;
  detectResult: FileDetectResult | null;
  convertResult: unknown;
  loadDir: (path: string) => Promise<void>;
  navigateTo: (path: string) => void;
  goUp: () => void;
  uploadFile: (file: File) => Promise<void>;
  detectFile: (filePath: string) => Promise<FileDetectResult | null>;
  convertFile: (params: ConvertFileOptions) => Promise<unknown>;
  clearFileAction: () => void;
}

export const useFileStore = create<FileStore>((set, get) => ({
  entries: [],
  currentPath: "/",
  isLoading: false,
  error: null,
  uploading: false,
  detectResult: null,
  convertResult: null,

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
    const parent =
      current === "/" ? "/" : current.split("/").slice(0, -1).join("/") || "/";
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
}));

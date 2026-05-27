import { create } from 'zustand';
import type { FileEntry } from '../types';
import { fileService } from '../services/fileService';

interface FileStore {
  entries: FileEntry[];
  currentPath: string;
  isLoading: boolean;
  error: string | null;
  loadDir: (path: string) => Promise<void>;
  navigateTo: (path: string) => void;
  goUp: () => void;
}

export const useFileStore = create<FileStore>((set, get) => ({
  entries: [],
  currentPath: '/',
  isLoading: false,
  error: null,

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
    const parent = current === '/' ? '/' : current.split('/').slice(0, -1).join('/') || '/';
    get().loadDir(parent);
  },
}));

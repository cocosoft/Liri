import type { FileEntry } from '../types';

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

async function getTauriCore() {
  if (!isTauri) return null;
  try {
    return await import('@tauri-apps/api/core');
  } catch {
    return null;
  }
}

function createFallbackFileService() {
  return {
    listDir: async (_path: string): Promise<FileEntry[]> => {
      return [];
    },
    readFile: async (_path: string): Promise<string> => {
      throw new Error('File operations unavailable outside Tauri');
    },
  };
}

function createTauriFileService() {
  return {
    listDir: async (path: string): Promise<FileEntry[]> => {
      const core = await getTauriCore();
      if (!core) return createFallbackFileService().listDir(path);
      return core.invoke<FileEntry[]>('list_files', { path });
    },
    readFile: async (path: string): Promise<string> => {
      const core = await getTauriCore();
      if (!core) return createFallbackFileService().readFile(path);
      return core.invoke<string>('read_file', { path });
    },
  };
}

export const fileService = isTauri ? createTauriFileService() : createFallbackFileService();

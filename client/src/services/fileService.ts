import type { FileEntry, WorkspaceInfo } from "../types";
import { http } from "./httpClient";

const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

async function getTauriCore() {
  if (!isTauri) return null;
  try {
    return await import("@tauri-apps/api/core");
  } catch {
    return null;
  }
}

export interface ConvertFileOptions {
  filePath: string;
  outputFormat: string;
  options?: Record<string, unknown>;
}

export interface FileDetectResult {
  type: string;
  mime: string;
  extension: string;
}

function createFallbackFileService() {
  return {
    listDir: async (_path: string): Promise<FileEntry[]> => {
      return [];
    },
    readFile: async (_path: string): Promise<string> => {
      throw new Error("File operations unavailable outside Tauri");
    },
    upload: uploadViaHttp,
    uploadBase64: uploadBase64ViaHttp,
    convert: async (params: ConvertFileOptions): Promise<unknown> => {
      return http.post("/v1/files/convert", params);
    },
    detect: async (filePath: string): Promise<FileDetectResult> => {
      return http.post<FileDetectResult>("/v1/files/detect", { filePath });
    },
    listWorkspaces: async (): Promise<WorkspaceInfo[]> => {
      return [];
    },
    sendToAI: async (_filePath: string): Promise<void> => {
      throw new Error("Not implemented");
    },
    saveToKnowledge: async (_filePath: string): Promise<void> => {
      throw new Error("Not implemented");
    },
    saveToMemory: async (_filePath: string): Promise<void> => {
      throw new Error("Not implemented");
    },
  };
}

function createTauriFileService() {
  return {
    listDir: async (path: string): Promise<FileEntry[]> => {
      const core = await getTauriCore();
      if (!core) return createFallbackFileService().listDir(path);
      return core.invoke<FileEntry[]>("list_files", { path });
    },
    readFile: async (path: string): Promise<string> => {
      const core = await getTauriCore();
      if (!core) return createFallbackFileService().readFile(path);
      return core.invoke<string>("read_file", { path });
    },
    upload: uploadViaHttp,
    uploadBase64: uploadBase64ViaHttp,
    convert: async (params: ConvertFileOptions): Promise<unknown> => {
      return http.post("/v1/files/convert", params);
    },
    detect: async (filePath: string): Promise<FileDetectResult> => {
      return http.post<FileDetectResult>("/v1/files/detect", { filePath });
    },
    listWorkspaces: async (): Promise<WorkspaceInfo[]> => {
      try {
        return await http.get<WorkspaceInfo[]>("/v1/workspaces");
      } catch {
        const core = await getTauriCore();
        if (!core) return [];
        const result = await core.invoke<WorkspaceInfo[]>("list_workspaces");
        return result || [];
      }
    },
    sendToAI: async (filePath: string): Promise<void> => {
      await http.post("/v1/files/send-to-ai", { filePath });
    },
    saveToKnowledge: async (filePath: string): Promise<void> => {
      await http.post("/v1/knowledge/ingest", { filePath });
    },
    saveToMemory: async (filePath: string): Promise<void> => {
      await http.post("/v1/memory/create-from-file", { filePath });
    },
  };
}

async function uploadViaHttp(
  file: File,
): Promise<{ path: string; size: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      http
        .post<{ path: string; size: number }>("/v1/files/upload", {
          filename: file.name,
          data: base64,
        })
        .then(resolve)
        .catch(reject);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function uploadBase64ViaHttp(
  filename: string,
  base64Data: string,
): Promise<{ path: string; size: number }> {
  return http.post<{ path: string; size: number }>("/v1/files/upload", {
    filename,
    data: base64Data,
  });
}

export const fileService = isTauri
  ? createTauriFileService()
  : createFallbackFileService();

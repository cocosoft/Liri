import type { FileEntry, WorkspaceInfo, FileRegistryRecord, FileSearchParams, FileSearchResult, FileStats } from "../types";
import { http } from "./httpClient";

/**
 * 文件读取详情响应
 */
export interface FileReadDetail {
  /** 文件内容（文本内容或 base64 data URL） */
  content: string;
  /** 是否为 base64 编码 */
  isBase64: boolean;
  /** MIME 类型 */
  mimeType: string;
}

/**
 * 检测是否运行在 Tauri WebView 环境中。
 * Tauri v1 使用 window.__TAURI__，Tauri v2 使用 window.__TAURI_INTERNALS__。
 */
const isTauri = typeof window !== "undefined" && (
  "__TAURI__" in window || "__TAURI_INTERNALS__" in window
);

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
    readFileDetail: async (_path: string): Promise<FileReadDetail> => {
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
    searchFiles: async (params: FileSearchParams): Promise<FileSearchResult> => {
      const queryParams: Record<string, unknown> = {};
      if (params.query) queryParams.q = params.query;
      if (params.source) queryParams.source = params.source;
      if (params.storeZone) queryParams.store_zone = params.storeZone;
      if (params.startDate) queryParams.start_date = params.startDate;
      if (params.endDate) queryParams.end_date = params.endDate;
      if (params.cursor) queryParams.cursor = params.cursor;
      if (params.limit) queryParams.limit = params.limit;
      return http.get<FileSearchResult>("/v1/files/registry/search", { params: queryParams });
    },
    getFileDetail: async (fileId: string): Promise<FileRegistryRecord> => {
      return http.get<FileRegistryRecord>(`/v1/files/registry/detail`, { params: { fileId } });
    },
    getFileStats: async (): Promise<FileStats> => {
      return http.get<FileStats>("/v1/files/registry/stats");
    },
    batchDelete: async (ids: string[]): Promise<void> => {
      await http.post("/v1/files/registry/batch-delete", { ids });
    },
  };
}

function createTauriFileService() {
  return {
    // 走 HTTP API 而非 Tauri IPC（后端 Rust 命令未实现）
    listDir: async (path: string): Promise<FileEntry[]> => {
      try {
        const result = await http.get<FileEntry[]>("/v1/files/list", { params: { path } });
        return result;
      } catch (e) {
        // 将原始错误传递出去，让 UI 层展示真实错误信息
        throw new Error(
          `无法列出目录内容: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    },
    readFile: async (path: string): Promise<string> => {
      try {
        const result = await http.get<{ content: string }>("/v1/files/read", { params: { path } });
        return result.content;
      } catch {
        throw new Error("无法读取文件");
      }
    },
    readFileDetail: async (path: string): Promise<FileReadDetail> => {
      try {
        const result = await http.get<FileReadDetail>("/v1/files/read", { params: { path } });
        return result;
      } catch {
        throw new Error("无法读取文件");
      }
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
        return [];
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
    searchFiles: async (params: FileSearchParams): Promise<FileSearchResult> => {
      const queryParams: Record<string, unknown> = {};
      if (params.query) queryParams.q = params.query;
      if (params.source) queryParams.source = params.source;
      if (params.storeZone) queryParams.store_zone = params.storeZone;
      if (params.startDate) queryParams.start_date = params.startDate;
      if (params.endDate) queryParams.end_date = params.endDate;
      if (params.cursor) queryParams.cursor = params.cursor;
      if (params.limit) queryParams.limit = params.limit;
      return http.get<FileSearchResult>("/v1/files/registry/search", { params: queryParams });
    },
    getFileDetail: async (fileId: string): Promise<FileRegistryRecord> => {
      return http.get<FileRegistryRecord>("/v1/files/registry/detail", { params: { fileId } });
    },
    getFileStats: async (): Promise<FileStats> => {
      return http.get<FileStats>("/v1/files/registry/stats");
    },
    batchDelete: async (ids: string[]): Promise<void> => {
      await http.post("/v1/files/registry/batch-delete", { ids });
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

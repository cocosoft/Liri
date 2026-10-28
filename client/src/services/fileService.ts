import type {
  FileEntry,
  WorkspaceInfo,
  FileRegistryRecord,
  FileSearchParams,
  FileSearchResult,
  FileStats,
} from "../types";
import { httpLegacy as http } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import { handleClientError } from "../utils/handleError";
import i18n from "../i18n";

/**
 * P0-2（2026-09-07）：Registry 批量删除统一走既有
 * `DELETE /v1/files/registry/delete?fileIds=a,b,c`（后端 softDelete 多 id 软删）。
 * 逗号多 id 拼 query string，单批 ≤200 防止 URL 超长，超出分批串行删除。
 */
const REGISTRY_DELETE_BATCH = 200;
async function deleteRegistryFiles(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += REGISTRY_DELETE_BATCH) {
    const chunk = ids.slice(i, i + REGISTRY_DELETE_BATCH);
    const fileIds = encodeURIComponent(chunk.join(","));
    await http.delete(`${ENDPOINTS.files.registryDelete}?fileIds=${fileIds}`);
  }
}

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

/**
 * 文件服务（HTTP 单一实现）
 *
 * F-05（2026-10-28）：原先按「是否运行在 Tauri」二分 —— 浏览器里落到
 * `createFallbackFileService()`，其 `listDir()` / `listWorkspaces()` 直接返回 `[]`，
 * 而 `getFileStats()` 仍走真实 HTTP ⇒ `/files` 同时出现「此目录为空 / 暂无文件 /
 * 未选择工作空间」与「文件总数 8240」。
 * 后端文件能力本来就只经 HTTP 暴露（`/v1/files/*`），不存在 Tauri IPC 实现，
 * 故取消分叉，统一走 HTTP；后端不可用时由调用方展示错误态（不再伪装成空目录）。
 */
function createHttpFileService() {
  return {
    // 走 HTTP API 而非 Tauri IPC（后端 Rust 命令未实现）
    listDir: async (path: string): Promise<FileEntry[]> => {
      try {
        const result = await http.get<FileEntry[]>(ENDPOINTS.files.list, {
          params: { path },
        });
        return result;
      } catch (e) {
        // 将原始错误传递出去，让 UI 层展示真实错误信息
        handleClientError(e, { module: "services:file", action: "listDir" });
        throw new Error(
          `无法列出目录内容: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    readFile: async (path: string): Promise<string> => {
      try {
        const result = await http.get<{ content: string }>(
          ENDPOINTS.files.read,
          {
            params: { path },
          },
        );
        return result.content;
      } catch (e) {
        handleClientError(e, { module: "services:file", action: "readFile" });
        // P1-4：透传路径与原始错误（对齐 listDir），便于 UI 定位根因
        throw new Error(
          `无法读取文件 ${path}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    readFileDetail: async (path: string): Promise<FileReadDetail> => {
      try {
        const result = await http.get<FileReadDetail>(ENDPOINTS.files.read, {
          params: { path },
        });
        return result;
      } catch (e) {
        handleClientError(e, {
          module: "services:file",
          action: "readFileDetail",
        });
        // P1-4：透传路径与原始错误（对齐 listDir），便于 UI 定位根因
        throw new Error(
          `无法读取文件 ${path}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    upload: uploadViaHttp,
    uploadBase64: uploadBase64ViaHttp,
    convert: async (params: ConvertFileOptions): Promise<unknown> => {
      return http.post(ENDPOINTS.files.convert, params);
    },
    detect: async (filePath: string): Promise<FileDetectResult> => {
      return http.post<FileDetectResult>(ENDPOINTS.files.detect, { filePath });
    },
    listWorkspaces: async (): Promise<WorkspaceInfo[]> => {
      try {
        return await http.get<WorkspaceInfo[]>(ENDPOINTS.workspace.base);
      } catch (e) {
        handleClientError(e, {
          module: "services:file",
          action: "listWorkspaces",
        });
        return [];
      }
    },
    sendToAI: async (filePath: string): Promise<void> => {
      await http.post(ENDPOINTS.files.sendToAi, { filePath });
    },
    saveToKnowledge: async (filePath: string): Promise<void> => {
      await http.post(ENDPOINTS.knowledge.ingest, { filePath });
    },
    saveToMemory: async (filePath: string): Promise<void> => {
      await http.post(ENDPOINTS.memory.createFromFile, { filePath });
    },
    searchFiles: async (
      params: FileSearchParams,
    ): Promise<FileSearchResult> => {
      const queryParams: Record<string, unknown> = {};
      if (params.query) queryParams.q = params.query;
      if (params.source) queryParams.source = params.source;
      if (params.storeZone) queryParams.store_zone = params.storeZone;
      if (params.startDate) queryParams.start_date = params.startDate;
      if (params.endDate) queryParams.end_date = params.endDate;
      if (params.cursor) queryParams.cursor = params.cursor;
      if (params.limit) queryParams.limit = params.limit;
      return http.get<FileSearchResult>(ENDPOINTS.files.registrySearch, {
        params: queryParams,
      });
    },
    getFileDetail: async (fileId: string): Promise<FileRegistryRecord> => {
      return http.get<FileRegistryRecord>(ENDPOINTS.files.registryDetail, {
        params: { fileId },
      });
    },
    getFileStats: async (): Promise<FileStats> => {
      return http.get<FileStats>(ENDPOINTS.files.registryStats);
    },
    batchDelete: async (ids: string[]): Promise<void> => {
      await deleteRegistryFiles(ids);
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
        .post<{ path: string; size: number }>(ENDPOINTS.files.upload, {
          filename: file.name,
          data: base64,
        })
        .then(resolve)
        .catch(reject);
    };
    reader.onerror = () =>
      reject(new Error(i18n.t("files.readFileFailedGeneric")));
    reader.readAsDataURL(file);
  });
}

async function uploadBase64ViaHttp(
  filename: string,
  base64Data: string,
): Promise<{ path: string; size: number }> {
  return http.post<{ path: string; size: number }>(ENDPOINTS.files.upload, {
    filename,
    data: base64Data,
  });
}

export const fileService = createHttpFileService();

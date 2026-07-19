/**
 * 办公模块 API 服务层（v6）
 * 统一封装所有办公模块接口，含超时控制、CRUD、数据提取
 */

import { http } from "./httpClient";
import type { DocItem } from "../types/office";

/**
 * 创建带超时的 AbortSignal
 * 用于前端兜底，防止骨架屏永驻
 */
function createTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export const officeApi = {
  // ==================== 文档 ====================

  /**
   * 下载文档 blob（15s 超时）
   * 用于前端预览渲染
   */
  downloadDoc: (file: string) =>
    http.get<Blob>(`/v1/doc/download?file=${encodeURIComponent(file)}`, {
      signal: createTimeoutSignal(15000),
      responseType: "blob",
    } as Record<string, unknown>),

  /**
   * 获取综合状态（含连接状态、文件列表、OfficeCLI 信息）
   * 后端 /v1/doc/status 返回统一结构
   */
  getDocStatus: () =>
    http.get<{
      data: {
        status?: string;
        officeCliInfo?: { installed?: boolean; version?: string };
        templateCount?: number;
        templates?: string[];
        documents?: DocItem[];
      };
    }>("/v1/doc/status"),

  /**
   * 从 /v1/doc/status 中提取文件列表
   * 与 getDocStatus 共享端点，但分离数据提取逻辑
   */
  listFiles: async (): Promise<DocItem[]> => {
    const res = await http.get<{
      data: { documents?: DocItem[] };
    }>("/v1/doc/status");
    const resp = res as unknown as { data?: { data?: { documents?: DocItem[] } } };
    return resp?.data?.data?.documents ?? [];
  },

  // ==================== CRUD 操作 ====================

  /** 重命名文档 */
  renameDoc: (name: string, newName: string) =>
    http.post("/v1/doc/rename", { name, newName }),

  /** 删除文档 */
  deleteDoc: (name: string) =>
    http.delete(`/v1/doc/delete?file=${encodeURIComponent(name)}`),

  /** 上传文档 */
  uploadDoc: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return http.post("/v1/doc/upload", form);
  },

  // ==================== 邮件/日历（委托 officeService） ====================
  // 这些接口由现有 officeService 管理，此处仅保留引用路径一致性
};

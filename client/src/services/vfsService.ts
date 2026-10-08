/**
 * VFS 挂载管理服务层
 *
 * 对应后端 `/v1/vfs/mounts`（Spec `ai-vfs-user-mountable.md` §8.2 冻结契约）。
 * 走统一 `http` 封装（返回 `ApiResponse<T>`）：校验失败为 HTTP 400，
 * 通过 `res.error.message` 携带逐条原因，调用方原位展示。
 */

import { http } from "./httpClient";
import type { ApiResponse } from "../types/system";
import type {
  VfsMountInput,
  VfsMountsResponse,
  VfsMountsSaveResponse,
} from "../types/vfs";

export const vfsService = {
  /** 获取当前生效的挂载计划（含 `mcpServers` 供 UI 选择） */
  async listMounts(): Promise<ApiResponse<VfsMountsResponse>> {
    return http.get<VfsMountsResponse>("/v1/vfs/mounts");
  },

  /**
   * 保存挂载配置（写 `vfs.mounts`，唯一事实源）。
   * 校验失败 ⇒ `ok=false` + `error.message`（逐条原因），后端不写盘。
   */
  async saveMounts(
    mounts: VfsMountInput[],
  ): Promise<ApiResponse<VfsMountsSaveResponse>> {
    return http.put<VfsMountsSaveResponse>("/v1/vfs/mounts", { mounts });
  },
};

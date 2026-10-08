import { httpLegacy as http } from "./httpClient";
import { handleClientError } from "../utils/handleError";

/** 沙箱权限级别（与后端 PERMISSION_SANDBOX_DEFAULT 取值一致） */
export type SandboxPermissionLevel = "full" | "standard" | "readonly";

/** 沙箱配置 */
export interface SandboxConfig {
  enabled: boolean;
  permissionLevel: SandboxPermissionLevel;
}

/** 沙箱运行时状态（GET /v1/sandbox/status） */
export interface SandboxStatus {
  enabled: boolean;
  permissionLevel: SandboxPermissionLevel;
  runtimeEnabled: boolean;
  settings: {
    enabled?: boolean;
    allowUnsandboxedCommands?: boolean;
    excludedCommands?: string[];
    filesystem?: Record<string, unknown>;
    network?: Record<string, unknown>;
  };
  constraints: {
    allowedPaths?: string[];
    deniedPaths?: string[];
    allowedCommands?: string[];
    deniedCommands?: string[];
    maxCommandLength?: number;
    maxOutputBytes?: number;
  };
  violationCount: number;
  // 2026-10-08（P1-续 S1/S7）：原 `processStats` / `resourceSummary` / `activeWorkspaceCount`
  // 三字段已删除 —— 后端数据源（`ProcessRegistry` / `ResourceLimitManager` / `WorkspaceManager`）
  // 恒空，已随各子系统整批删除（`GET /v1/sandbox/status` 不再返回这些字段）。
}

/** 沙箱配置与状态服务（S1：对应后端 /v1/sandbox/*） */
export const sandboxService = {
  /** 获取沙箱配置 */
  async getConfig(): Promise<SandboxConfig> {
    try {
      return await http.get<SandboxConfig>("/v1/sandbox/config");
    } catch (e) {
      handleClientError(e, { module: "services:sandbox", action: "getConfig" });
      throw e;
    }
  },

  /** 更新沙箱配置（持久化 + 运行时同步） */
  async updateConfig(patch: Partial<SandboxConfig>): Promise<SandboxConfig> {
    try {
      return await http.put<SandboxConfig>("/v1/sandbox/config", patch);
    } catch (e) {
      handleClientError(e, {
        module: "services:sandbox",
        action: "updateConfig",
      });
      throw e;
    }
  },

  /** 获取沙箱运行时状态 */
  async getStatus(): Promise<SandboxStatus> {
    try {
      return await http.get<SandboxStatus>("/v1/sandbox/status");
    } catch (e) {
      handleClientError(e, { module: "services:sandbox", action: "getStatus" });
      throw e;
    }
  },
};

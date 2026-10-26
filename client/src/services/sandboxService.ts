import { httpLegacy as http } from "./httpClient";
import { handleClientError } from "../utils/handleError";
import { ENDPOINTS } from "./endpoints";

/** 沙箱权限级别（与后端 PERMISSION_SANDBOX_DEFAULT 取值一致） */
export type SandboxPermissionLevel = "full" | "standard" | "readonly";

/** 当前生效的隔离模式（P1-1：`none` ⇒ 无隔离证据，权限级别不参与实际判定） */
export type SandboxIsolationMode =
  | "landlock" | "container" | "ssh" | "pty" | "none";

/** 沙箱配置 */
export interface SandboxConfig {
  enabled: boolean;
  permissionLevel: SandboxPermissionLevel;
  /** 隔离模式（`none` ⇒ 页面诚实降级：禁用级别控件） */
  runtimeIsolation: SandboxIsolationMode;
}

/** 沙箱运行时状态（GET /v1/sandbox/status） */
export interface SandboxStatus {
  enabled: boolean;
  permissionLevel: SandboxPermissionLevel;
  runtimeEnabled: boolean;
  /** 隔离模式（同 `SandboxConfig.runtimeIsolation`） */
  runtimeIsolation: SandboxIsolationMode;
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
  processStats: {
    total: number;
    running: number;
    completed: number;
    killed: number;
    errors: number;
  };
  resourceSummary: {
    totalPlugins: number;
    totalActive: number;
    totalRejected: number;
  };
  activeWorkspaceCount: number;
}

/** 沙箱配置与状态服务（S1：对应后端 /v1/sandbox/*） */
export const sandboxService = {
  /** 获取沙箱配置 */
  async getConfig(): Promise<SandboxConfig> {
    try {
      return await http.get<SandboxConfig>(ENDPOINTS.sandbox.config);
    } catch (e) {
      handleClientError(e, { module: "services:sandbox", action: "getConfig" });
      throw e;
    }
  },

  /** 更新沙箱配置（持久化 + 运行时同步） */
  async updateConfig(patch: Partial<SandboxConfig>): Promise<SandboxConfig> {
    try {
      return await http.put<SandboxConfig>(ENDPOINTS.sandbox.config, patch);
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
      return await http.get<SandboxStatus>(ENDPOINTS.sandbox.status);
    } catch (e) {
      handleClientError(e, { module: "services:sandbox", action: "getStatus" });
      throw e;
    }
  },
};

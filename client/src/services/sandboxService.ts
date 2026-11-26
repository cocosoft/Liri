import { httpLegacy as http } from "./httpClient";
import { handleClientError } from "../utils/handleError";
import { ENDPOINTS } from "./endpoints";

/** 沙箱权限级别（与后端 PERMISSION_SANDBOX_DEFAULT 取值一致） */
export type SandboxPermissionLevel = "full" | "standard" | "readonly";

/** 当前生效的隔离模式（P1-1：`none` ⇒ 无隔离证据，权限级别不参与实际判定） */
export type SandboxIsolationMode =
  "landlock" | "container" | "ssh" | "pty" | "none";

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
  /**
   * A5-①（2026-11-05）：当前安全姿态与 fail-open 风险（语言中立编码）。
   * `null` / 缺省 ⇒ 后端未提供（旧版本），页面不渲染该卡片。
   */
  posture?: {
    mode: string;
    permissionLevel: string;
    /**
     * 2026-11-07（方案 §10）：bash 隔离状态原因。
     * `windows-switch-off` = Windows 上默认不隔离，但打开开关即可（执行期间临时改完整性标签）；
     * `windows-enforced` = Windows 上已隔离（每次执行临时授权、执行后恢复）。
     */
    bashSandboxReason?:
      "enforced" | "windows-enforced" | "switch-off" | "windows-switch-off";
    landlock: {
      enabled: boolean;
      bashEnabled: boolean;
      failClosed: boolean;
      available: boolean;
    };
    /**
     * 2026-11-26：命令工具的写隔离是否真的生效（非只读命令强制进沙箱；生效时不再弹审批卡）。
     */
    shellWriteIsolated?: boolean;
    openRiskCodes: string[];
    bashInterpreterGuard?: boolean;
  } | null;
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

/**
 * 命令执行沙箱（`sandbox.landlock.*`）当前生效配置。
 *
 * 默认值由后端 `readLandlockConfig()` 补齐（`enabled=true / bashEnabled=false /
 * failClosed=false / 路径=[]`），前端不另存一份默认值。
 */
export interface SandboxLandlockConfig {
  enabled: boolean;
  bashEnabled: boolean;
  failClosed: boolean;
  bashExtraWritablePaths: string[];
}

/**
 * 命令执行沙箱探针结论（`GET /v1/diagnostics/sandbox/probe`，S0）。
 *
 * `effective` 是后端用**真实门控**（`decideBashLandlockGate`）加 helper 可执行性事实
 * 归一化后的结论；前端只渲染，不再推断。
 */
export interface SandboxProbe {
  generatedAt: string;
  platform: string;
  config: SandboxLandlockConfig;
  evalForced: boolean;
  gate: { mode: string; reason: string; message?: string };
  effective: "off" | "plain" | "isolated" | "refuse";
  helper: {
    kind: "landlock-run" | "sandbox-exec" | "win-sandbox-run" | "none";
    required: boolean;
    present: boolean | null;
    /** `null` = 本平台无执行探测契约（不得当成可用/不可用） */
    runnable: boolean | null;
    reasonCode: string;
    detail?: string;
    path?: string;
  };
  coverage: { write: boolean; read: boolean; network: boolean };
  affectedTools: string[];
  notes: string[];
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

  /**
   * S0：命令执行沙箱只读探针。
   *
   * @param refresh `true` ⇒ 后端先清三平台探测器缓存再探测（保存开关后必须用，否则回显旧结论）
   */
  async getCommandSandboxProbe(refresh = false): Promise<SandboxProbe> {
    try {
      const url = refresh
        ? `${ENDPOINTS.sandbox.probe}?refresh=1`
        : ENDPOINTS.sandbox.probe;
      return await http.get<SandboxProbe>(url);
    } catch (e) {
      handleClientError(e, {
        module: "services:sandbox",
        action: "getCommandSandboxProbe",
      });
      throw e;
    }
  },

  /**
   * S3：写 `sandbox.landlock.*`（四个字段的补丁语义）。
   *
   * 走 `PUT /v1/config/sandbox`（点号配置段，设置方案 §11.2）：服务端做绝对路径 /
   * 根目录 / 应用数据目录保护校验，并在写后清探测器缓存。`forceWithReason` 是
   * 放行应用数据目录子树时必须给出的显式理由（会被写入审计）。
   */
  async updateLandlockConfig(
    patch: Partial<SandboxLandlockConfig>,
    options: { forceWithReason?: string } = {},
  ): Promise<void> {
    try {
      const value: Record<string, unknown> = { landlock: patch };
      if (options.forceWithReason) {
        value.forceWithReason = options.forceWithReason;
      }
      await http.put<unknown>(ENDPOINTS.config.byKey("sandbox"), { value });
    } catch (e) {
      handleClientError(e, {
        module: "services:sandbox",
        action: "updateLandlockConfig",
      });
      throw e;
    }
  },
};

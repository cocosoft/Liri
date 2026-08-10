/**
 * llama.cpp 集成 API 服务层
 * 提供：状态查询、专业配置读写、服务重启
 */

import { httpLegacy as http } from "./httpClient";

export type LlamaServerStatus =
  "stopped" | "downloading" | "starting" | "running" | "error";

export type LlamaKvCacheTier = "low" | "medium" | "high";

export type LlamaFlashAttn = "off" | "on" | "auto";

export interface LlamaConfig {
  host: string;
  port: number;
  /** GGUF 模型绝对路径 */
  model: string;
  /** 是否随应用自动启动 */
  autoStart: boolean;
  /** GPU 层数（0 = 纯 CPU） */
  gpuLayers: number;
  /** 上下文窗口 */
  contextWindow: number;
  /** KV cache 量化档位（low=q4_0 / medium=q8_0 / high=f16） */
  kvCache: LlamaKvCacheTier;
  /** 计算线程（0 = 自动） */
  threads: number;
  /** 批大小（0 = 自动，默认 2048） */
  batchSize: number;
  /** 采样温度 */
  temperature: number;
  /** top-k */
  topK: number;
  /** top-p */
  topP: number;
  /** repeat-penalty */
  repeatPenalty: number;
  /** seed（-1 = 随机） */
  seed: number;
  /** --no-mmap */
  noMmap: boolean;
  /** --mlock */
  mlock: boolean;
  /** --flash-attn */
  flashAttn: LlamaFlashAttn;
}

export interface LlamaStatus {
  status: LlamaServerStatus;
  version: string;
  binaryExists: boolean;
  running: boolean;
  host: string;
  port: number;
  model: string;
  models: string[];
  modelsDir: string;
  lastError: string | null;
  restartCount: number;
}

export const llamaService = {
  /** 查询集成状态（含 GGUF 模型列表） */
  async getStatus(): Promise<LlamaStatus> {
    const res = await http.get<{ success: boolean; status: LlamaStatus }>(
      "/v1/llama/status",
    );
    return res.status;
  },

  /** 查询当前专业配置 + 状态 */
  async getConfig(): Promise<{ config: LlamaConfig; status: LlamaStatus }> {
    const res = await http.get<{
      success: boolean;
      config: LlamaConfig;
      status: LlamaStatus;
    }>("/v1/llama/config");
    return { config: res.config, status: res.status };
  },

  /** 保存专业配置（后端校验 + 持久化） */
  async saveConfig(config: Partial<LlamaConfig>): Promise<LlamaConfig> {
    const res = await http.put<{ success: boolean; config: LlamaConfig }>(
      "/v1/llama/config",
      config,
    );
    return res.config;
  },

  /** 应用配置并重启服务 */
  async restart(): Promise<void> {
    await http.post<{ success: boolean }>("/v1/llama/restart");
  },
};

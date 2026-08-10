// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * LlamaCppServerManager — llama-server 生命周期管理（Phase 1）
 *
 * 职责：
 *  - 二进制管理：官方预编译 llama-server 下载（锁定版本）、SHA256 校验、解压
 *  - 服务生命周期：子进程拉起、/health 就绪探测、端口接管判断、崩溃退避重启、退出回收
 *  - 状态查询：供 GET /v1/llama/status 与专业配置页面（Phase 3）使用
 *
 * 配置来源优先级：configProvider（config.json llama 段）→ 环境变量 → 默认值
 */

import { spawn, type ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import AdmZip from 'adm-zip';
import { getLogger } from '@modules/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import {
  resolveLlamaBinaryPath,
  resolveLlamaDir,
  resolveLlamaModelsDir,
} from '@modules/core/paths';

const logger = getLogger('ai:llama');

/** 锁定 llama.cpp Release 版本（不追 latest，升级需显式更新；格式 b<5位数字>） */
export const LLAMA_VERSION = 'b10225';

/** 服务器状态 */
export type LlamaServerStatus =
  | 'stopped'
  | 'downloading'
  | 'starting'
  | 'running'
  | 'error';

/** KV cache 量化档位（D1: low=q4_0 / medium=q8_0 / high=f16） */
export type LlamaKvCacheTier = 'low' | 'medium' | 'high';

/** Flash Attention 三态（D2 显式传默认值 auto） */
export type LlamaFlashAttn = 'off' | 'on' | 'auto';

/** llama-server 运行配置（设计定稿 2026-08-10，见 spec §2.5） */
export interface LlamaServerConfig {
  host: string;
  port: number;
  /** GGUF 模型文件绝对路径（为空则不启动服务） */
  model: string;
  /** 是否随应用自动启动 */
  autoStart: boolean;
  /** GPU 层数（0 = 纯 CPU） */
  gpuLayers: number;
  /** 上下文窗口 */
  contextWindow: number;
  /** KV cache 量化档位（--cache-type-k/v） */
  kvCache: LlamaKvCacheTier;
  /** 计算线程（--threads；0 = 不传，llama-server 自动，D3） */
  threads: number;
  /** 批大小（--batch-size；0 = 不传，llama-server 默认 2048，D3） */
  batchSize: number;
  /** 采样温度（--temp；D2 显式传默认值 0.8） */
  temperature: number;
  /** --top-k（D2 默认 40） */
  topK: number;
  /** --top-p（D2 默认 0.95） */
  topP: number;
  /** --repeat-penalty（D2 默认 1.1） */
  repeatPenalty: number;
  /** --seed（D2 默认 -1 = 随机） */
  seed: number;
  /** --no-mmap */
  noMmap: boolean;
  /** --mlock */
  mlock: boolean;
  /** --flash-attn [on/off/auto] */
  flashAttn: LlamaFlashAttn;
}

const DEFAULT_CONFIG: LlamaServerConfig = {
  host: '127.0.0.1',
  port: 11435,
  model: '',
  autoStart: true,
  gpuLayers: 0,
  contextWindow: 4096,
  kvCache: 'high',
  threads: 0,
  batchSize: 0,
  temperature: 0.8,
  topK: 40,
  topP: 0.95,
  repeatPenalty: 1.1,
  seed: -1,
  noMmap: false,
  mlock: false,
  flashAttn: 'auto',
};

/** KV cache 档位 → --cache-type-k/v 值（D1） */
export const KV_CACHE_TYPE: Record<LlamaKvCacheTier, string> = {
  low: 'q4_0',
  medium: 'q8_0',
  high: 'f16',
};

/**
 * 组装 llama-server 启动参数（D4：抽为纯函数便于单测）。
 * 规则：核心参数始终传入；threads/batchSize = 0 时不传（D3 自动语义）；
 * 采样与高级参数显式传默认值（D2）；noMmap/mlock 仅开启时传。
 */
export function buildArgs(config: LlamaServerConfig): string[] {
  const args = [
    '--host',
    config.host,
    '--port',
    String(config.port),
    '--model',
    config.model,
    '--n-gpu-layers',
    String(config.gpuLayers),
    '--ctx-size',
    String(config.contextWindow),
  ];

  const kvType = KV_CACHE_TYPE[config.kvCache];
  args.push('--cache-type-k', kvType, '--cache-type-v', kvType);

  if (config.threads > 0) args.push('--threads', String(config.threads));
  if (config.batchSize > 0) {
    args.push('--batch-size', String(config.batchSize));
  }

  args.push(
    '--temp',
    String(config.temperature),
    '--top-k',
    String(config.topK),
    '--top-p',
    String(config.topP),
    '--repeat-penalty',
    String(config.repeatPenalty),
    '--seed',
    String(config.seed)
  );

  if (config.noMmap) args.push('--no-mmap');
  if (config.mlock) args.push('--mlock');
  args.push('--flash-attn', config.flashAttn);

  return args;
}

/** 崩溃退避重启：基础延迟 1s，指数增长，上限 30s */
const RESTART_BASE_MS = 1000;
const RESTART_MAX_MS = 30000;

/**
 * 默认配置源：从 config.json 的 llama 段读取。
 * 使用 require 按需加载 @modules/config，避免 barrel 循环依赖（paths.ts 同款约束）。
 */
function defaultConfigProvider(): Partial<LlamaServerConfig> {
  try {
    const { getConfigValue } = require('@modules/config') as {
      getConfigValue: <T>(key: string) => T | undefined;
    };
    const cfg = getConfigValue<Partial<LlamaServerConfig>>('llama');
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch {
    return {};
  }
}

/**
 * 平台 → 官方预编译变体名（llama.cpp Release 命名规则 llama-<v>-bin-<variant>.zip）
 * Phase 1 仅覆盖 CPU 变体；CUDA/Metal GPU 变体由专业配置页面（Phase 3）扩展
 */
export function resolveDownloadVariant(): string {
  const { platform, arch } = process;
  if (platform === 'win32' && arch === 'x64') return 'win-cpu-x64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'macos-x64';
  return `linux-${arch}`;
}

/** 下载 URL（可注入便于测试） */
export function resolveDownloadUrl(version = LLAMA_VERSION): string {
  return `https://github.com/ggml-org/llama.cpp/releases/download/${version}/llama-${version}-bin-${resolveDownloadVariant()}.zip`;
}

/**
 * 校验下载内容 SHA256（清单登记时强校验并抛错；未登记时记录实际值并返回）
 * @returns 实际 sha256
 */
export function verifySha256(
  data: Buffer,
  expectedSha256: string | undefined,
  version: string
): string {
  const actual = createHash('sha256').update(data).digest('hex');
  if (expectedSha256) {
    if (actual !== expectedSha256) {
      throw new Error(
        `SHA256 校验失败: 期望 ${expectedSha256}, 实际 ${actual}`
      );
    }
    logger.debug('SHA256 校验通过');
  } else {
    logger.warning(
      `版本 ${version} 未登记 SHA256（请登记后启用强校验），实际=${actual}`
    );
  }
  return actual;
}

/** 状态信息（GET /v1/llama/status 返回体） */
export interface LlamaServerStatusInfo {
  status: LlamaServerStatus;
  version: string;
  binaryExists: boolean;
  binaryPath: string;
  running: boolean;
  host: string;
  port: number;
  model: string;
  modelsDir: string;
  models: string[];
  lastError: string | null;
  restartCount: number;
}

/** 健康探测结果（便于测试断言） */
export interface HealthProbe {
  reachable: boolean;
  port: number;
}

export class LlamaCppServerManager {
  private static instance: LlamaCppServerManager | null = null;

  private config: LlamaServerConfig = { ...DEFAULT_CONFIG };
  private status: LlamaServerStatus = 'stopped';
  private serverProcess: ChildProcess | null = null;
  private lastError: string | null = null;
  private restartCount = 0;
  private shouldRun = false;
  private stopping = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly configProvider: () => Partial<LlamaServerConfig>;

  static getInstance(): LlamaCppServerManager {
    if (!LlamaCppServerManager.instance) {
      LlamaCppServerManager.instance = new LlamaCppServerManager();
    }
    return LlamaCppServerManager.instance;
  }

  /** 仅供测试重置单例 */
  static resetInstance(): void {
    LlamaCppServerManager.instance = null;
  }

  /**
   * @param configProvider 配置源（config.json llama 段），可注入便于测试
   */
  constructor(configProvider?: () => Partial<LlamaServerConfig>) {
    this.configProvider = configProvider ?? defaultConfigProvider;
    this.reloadConfig();
  }

  /**
   * 保存配置：校验 → 合并 → 持久化到 config.json llama 段 → 重新加载
   * 调用方（配置页面）随后可调 restart() 使生效
   */
  async updateConfig(
    partial: Partial<LlamaServerConfig>
  ): Promise<LlamaServerConfig> {
    const validation = this.validateConfig(partial);
    if (!validation.valid) {
      throw new AppError(
        validation.errors.join('; '),
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'LLAMA_CONFIG_INVALID'
      );
    }
    const merged = { ...this.config, ...partial };
    const { setConfigValue } = require('@modules/config') as {
      setConfigValue: (key: string, value: unknown) => void;
    };
    setConfigValue('llama', merged);
    this.config = merged;
    logger.info('llama.cpp 配置已保存', {
      port: merged.port,
      model: merged.model || '(未设置)',
    });
    return { ...merged };
  }

  /** 校验配置：GGUF 存在 / 端口范围 / 数值范围 / 枚举合法性 */
  validateConfig(partial: Partial<LlamaServerConfig>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    const model = partial.model ?? this.config.model;
    if (model && !existsSync(model)) {
      errors.push(`GGUF 模型不存在: ${model}`);
    }

    const port = partial.port ?? this.config.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`端口无效: ${port}（应为 1-65535）`);
    }

    const gpuLayers = partial.gpuLayers ?? this.config.gpuLayers;
    if (!Number.isInteger(gpuLayers) || gpuLayers < 0) {
      errors.push(`GPU 层数无效: ${gpuLayers}（应为 >= 0 的整数）`);
    }

    const contextWindow = partial.contextWindow ?? this.config.contextWindow;
    if (!Number.isInteger(contextWindow) || contextWindow < 512) {
      errors.push(`上下文窗口无效: ${contextWindow}（应 >= 512）`);
    }

    const kvCache = partial.kvCache ?? this.config.kvCache;
    if (!(kvCache in KV_CACHE_TYPE)) {
      errors.push(`KV cache 档位无效: ${kvCache}（应为 low/medium/high）`);
    }

    const threads = partial.threads ?? this.config.threads;
    if (!Number.isInteger(threads) || threads < 0) {
      errors.push(`线程数无效: ${threads}（应为 >= 0 的整数，0=自动）`);
    }

    const batchSize = partial.batchSize ?? this.config.batchSize;
    if (!Number.isInteger(batchSize) || batchSize < 0) {
      errors.push(`批大小无效: ${batchSize}（应为 >= 0 的整数，0=自动）`);
    }

    const temperature = partial.temperature ?? this.config.temperature;
    if (
      typeof temperature !== 'number' ||
      !Number.isFinite(temperature) ||
      temperature < 0 ||
      temperature > 2
    ) {
      errors.push(`温度无效: ${temperature}（应为 0-2）`);
    }

    const topK = partial.topK ?? this.config.topK;
    if (!Number.isInteger(topK) || topK < 1) {
      errors.push(`top-k 无效: ${topK}（应为 >= 1 的整数）`);
    }

    const topP = partial.topP ?? this.config.topP;
    if (
      typeof topP !== 'number' ||
      !Number.isFinite(topP) ||
      topP < 0 ||
      topP > 1
    ) {
      errors.push(`top-p 无效: ${topP}（应为 0-1）`);
    }

    const repeatPenalty = partial.repeatPenalty ?? this.config.repeatPenalty;
    if (
      typeof repeatPenalty !== 'number' ||
      !Number.isFinite(repeatPenalty) ||
      repeatPenalty < 0
    ) {
      errors.push(`repeat-penalty 无效: ${repeatPenalty}（应 >= 0）`);
    }

    const flashAttn = partial.flashAttn ?? this.config.flashAttn;
    if (flashAttn !== 'off' && flashAttn !== 'on' && flashAttn !== 'auto') {
      errors.push(`flash-attn 无效: ${flashAttn}（应为 off/on/auto）`);
    }

    return { valid: errors.length === 0, errors };
  }

  /** 合并配置：configProvider → 环境变量 LLAMA_CPP_PORT/LLAMA_CPP_MODEL → 默认值 */
  reloadConfig(): void {
    const user = this.configProvider() ?? {};
    const envPort = Number(process.env.LLAMA_CPP_PORT);
    const envModel = process.env.LLAMA_CPP_MODEL;
    this.config = {
      host: String(user.host ?? DEFAULT_CONFIG.host),
      port:
        (Number.isFinite(envPort) && envPort > 0
          ? envPort
          : (user.port ?? DEFAULT_CONFIG.port)) ?? DEFAULT_CONFIG.port,
      model: envModel || user.model || DEFAULT_CONFIG.model,
      gpuLayers:
        user.gpuLayers !== undefined
          ? user.gpuLayers
          : DEFAULT_CONFIG.gpuLayers,
      contextWindow:
        user.contextWindow !== undefined
          ? user.contextWindow
          : DEFAULT_CONFIG.contextWindow,
      autoStart:
        user.autoStart !== undefined
          ? user.autoStart
          : DEFAULT_CONFIG.autoStart,
      kvCache: user.kvCache ?? DEFAULT_CONFIG.kvCache,
      threads:
        user.threads !== undefined ? user.threads : DEFAULT_CONFIG.threads,
      batchSize:
        user.batchSize !== undefined
          ? user.batchSize
          : DEFAULT_CONFIG.batchSize,
      temperature:
        user.temperature !== undefined
          ? user.temperature
          : DEFAULT_CONFIG.temperature,
      topK: user.topK !== undefined ? user.topK : DEFAULT_CONFIG.topK,
      topP: user.topP !== undefined ? user.topP : DEFAULT_CONFIG.topP,
      repeatPenalty:
        user.repeatPenalty !== undefined
          ? user.repeatPenalty
          : DEFAULT_CONFIG.repeatPenalty,
      seed: user.seed !== undefined ? user.seed : DEFAULT_CONFIG.seed,
      noMmap: user.noMmap !== undefined ? user.noMmap : DEFAULT_CONFIG.noMmap,
      mlock: user.mlock !== undefined ? user.mlock : DEFAULT_CONFIG.mlock,
      flashAttn: user.flashAttn ?? DEFAULT_CONFIG.flashAttn,
    };
  }

  getConfig(): LlamaServerConfig {
    return { ...this.config };
  }

  /** 扫描用户 GGUF 模型目录（*.gguf） */
  scanModels(): string[] {
    const dir = resolveLlamaModelsDir();
    try {
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.gguf'))
        .map((f) => join(dir, f))
        .sort();
    } catch (err) {
      void handleError(err, {
        module: 'ai:llama',
        action: 'scanModels',
        context: { dir },
      });
      return [];
    }
  }

  /** 汇总状态信息 */
  async getStatus(): Promise<LlamaServerStatusInfo> {
    this.reloadConfig();
    const binaryPath = resolveLlamaBinaryPath();
    return {
      status: this.status,
      version: LLAMA_VERSION,
      binaryExists: existsSync(binaryPath),
      binaryPath,
      running: this.status === 'running',
      host: this.config.host,
      port: this.config.port,
      model: this.config.model,
      modelsDir: resolveLlamaModelsDir(),
      models: this.scanModels(),
      lastError: this.lastError,
      restartCount: this.restartCount,
    };
  }

  // ============================================================
  // 二进制管理
  // ============================================================

  /** 确保二进制存在；缺失时下载+校验+解压 */
  async ensureBinary(): Promise<void> {
    const binaryPath = resolveLlamaBinaryPath();
    if (existsSync(binaryPath)) return;

    this.status = 'downloading';
    logger.info(`llama-server 二进制缺失，开始下载（${LLAMA_VERSION}）`);
    try {
      await this.downloadBinary();
      if (!existsSync(binaryPath)) {
        throw new Error(`下载解压后未找到二进制: ${binaryPath}`);
      }
      logger.info('llama-server 二进制就绪');
    } catch (err) {
      this.status = 'error';
      this.lastError = (err as Error).message;
      await handleError(err, {
        module: 'ai:llama',
        action: 'ensureBinary',
        context: { binaryPath },
      });
      throw err;
    }
  }

  /** 下载官方 zip → SHA256 校验（清单提供时）→ 解压到 llama 目录 */
  private async downloadBinary(): Promise<void> {
    const url = resolveDownloadUrl();
    const llamaDir = resolveLlamaDir();
    mkdirSync(llamaDir, { recursive: true });

    logger.info(`下载 llama.cpp ${LLAMA_VERSION}: ${url}`);
    const res = await fetch(url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    logger.debug(`下载完成 ${buf.length} bytes`);

    // SHA256 校验：清单已登记期望值时强校验；未登记时记录实际值（首次接入）
    verifySha256(buf, EXPECTED_SHA256[LLAMA_VERSION], LLAMA_VERSION);

    // 解压：官方 zip 为扁平结构（llama-server.exe + llama-server-impl.dll + ggml*.dll + libomp 等），全量解压
    const zip = new AdmZip(buf);
    zip.extractAllTo(llamaDir, true);
    const binaryPath = resolveLlamaBinaryPath();
    if (!existsSync(binaryPath)) {
      // 兼容带顶层目录的历史 zip：将 zip 内文件全部提升到 llama 目录根
      for (const e of zip.getEntries()) {
        if (e.isDirectory) continue;
        const name = e.entryName.split('/').pop();
        if (!name) continue;
        writeFileSync(join(llamaDir, name), e.getData());
      }
      if (!existsSync(binaryPath)) {
        throw new Error(`解压后未找到 llama-server 可执行文件: ${binaryPath}`);
      }
    }
  }

  // ============================================================
  // 服务生命周期
  // ============================================================

  /** 探测 llama-server /health（连接成功即视为端口被接管） */
  async isServerRunning(): Promise<HealthProbe> {
    const { host, port } = this.config;
    try {
      const res = await fetch(`http://${host}:${port}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      const reachable = res.ok || res.status === 200;
      return { reachable, port };
    } catch {
      return { reachable: false, port };
    }
  }

  /**
   * 启动服务：确保二进制 → 若端口已有 llama-server 则接管（不重复拉起）→ 否则 spawn
   */
  async start(): Promise<void> {
    this.reloadConfig();
    if (this.serverProcess) return; // 已在运行（本进程管理）

    await this.ensureBinary();
    const probe = await this.isServerRunning();
    if (probe.reachable) {
      // 外部 llama-server 已在该端口运行 → 直接接管
      this.status = 'running';
      this.shouldRun = true;
      logger.info(`检测到端口 ${this.config.port} 已有 llama-server，直接接管`);
      return;
    }

    const { model } = this.config;
    if (!model) {
      this.status = 'error';
      this.lastError = '未配置 GGUF 模型（请先指定模型路径）';
      logger.warning(this.lastError);
      return;
    }

    this.status = 'starting';
    this.shouldRun = true;
    this.stopping = false;
    const args = buildArgs(this.config);
    logger.info(
      `拉起 llama-server: ${resolveLlamaBinaryPath()} ${args.join(' ')}`
    );
    this.serverProcess = spawn(resolveLlamaBinaryPath(), args, {
      stdio: 'ignore',
    });
    this.serverProcess.on('exit', (code, signal) => {
      this.serverProcess = null;
      void this.onProcessExit(code, signal);
    });
    this.serverProcess.on('error', (err) => {
      this.status = 'error';
      this.lastError = err.message;
      void handleError(err, { module: 'ai:llama', action: 'spawn' });
    });

    // 就绪探测（最多 15s，500ms 间隔）
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await this.isServerRunning()) {
        this.status = 'running';
        logger.info('llama-server 就绪');
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    this.status = 'error';
    this.lastError = 'llama-server 启动超时（15s 内未就绪）';
    logger.warning(this.lastError);
  }

  /** 停止服务（回收子进程） */
  async stop(): Promise<void> {
    this.shouldRun = false;
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const proc = this.serverProcess;
    this.serverProcess = null;
    if (proc) {
      proc.kill();
      logger.info('llama-server 已停止');
    }
    this.status = 'stopped';
    this.restartCount = 0;
  }

  /** 应用配置并重启（Phase 3 配置页面「应用并重启」入口） */
  async restart(): Promise<void> {
    await this.stop();
    this.status = 'stopped';
    await this.start();
  }

  /** 子进程退出回调：非主动停止时指数退避重启 */
  private async onProcessExit(
    code: number | null,
    signal: string | null
  ): Promise<void> {
    if (this.stopping || !this.shouldRun) return;
    this.status = 'error';
    this.lastError = `llama-server 退出 code=${code} signal=${signal}`;
    logger.warning(this.lastError, { code, signal });

    this.restartCount += 1;
    const delay = Math.min(
      RESTART_BASE_MS * 2 ** (this.restartCount - 1),
      RESTART_MAX_MS
    );
    logger.info(
      `llama-server 将在 ${delay}ms 后重启（第 ${this.restartCount} 次）`
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start().catch((err) => {
        void handleError(err, { module: 'ai:llama', action: 'restartOnExit' });
      });
    }, delay);
  }
}

/**
 * 各版本期望 SHA256（已登记启用强校验）
 * key: LLAMA_VERSION；value: 期望 sha256（小写 hex）
 */
export const EXPECTED_SHA256: Record<string, string> = {
  // llama-b10225-bin-win-cpu-x64.zip（2026-08-02 Release）
  b10225: '79ae579ed5083435baa0abaee4b3e18d0c5b2eafdb05c8c77afddf3c7977e553',
};

/** 全局单例 */
export const llamaCppServerManager = LlamaCppServerManager.getInstance();

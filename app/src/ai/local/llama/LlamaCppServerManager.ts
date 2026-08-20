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

import { execFile, execSync, spawn, type ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  statSync,
  unlinkSync,
  renameSync,
  appendFileSync,
  watch,
} from 'fs';
import { basename, dirname, extname, join, resolve, normalize } from 'path';
import { createServer, type Server } from 'net';
import AdmZip from 'adm-zip';
import { configManager } from '@modules/config';
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
  /** 用户自定义 GGUF 模型存放目录（为空则使用默认路径） */
  modelsDir?: string;
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
  modelsDir: '', // 空字符串表示使用默认路径
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
 * 估算模型文件加载后可用的安全上下文窗口。
 * 基于：模型文件大小 + KV cache 预估 ≤ 物理内存 × 安全系数(0.65)
 *
 * KV cache 估算公式（llama.cpp 默认 f16 KV）：
 *   kv_cache_bytes ≈ context_tokens × 2 × n_layers × hidden_size × 2 bytes
 *   简化为：context_tokens ≈ (free_ram_gb * 1024^3 * 0.35) / (2 * 2048 * 2)
 *   即：留给 KV cache 的内存 ≈ 剩余内存 × 0.35
 *       每个 token 每层 ≈ 4096 bytes (hidden_size=2048 × 2bytes × 2)
 *
 * 实际场景中 128K context 对 CPU 推理完全没必要，
 * 推荐值根据模型大小分级，既保证对话流畅又不浪费内存。
 */
export function resolveSafeContextWindow(
  modelPath: string,
  currentWindow: number
): { recommended: number; reason: string; autoAdjusted: boolean } {
  // 模型大小检测
  let modelSizeGB = 0;
  try {
    const stat = statSync(modelPath);
    modelSizeGB = stat.size / (1024 * 1024 * 1024);
  } catch {
    // 无法获取模型大小，使用保守默认
    logger.warn('无法获取模型文件大小，使用保守默认 contextWindow');
    return {
      recommended: 4096,
      reason: '模型文件不可访问，使用安全默认值',
      autoAdjusted: true,
    };
  }

  // 物理内存检测
  let totalRAMGB = 0;
  let freeRAMGB = 0;
  try {
    if (process.platform === 'win32') {
      const os = require('os') as {
        totalmem: () => number;
        freemem: () => number;
      };
      totalRAMGB = os.totalmem() / (1024 * 1024 * 1024);
      freeRAMGB = os.freemem() / (1024 * 1024 * 1024);
    } else {
      const os = require('os') as {
        totalmem: () => number;
        freemem: () => number;
      };
      totalRAMGB = os.totalmem() / (1024 * 1024 * 1024);
      freeRAMGB = os.freemem() / (1024 * 1024 * 1024);
    }
  } catch {
    freeRAMGB = 4; // 保守假设
    totalRAMGB = 8;
  }

  // 留给模型 + KV cache 的内存上限（物理内存的 65%）
  const budgetGB = totalRAMGB * 0.65;
  const remainingForKvGB = Math.max(0, budgetGB - modelSizeGB);

  // KV cache 估算：每个 token ≈ 4096 bytes (hidden_size=2048, f16)
  // 实际 hidden_size 因模型而异，但 4096 bytes/token 是保守估算
  const ESTIMATED_BYTES_PER_TOKEN = 4096;
  const maxKvTokensByRAM = Math.floor(
    (remainingForKvGB * 1024 * 1024 * 1024) / ESTIMATED_BYTES_PER_TOKEN
  );

  // 根据模型大小推荐 context window（分级）
  // 小模型 (<3B): 8K~16K
  // 中模型 (3B-13B): 4K~8K
  // 大模型 (>13B): 4K
  let modelBasedRecommendation: number;
  if (modelSizeGB < 2) {
    modelBasedRecommendation = 16384; // 小模型允许较大 context
  } else if (modelSizeGB < 8) {
    modelBasedRecommendation = 8192; // 中模型
  } else {
    modelBasedRecommendation = 4096; // 大模型保守推荐
  }

  // 取两者中较小值：RAM 限制 vs 模型推荐
  const ramLimited = Math.min(maxKvTokensByRAM, 32768); // 硬上限 32K
  const recommended = Math.max(
    2048,
    Math.min(modelBasedRecommendation, ramLimited)
  );

  // 判断当前值是否合理
  const warnings: string[] = [];
  if (currentWindow > 32768) {
    warnings.push(`当前值 ${currentWindow} 远超 32K，对 CPU 推理极不友好`);
  }
  if (currentWindow > maxKvTokensByRAM && maxKvTokensByRAM > 0) {
    warnings.push(
      `当前值 ${currentWindow} 可能超出剩余内存(${remainingForKvGB.toFixed(1)}GB) 能承载的 KV cache 上限(${maxKvTokensByRAM} tokens)`
    );
  }
  if (currentWindow > modelBasedRecommendation * 2) {
    warnings.push(
      `当前值 ${currentWindow} 远超模型 ${modelSizeGB.toFixed(1)}GB 的推荐值(${modelBasedRecommendation})，可能导致加载慢/推理卡`
    );
  }

  if (warnings.length === 0) {
    return {
      recommended: currentWindow,
      reason: `当前值合理（模型 ${modelSizeGB.toFixed(1)}GB, 内存 ${freeRAMGB.toFixed(1)}GB/${totalRAMGB.toFixed(1)}GB）`,
      autoAdjusted: false,
    };
  }

  return {
    recommended,
    reason: warnings.join('；'),
    autoAdjusted: true,
  };
}

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
 * 平台 → 官方预编译变体名（llama.cpp Release 命名规则 llama-<v>-bin-<variant>.<ext>）
 * Phase 1 仅覆盖 CPU 变体；CUDA/Metal GPU 变体由专业配置页面（Phase 3）扩展
 * 变体名必须与官方资产一致：Linux 资产名为 ubuntu-*（非 linux-*），
 * 未知平台直接抛错（曾错误 fallback 到 `linux-${arch}`，导致 win-arm64 下载 linux 包）
 */
export function resolveDownloadVariant(): string {
  const { platform, arch } = process;
  if (platform === 'win32' && arch === 'x64') return 'win-cpu-x64';
  if (platform === 'linux' && arch === 'x64') return 'ubuntu-x64';
  if (platform === 'linux' && arch === 'arm64') return 'ubuntu-arm64';
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'macos-x64';
  throw new AppError(
    `当前平台不受支持（llama.cpp 官方无预编译包: ${platform}-${arch}）`,
    ErrorCategory.EXECUTION,
    ErrorSeverity.HIGH,
    'LLAMA_PLATFORM_UNSUPPORTED'
  );
}

/** 下载 URL（可注入便于测试）；Windows 资产为 .zip，Linux/macOS 资产为 .tar.gz */
export function resolveDownloadUrl(version = LLAMA_VERSION): string {
  const variant = resolveDownloadVariant();
  const ext = variant.startsWith('win-') ? 'zip' : 'tar.gz';
  return `https://github.com/ggml-org/llama.cpp/releases/download/${version}/llama-${version}-bin-${variant}.${ext}`;
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
  /** llama-server 日志文件路径 */
  private logFilePath: string = '';
  /** spawn 子进程 stderr 尾部（失败诊断） */
  private lastStderr = '';
  /** 最近一次健康探测时间（getStatus 节流） */
  private lastHealthProbeAt = 0;
  /** 上次扫描到的 GGUF 列表（模型变更检测） */
  private lastScannedModels: string[] | null = null;
  /** 模型注册同步进行中（防重入） */
  private modelSyncInFlight = false;
  /** 日志事件发射器（用于 SSE 实时推送） */
  private logEventEmitter = new EventEmitter();
  /** 日志监听者数量 */
  private logListeners = 0;
  /** fs.watch 监听器引用 */
  private logWatcher: ReturnType<typeof watch> | null = null;

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
    this.initLogFile();
  }

  /** 初始化日志文件路径，日志写入 ~/.pyapp/logs/llama-server.log */
  private initLogFile(): void {
    try {
      const logDir = join(resolveLlamaDir(), '..', '..', '..', 'logs');
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      this.logFilePath = join(logDir, 'llama-server.log');
      // 写日志头
      const header = `\n===== llama-server 日志 ${new Date().toISOString()} =====\n`;
      appendFileSync(this.logFilePath, header);
      logger.info('llama-server 日志文件已初始化', { path: this.logFilePath });
    } catch (e) {
      logger.warn('llama-server 日志文件初始化失败', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** 获取日志文件内容（用于诊断） */
  getLogContent(maxLines = 200): string {
    try {
      if (!this.logFilePath || !existsSync(this.logFilePath)) {
        return '日志文件不存在';
      }
      const content = readFileSync(this.logFilePath, 'utf-8');
      const lines = content.split('\n');
      return lines.slice(-maxLines).join('\n');
    } catch (e) {
      return `读取日志失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** 获取日志文件当前字节数（用于增量读取） */
  getLogSize(): number {
    try {
      if (!this.logFilePath || !existsSync(this.logFilePath)) {
        return 0;
      }
      return statSync(this.logFilePath).size;
    } catch {
      return 0;
    }
  }

  /** 从指定位置读取增量日志 */
  getLogSincePosition(fromPosition: number): string {
    try {
      if (!this.logFilePath || !existsSync(this.logFilePath)) {
        return '';
      }
      const content = readFileSync(this.logFilePath, 'utf-8');
      if (content.length <= fromPosition) {
        return '';
      }
      return content.slice(fromPosition);
    } catch {
      return '';
    }
  }

  /** 订阅日志实时推送 */
  subscribeLogs(callback: (newContent: string) => void): () => void {
    this.logListeners++;
    this.logEventEmitter.on('log', callback);

    // 启动文件监听（如果还没启动）
    this.ensureLogWatcher();

    // 返回取消订阅函数
    return () => {
      this.logEventEmitter.off('log', callback);
      this.logListeners--;
      if (this.logListeners <= 0) {
        this.stopLogWatcher();
      }
    };
  }

  /** 确保文件监听器正在运行 */
  private ensureLogWatcher(): void {
    if (this.logWatcher || !this.logFilePath) return;

    try {
      const dir = dirname(this.logFilePath);
      const targetName = basename(this.logFilePath);
      this.logWatcher = watch(
        dir,
        (eventType: string, filename: string | null) => {
          if (filename === targetName) {
            this.emitLogUpdate();
          }
        }
      );
      // Windows 上 fs.watch 对 appendFileSync 场景可能漏事件，叠加低频轮询兜底
      this.startLogPolling();
      logger.info('llama-server 日志文件监听器已启动');
    } catch (e) {
      logger.warn('llama-server 日志文件监听器启动失败', {
        error: e instanceof Error ? e.message : String(e),
      });
      // fs.watch 在某些平台不稳定，回退到轮询模式
      this.startLogPolling();
    }
  }

  /** 轮询模式（fs.watch 失败时的后备方案） */
  private logPollingTimer: ReturnType<typeof setInterval> | null = null;

  private startLogPolling(): void {
    if (this.logPollingTimer) return;
    let lastSize = this.getLogSize();
    this.logPollingTimer = setInterval(() => {
      const currentSize = this.getLogSize();
      if (currentSize > lastSize) {
        const newContent = this.getLogSincePosition(lastSize);
        if (newContent) {
          this.logEventEmitter.emit('log', newContent);
        }
        lastSize = currentSize;
      }
    }, 300);
    logger.info('llama-server 日志轮询模式已启动（300ms 间隔）');
  }

  private stopLogPolling(): void {
    if (this.logPollingTimer) {
      clearInterval(this.logPollingTimer);
      this.logPollingTimer = null;
    }
  }

  /** 停止文件监听器 */
  private stopLogWatcher(): void {
    if (this.logWatcher) {
      this.logWatcher.close();
      this.logWatcher = null;
      logger.info('llama-server 日志文件监听器已停止');
    }
    this.stopLogPolling();
  }

  /** 触发日志更新事件 */
  private lastEmittedSize = 0;
  private emitLogUpdate(): void {
    const currentSize = this.getLogSize();
    if (currentSize > this.lastEmittedSize) {
      const newContent = this.getLogSincePosition(this.lastEmittedSize);
      if (newContent) {
        this.lastEmittedSize = currentSize;
        this.logEventEmitter.emit('log', newContent);
      }
    }
  }

  /** 追加日志到文件（带时间戳） */
  private appendLog(stream: 'stdout' | 'stderr', data: string): void {
    if (!this.logFilePath) return;
    try {
      const timestamp = new Date().toISOString();
      const lines = data.split('\n').filter((l) => l.length > 0);
      for (const line of lines) {
        appendFileSync(
          this.logFilePath,
          `[${timestamp}] [${stream}] ${line}\n`
        );
      }
    } catch {
      // 日志写入失败静默处理
    }
  }

  /**
   * 保存配置：校验 → 合并 → 持久化到 config.json llama 段 → 重新加载
   * 调用方（配置页面）随后可调 restart() 使生效
   */
  async updateConfig(
    partial: Partial<LlamaServerConfig>
  ): Promise<LlamaServerConfig> {
    // 合并基准 = config.json 事实源（configProvider），而非含环境变量覆盖的内存态——
    // 否则 LLAMA_CPP_PORT/LLAMA_CPP_MODEL 会随 setConfigValue 整体写回被固化到磁盘，
    // 且后续用户改动会被 env 值「顶掉」
    this.reloadConfig();
    const validation = this.validateConfig(partial);
    if (!validation.valid) {
      throw new AppError(
        validation.errors.join('; '),
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'LLAMA_CONFIG_INVALID'
      );
    }

    // v1.1 新增：校验 modelsDir 路径有效性
    if (partial.modelsDir !== undefined) {
      const dirValidation = validateModelsDir(partial.modelsDir);
      if (!dirValidation.valid) {
        throw new AppError(
          dirValidation.errors.join('; '),
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'MODELS_DIR_INVALID'
        );
      }
      // 使用校验后的规范化路径
      if (dirValidation.resolvedPath) {
        partial.modelsDir = dirValidation.resolvedPath;
      }
    }

    const user = this.configProvider() ?? {};
    const merged = { ...user, ...partial };
    const { setConfigValue } = require('@modules/config') as {
      setConfigValue: (key: string, value: unknown) => void;
    };
    setConfigValue('llama', merged);
    // 重新加载内存态，恢复「环境变量 > config.json > 默认值」的运行时优先级
    this.reloadConfig();
    logger.info('llama.cpp 配置已保存', {
      port: this.config.port,
      model: this.config.model || '(未设置)',
      modelsDir: this.config.modelsDir || '(默认路径)',
    });
    return { ...this.config };
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
    const envPort = Number(configManager.env('LLAMA_CPP_PORT'));
    const envModel = configManager.env('LLAMA_CPP_MODEL');
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
      modelsDir:
        user.modelsDir !== undefined && user.modelsDir !== null
          ? user.modelsDir
          : DEFAULT_CONFIG.modelsDir,
    };
  }

  getConfig(): LlamaServerConfig {
    return { ...this.config };
  }

  /** 扫描用户 GGUF 模型目录（*.gguf），并纳入配置的模型路径（若在扫描目录之外） */
  scanModels(): string[] {
    const modelsRoot = this.config.modelsDir
      ? resolveLlamaModelsDir(this.config.modelsDir)
      : resolveLlamaModelsDir();
    const result = new Set<string>();
    try {
      if (existsSync(modelsRoot)) {
        for (const f of readdirSync(modelsRoot)) {
          if (f.toLowerCase().endsWith('.gguf')) {
            result.add(join(modelsRoot, f));
          }
        }
      }
    } catch (err) {
      void handleError(err, {
        module: 'ai:llama',
        action: 'scanModels',
        context: { dir: modelsRoot },
      });
    }
    // 配置的 model 若指向扫描目录之外的 GGUF，也纳入列表，
    // 避免「服务能启动但该模型不出现在列表/无法被路由」
    const { model } = this.config;
    if (model && model.toLowerCase().endsWith('.gguf') && existsSync(model)) {
      result.add(model);
    }
    return [...result].sort();
  }

  /** 汇总状态信息 */
  async getStatus(): Promise<LlamaServerStatusInfo> {
    this.reloadConfig();
    const binaryPath = resolveLlamaBinaryPath();
    const models = this.scanModels();
    this.maybeResyncModels(models);

    // 运行时健康探测（节流 3s）：接管模式（无进程句柄）或外部进程被杀时，
    // 实时校正 running 状态，避免前端持续显示「运行中」
    if (
      this.status === 'running' &&
      Date.now() - this.lastHealthProbeAt > 3000
    ) {
      this.lastHealthProbeAt = Date.now();
      const probe = await this.isServerRunning();
      if (!probe.reachable && !this.serverProcess) {
        this.status = 'stopped';
        this.lastError = 'llama-server 已停止（端口不可达）';
        logger.warning(this.lastError);
      }
    }

    // 根据配置决定返回的 modelsDir
    const modelsDir = this.config.modelsDir
      ? resolveLlamaModelsDir(this.config.modelsDir)
      : resolveLlamaModelsDir();

    return {
      status: this.status,
      version: LLAMA_VERSION,
      binaryExists: existsSync(binaryPath),
      binaryPath,
      running: this.status === 'running',
      host: this.config.host,
      port: this.config.port,
      model: this.config.model,
      modelsDir,
      models,
      lastError: this.lastError,
      restartCount: this.restartCount,
    };
  }

  /** GGUF 列表变化时触发模型注册同步（防重入、幂等；无模型时无需同步） */
  private maybeResyncModels(models: string[]): void {
    if (models.length === 0) return;
    if (this.modelSyncInFlight || this.status !== 'running') return;
    if (
      this.lastScannedModels &&
      this.sameModelList(this.lastScannedModels, models)
    ) {
      return;
    }
    this.lastScannedModels = models;
    this.modelSyncInFlight = true;
    void (async () => {
      try {
        // 直接调用同模块 syncLlamaModelsToRegistry（不反向 import registerLlamaCppProvider，
        // 避免 registerLlamaCppProvider → LlamaCppServerManager → registerLlamaCppProvider 循环依赖）
        await syncLlamaModelsToRegistry();
      } catch (err) {
        // 非关键路径：同步失败不影响状态查询
        void handleError(err, { module: 'ai:llama', action: 'resyncModels' });
      } finally {
        this.modelSyncInFlight = false;
      }
    })();
  }

  private sameModelList(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
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

    // SHA256 校验：按平台变体登记期望值时强校验；未登记时记录实际值（首次接入）
    const variant = resolveDownloadVariant();
    verifySha256(
      buf,
      EXPECTED_SHA256[LLAMA_VERSION]?.[variant],
      `${LLAMA_VERSION}-${variant}`
    );

    // 解压：按实际包格式分发——Windows 官方资产为 .zip（AdmZip），
    // Linux/macOS 官方资产为 .tar.gz（系统 tar）。用魔数嗅探而非平台判断，
    // 避免测试 mock 与真实平台格式耦合。
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      await this.extractTarGz(buf, llamaDir);
    } else {
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
      }
    }
    if (!existsSync(resolveLlamaBinaryPath())) {
      throw new Error(
        `解压后未找到 llama-server 可执行文件: ${resolveLlamaBinaryPath()}`
      );
    }
  }

  /** 解压 tar.gz（Linux/macOS 官方资产）：临时解压到子目录后扁平化到 llama 目录根 */
  private async extractTarGz(buf: Buffer, destDir: string): Promise<void> {
    const stamp = Date.now();
    const tmpTar = join(destDir, `.llama-${stamp}.tar.gz`);
    const tmpDir = join(destDir, `.extract-${stamp}`);
    writeFileSync(tmpTar, buf);
    mkdirSync(tmpDir, { recursive: true });
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('tar', ['-xzf', tmpTar, '-C', tmpDir], (err) =>
          err ? reject(new Error(`tar 解压失败: ${err.message}`)) : resolve()
        );
      });
      this.flattenDirTo(tmpDir, destDir);
    } finally {
      rmSync(tmpTar, { force: true });
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /** 递归将目录下全部文件（含嵌套子目录）扁平化提升到目标目录（与 zip 提升逻辑对齐） */
  private flattenDirTo(dir: string, destDir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.flattenDirTo(p, destDir);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        writeFileSync(join(destDir, entry.name), readFileSync(p));
      }
    }
  }

  // ============================================================
  // 服务生命周期
  // ============================================================

  /**
   * 检测端口是否可用（TCP bind 试探）。
   * 返回 true = 端口空闲可用，false = 被占用
   */
  static async checkPortAvailable(
    host: string,
    port: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const srv: Server = createServer();
      srv.once('error', () => {
        resolve(false);
      });
      srv.once('listening', () => {
        srv.close(() => resolve(true));
      });
      srv.listen(port, host);
    });
  }

  /**
   * 探测 llama-server /health。
   * 校验响应体为 {"status":"ok"}——仅凭 HTTP 200 会把占用同一端口的其它服务误判为 llama-server
   */
  async isServerRunning(): Promise<HealthProbe> {
    const { host, port } = this.config;
    try {
      const res = await fetch(`http://${host}:${port}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) return { reachable: false, port };
      const data = (await res.json().catch(() => null)) as {
        status?: string;
      } | null;
      const reachable = data?.status === 'ok';
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

      // 校验外部 llama-server 的 n_ctx 是否与 Liri 配置一致
      // 不一致时 warn（不强制重启，避免打断用户手动调试中的服务）
      const externalNctx = await probeLlamaNctx(
        this.config.host,
        this.config.port
      );
      const expectedNctx = this.config.contextWindow;
      if (externalNctx !== null && externalNctx !== expectedNctx) {
        logger.warning(
          `外部 llama-server 的 n_ctx=${externalNctx} 与 Liri 配置 contextWindow=${expectedNctx} 不一致。` +
            `该外部服务可能由用户手动启动，参数未走 Liri 配置链。` +
            `如需 Liri 接管配置：先停止外部 llama-server，再通过设置页重启。`
        );
      }
      return;
    }

    const { model } = this.config;
    if (!model) {
      this.status = 'error';
      this.lastError = '未配置 GGUF 模型（请先指定模型路径）';
      logger.warning(this.lastError);
      return;
    }

    // 上下文窗口安全校验：检测并警告/自动调整不合理的值
    const ctxCheck = resolveSafeContextWindow(model, this.config.contextWindow);
    if (ctxCheck.autoAdjusted) {
      logger.warn('contextWindow 配置不合理，已自动调整', {
        original: this.config.contextWindow,
        adjusted: ctxCheck.recommended,
        reason: ctxCheck.reason,
        model,
      });
      this.config.contextWindow = ctxCheck.recommended;
    } else {
      logger.info('contextWindow 校验通过', {
        contextWindow: this.config.contextWindow,
        reason: ctxCheck.reason,
      });
    }

    const portAvailable = await LlamaCppServerManager.checkPortAvailable(
      this.config.host,
      this.config.port
    );
    if (!portAvailable) {
      this.status = 'error';
      this.lastError = `端口 ${this.config.port} 被其他程序占用，请更换端口或释放该端口`;
      logger.error(this.lastError, {
        host: this.config.host,
        port: this.config.port,
      });
      return;
    }

    this.status = 'starting';
    this.shouldRun = true;
    this.stopping = false;
    this.lastStderr = '';
    const args = buildArgs(this.config);
    logger.info(
      `拉起 llama-server: ${resolveLlamaBinaryPath()} ${args.join(' ')}`
    );
    // stdio 捕获 stderr/stdout 尾部：llama-server 缺 DLL / 参数非法时，失败原因可追溯
    this.serverProcess = spawn(resolveLlamaBinaryPath(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.serverProcess.stderr?.on('data', (d: Buffer) => {
      const text = d.toString();
      this.lastStderr = (this.lastStderr + text).slice(-2000);
      this.appendLog('stderr', text);
    });
    this.serverProcess.stdout?.on('data', (d: Buffer) => {
      this.appendLog('stdout', d.toString());
    });
    this.serverProcess.on('exit', (code, signal) => {
      this.serverProcess = null;
      void this.onProcessExit(code, signal);
    });
    this.serverProcess.on('error', (err) => {
      this.status = 'error';
      this.lastError = `${err.message}${this.lastStderr ? `: ${this.lastStderr.trim()}` : ''}`;
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
    this.lastError = this.lastStderr
      ? `llama-server 启动失败: ${this.lastStderr.trim()}`
      : 'llama-server 启动超时（15s 内未就绪）';
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

  /**
   * 强制杀掉所有 llama-server 进程（用于卡死/无响应时的恢复手段）
   * 与 stop() 不同：
   * - stop() 只回收本管理器 spawn 的子进程
   * - forceKill() 杀掉系统中所有 llama-server 进程，确保彻底清理
   */
  async forceKill(): Promise<{ killed: number; pids: number[] }> {
    logger.warn('执行 forceKill：强制终止所有 llama-server 进程');

    // 1. 先尝试优雅停止本管理器管理的进程
    this.shouldRun = false;
    this.stopping = true;
    const proc = this.serverProcess;
    this.serverProcess = null;
    if (proc) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // SIGKILL 在 Windows 不支持，用 taskkill
      }
    }

    // 2. 杀掉系统中所有 llama-server 进程
    const pids: number[] = [];
    try {
      if (process.platform === 'win32') {
        // Windows: 用 taskkill 强制终止
        const output = execSync('taskkill /F /IM llama-server.exe /T 2>&1', {
          encoding: 'utf-8',
        });
        logger.info('taskkill 执行结果', { output });
      } else {
        // Unix: 用 pkill -9
        execSync('pkill -9 -f llama-server', { encoding: 'utf-8' });
      }
    } catch (e) {
      logger.warn('forceKill 执行异常', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // 3. 等待进程完全退出
    await new Promise((r) => setTimeout(r, 1000));

    // 4. 验证清理结果
    const remaining = await this.countLlamaProcesses();
    logger.info('forceKill 完成', {
      remainingProcesses: remaining,
    });

    this.status = 'stopped';
    this.restartCount = 0;
    this.lastError = null;

    return { killed: remaining === 0 ? 0 : remaining, pids };
  }

  /** 统计当前系统中 llama-server 进程数 */
  private async countLlamaProcesses(): Promise<number> {
    try {
      if (process.platform === 'win32') {
        const output = execSync(
          'tasklist /FI "IMAGENAME eq llama-server.exe" /NH 2>&1',
          { encoding: 'utf-8' }
        );
        return output.includes('llama-server') ? 1 : 0;
      }
      const output = execSync('pgrep -f llama-server || true', {
        encoding: 'utf-8',
      });
      return output.trim() ? output.trim().split('\n').length : 0;
    } catch {
      return 0;
    }
  }

  /** 杀掉后自动重启服务 */
  async forceKillAndRestart(): Promise<void> {
    await this.forceKill();
    await this.start();
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
    this.lastError = `llama-server 退出 code=${code} signal=${signal}${this.lastStderr ? `: ${this.lastStderr.trim()}` : ''}`;
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

/** llamacpp provider 类型（与 providers 表 provider_type 一致） */
const LLAMACPP_PROVIDER_TYPE = 'llamacpp' as const;

/**
 * 从 llama-server 服务端探测真实 n_ctx（--ctx-size 实际值）
 * llama.cpp 的可用窗口由启动参数决定，DB 应跟随服务端真实值而非配置抄写。
 */
export async function probeLlamaNctx(
  host: string,
  port: number
): Promise<number | null> {
  try {
    const res = await fetch(`http://${host}:${port}/props`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      default_generation_settings?: { n_ctx?: number };
    };
    const nctx = data.default_generation_settings?.n_ctx;
    return typeof nctx === 'number' && nctx > 0 ? nctx : null;
  } catch {
    return null;
  }
}

/**
 * 将 GGUF 目录扫描到的模型同步注册到 model_registry（幂等）。
 * 遵循 model-usage.md：DB 唯一事实源，经 ModelPricingService.upsertPricing 写入，
 * 不手写 SQL；完成后刷新 ModelRegistry 缓存与 ModelRouter UUID 缓存。
 * 本函数与 llamaCppServerManager 同模块定义，供 maybeResyncModels 与
 * registerLlamaCppProvider 共用（避免反向 import 造成循环依赖）。
 * @returns 本次新增注册的模型数
 */
export async function syncLlamaModelsToRegistry(): Promise<number> {
  try {
    const status = await llamaCppServerManager.getStatus();
    if (!status.running) return 0;

    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    await providerManager.initialize();
    const provider = (await providerManager.listProviders()).find(
      (p) => p.providerType === LLAMACPP_PROVIDER_TYPE
    );
    if (!provider) return 0;
    const providerId = provider.id;
    // 主动探测：从服务端 /props 获取真实 n_ctx（llama-server 实际 --ctx-size），
    // 探测失败回退 llama 配置值。DB 跟随服务端真实值，消除"配置改了 DB 不跟随"脱节。
    const probedNctx = await probeLlamaNctx(
      status.host || '127.0.0.1',
      status.port
    );
    const contextWindow =
      probedNctx ?? llamaCppServerManager.getConfig().contextWindow;

    const { modelPricingService } =
      await import('@modules/ai/models/ModelPricingService.js');
    await modelPricingService.initialize();

    let registered = 0;
    let updated = 0;
    for (const ggufPath of status.models) {
      const ext = extname(ggufPath);
      if (ext.toLowerCase() !== '.gguf') continue;
      const modelId = basename(ggufPath, ext);
      if (!modelId) continue;

      const existing = await modelPricingService.getPricing(modelId);
      if (existing) {
        if (existing.providerId === providerId) {
          // 已注册且归属本 provider：若 context_window 与当前服务端不一致则更新，
          // 消除"服务端 --ctx-size 已变、DB 仍旧值"的脱节（无需手动同步）
          if (existing.contextWindow !== contextWindow) {
            await modelPricingService.upsertPricing({
              modelId,
              contextWindow,
              inputCostPerMillion: existing.inputCostPerMillion,
              outputCostPerMillion: existing.outputCostPerMillion,
            });
            updated++;
          }
          continue;
        }
        logger.warning(
          `模型 ${modelId} 已被其他 provider 占用，跳过 GGUF 注册`
        );
        continue;
      }

      await modelPricingService.upsertPricing({
        modelId,
        displayName: modelId,
        providerId,
        contextWindow,
        maxOutputTokens: 8192,
        // 仅写入合法 ModelCapability 枚举值（'chat' 非法会被 loadModelsFromDb 静默过滤）
        capabilities: ['streaming'],
        inputCostPerMillion: 0,
        outputCostPerMillion: 0,
      });
      registered++;
    }

    // 真实化对账：删除归属本 provider 但本地已不存在的模型（与 Ollama 同步一致）
    let removed = 0;
    const localModelIds = new Set(
      status.models
        .filter((p) => extname(p).toLowerCase() === '.gguf')
        .map((p) => basename(p, extname(p)))
        .filter((m) => m)
    );
    const allModels = await modelPricingService.getAllPricing();
    for (const m of allModels) {
      if (m.providerId === providerId && !localModelIds.has(m.modelId)) {
        if (await modelPricingService.deleteModelById(m.id)) removed++;
      }
    }

    if (registered > 0 || updated > 0 || removed > 0) {
      const { ModelRegistry } =
        await import('@modules/ai/models/ModelRegistry.js');
      ModelRegistry.getInstance()
        .refreshDbPricing()
        .catch((er: unknown) => {
          // @ignore-catch: 非关键缓存刷新
          logger.warning('refreshDbPricing 失败(llama sync)', {
            error: (er as Error).message,
          });
        });
      const { modelRouter } = await import('@modules/ai/modelRouter.js');
      modelRouter.invalidateUuidCache().catch((er: unknown) => {
        // @ignore-catch: 非关键缓存刷新
        logger.warning('invalidateUuidCache 失败(llama sync)', {
          error: (er as Error).message,
        });
      });
      if (updated > 0) {
        logger.info(
          `已同步 ${updated} 个 GGUF 模型 context_window（跟随服务端 n_ctx=${contextWindow}）`
        );
      }
      if (registered > 0) {
        logger.info(`已同步 ${registered} 个 GGUF 模型到 model_registry`);
      }
      if (removed > 0) {
        logger.info(`已清理 ${removed} 个本地已不存在的 GGUF 模型记录`);
      }
    }
    return registered;
  } catch (err) {
    await handleError(err, {
      module: 'ai:llama',
      action: 'syncLlamaModelsToRegistry',
    });
    return 0;
  }
}

/**
 * 各版本/变体期望 SHA256（已登记启用强校验；未登记时仅 warning 并记录实际值）
 * key: LLAMA_VERSION → variant；value: 期望 sha256（小写 hex）
 * 官方校验值来源：GitHub Release API digest（2026-08-02 发布，asset digest 逐项核对）
 */
export const EXPECTED_SHA256: Record<string, Record<string, string>> = {
  b10225: {
    'win-cpu-x64':
      '79ae579ed5083435baa0abaee4b3e18d0c5b2eafdb05c8c77afddf3c7977e553',
    'ubuntu-x64':
      '0ddec0d5868abd5c892725c872db76f3867891a88f33205e41452f5955c84085',
    'ubuntu-arm64':
      'e9eff82a9846e66a75127bad039cca5d97714dc6cd5be552ccc7aeb026f41d98',
    'macos-arm64':
      '22501218e24108aff81fddf298c1afecb017be52adfd0810d2c64da3519e3c69',
    'macos-x64':
      'd087717d40d30d8bcf88cd84a67189d3c8891a572fd87b22e7d0dfcafac84dd6',
  },
};

// ============================================================
// 路径安全检查（Task 1.2）
// ============================================================

/** 跨平台禁止作为模型目录的系统路径 */
const FORBIDDEN_DIRS: Record<string, string[]> = {
  win32: [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    'C:\\Users\\All Users',
  ],
  darwin: ['/System', '/Library', '/Applications', '/private', '/dev'],
  linux: [
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/boot',
    '/dev',
    '/proc',
    '/sys',
    '/run',
    '/var',
  ],
};

/**
 * 获取当前平台禁止的路径列表
 */
function getForbiddenPaths(): string[] {
  return FORBIDDEN_DIRS[process.platform] || [];
}

/**
 * 检查路径是否在父目录内（安全检查）
 */
function isPathWithin(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  return (
    resolvedChild.startsWith(resolvedParent + require('path').sep) ||
    resolvedChild === resolvedParent
  );
}

/**
 * 校验模型目录是否有效
 * @param dir 目录路径
 * @returns 校验结果
 */
export function validateModelsDir(dir: string): {
  valid: boolean;
  errors: string[];
  resolvedPath?: string;
} {
  const errors: string[] = [];

  if (!dir || typeof dir !== 'string') {
    return { valid: false, errors: ['目录路径不能为空'] };
  }

  try {
    // 规范化路径
    const normalized = normalize(dir);
    const resolved = resolve(normalized);

    // 检查是否为禁止路径
    const forbiddenPaths = getForbiddenPaths();
    for (const forbidden of forbiddenPaths) {
      if (resolved === forbidden || isPathWithin(forbidden, resolved)) {
        errors.push(`禁止将模型目录设置到系统路径: ${forbidden}`);
        return { valid: false, errors };
      }
    }

    // 尝试创建目录（如不存在）
    if (!existsSync(resolved)) {
      try {
        mkdirSync(resolved, { recursive: true });
      } catch (err) {
        errors.push(`无法创建目录: ${resolved}`);
        return { valid: false, errors };
      }
    }

    // 检查是否为目录
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      errors.push(`路径不是目录: ${resolved}`);
      return { valid: false, errors };
    }

    // 测试写入权限（创建临时文件然后删除）
    const testFile = join(resolved, `.llama-test-${Date.now()}`);
    try {
      writeFileSync(testFile, 'test');
      unlinkSync(testFile);
    } catch (err) {
      errors.push(`目录不可写: ${resolved}`);
      return { valid: false, errors };
    }

    return { valid: true, errors: [], resolvedPath: resolved };
  } catch (err) {
    errors.push(`路径检查失败: ${(err as Error).message}`);
    return { valid: false, errors };
  }
}

/**
 * 确保迁移路径安全
 * @param targetPath 目标路径
 * @param sourceDir 源目录
 * @returns 安全的目标路径
 */
export function ensureSafeMigrationPath(
  targetPath: string,
  sourceDir: string
): {
  valid: boolean;
  errors: string[];
  safePath?: string;
} {
  const errors: string[] = [];

  try {
    // 1. 规范化并解析路径
    const normalizedTarget = normalize(targetPath);
    const resolvedTarget = resolve(normalizedTarget);
    const resolvedSource = resolve(normalize(sourceDir));

    // 2. 检查目标是否为源或源的子目录
    if (resolvedTarget === resolvedSource) {
      errors.push('目标目录与源目录相同');
      return { valid: false, errors };
    }

    if (isPathWithin(resolvedSource, resolvedTarget)) {
      errors.push('目标目录不能是源目录的子目录');
      return { valid: false, errors };
    }

    // 3. 检查是否为禁止路径
    const forbiddenPaths = getForbiddenPaths();
    for (const forbidden of forbiddenPaths) {
      if (
        resolvedTarget === forbidden ||
        isPathWithin(forbidden, resolvedTarget)
      ) {
        errors.push(`禁止迁移到系统路径: ${forbidden}`);
        return { valid: false, errors };
      }
    }

    // 4. 校验目录有效性
    const validation = validateModelsDir(resolvedTarget);
    if (!validation.valid) {
      return { valid: false, errors: validation.errors };
    }

    return { valid: true, errors: [], safePath: resolvedTarget };
  } catch (err) {
    errors.push(`路径检查失败: ${(err as Error).message}`);
    return { valid: false, errors };
  }
}

// ============================================================
// 模型迁移功能（Task 2.1）
// ============================================================

/** 迁移进度事件 */
export interface MigrateProgress {
  current: number;
  total: number;
  file: string;
  percent: number;
  phase: 'migrating' | 'skipped' | 'error';
  error?: string;
}

/** 迁移结果 */
export interface LlamaMigrateResponse {
  success: boolean;
  migratedFiles: Array<{
    source: string;
    destination: string;
    size: number;
  }>;
  skippedFiles: string[];
  failedFiles: Array<{
    path: string;
    error: string;
  }>;
  elapsedMs: number;
}

/**
 * 扫描目录下所有 .gguf 文件（递归，带深度限制）
 */
export async function scanGgufFiles(
  dir: string,
  depth: number = 0,
  maxDepth: number = 5
): Promise<string[]> {
  const fs = require('fs/promises');
  const results: string[] = [];

  logger.debug('开始扫描 GGUF 文件', { dir, depth, maxDepth });

  // 超过最大深度则停止递归
  if (depth > maxDepth) {
    logger.debug('达到最大递归深度，停止扫描', { dir, depth });
    return results;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    logger.debug('读取目录条目', { dir, entryCount: entries.length });

    let ggufCount = 0;
    let dirCount = 0;

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // 跳过符号链接目录（防止循环引用）
        if (entry.isSymbolicLink?.()) {
          logger.warn('跳过符号链接目录，防止无限递归', { path: fullPath });
          continue;
        }
        dirCount++;
        const subFiles = await scanGgufFiles(fullPath, depth + 1, maxDepth);
        results.push(...subFiles);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
        results.push(fullPath);
        ggufCount++;
        logger.debug('找到 GGUF 文件', { path: fullPath, size: 'pending' });
      }
    }

    logger.debug('目录扫描完成', {
      dir,
      ggufFound: ggufCount,
      subDirs: dirCount,
      depth,
      totalResults: results.length,
    });
  } catch (err: any) {
    logger.warn('目录扫描失败', {
      dir,
      depth,
      error: err.code || err.message,
      reason:
        err.code === 'ENOENT'
          ? '目录不存在'
          : err.code === 'EACCES'
            ? '无权限'
            : '其他错误',
    });
    // 目录不存在或无权限，静默返回
  }

  return results;
}

/**
 * 模型迁移进度回调类型
 */
export type MigrateProgressCallback = (progress: MigrateProgress) => void;

/**
 * 扩展 LlamaCppServerManager 类，添加迁移方法
 */
declare module './LlamaCppServerManager.js' {
  interface LlamaCppServerManager {
    migrateModels(params: {
      targetDir: string;
      copy: boolean;
      overwrite: boolean;
      onProgress?: MigrateProgressCallback;
      signal?: AbortSignal;
    }): Promise<LlamaMigrateResponse>;
  }
}

// 在 LlamaCppServerManager 类原型上添加 migrateModels 方法
LlamaCppServerManager.prototype.migrateModels = async function (params: {
  targetDir: string;
  copy: boolean;
  overwrite: boolean;
  onProgress?: MigrateProgressCallback;
  signal?: AbortSignal;
}): Promise<LlamaMigrateResponse> {
  const startTime = Date.now();
  const config = this.getConfig();
  const sourceDir = config.modelsDir
    ? resolveLlamaModelsDir(config.modelsDir)
    : resolveLlamaModelsDir();
  const { targetDir, copy, overwrite, onProgress, signal } = params;

  const result: LlamaMigrateResponse = {
    success: true,
    migratedFiles: [],
    skippedFiles: [],
    failedFiles: [],
    elapsedMs: 0,
  };

  logger.info('开始迁移模型文件', {
    sourceDir,
    targetDir,
    mode: copy ? 'copy' : 'move',
    overwrite,
    autoStart: config.autoStart,
  });

  // 1. 获取源目录所有 .gguf 文件
  logger.info('扫描源目录中的 GGUF 文件', { sourceDir });
  const scanStart = Date.now();
  const sourceFiles = await scanGgufFiles(sourceDir, 0, 5);
  const scanDurationMs = Date.now() - scanStart;
  logger.info('扫描完成', {
    sourceDir,
    fileCount: sourceFiles.length,
    scanDurationMs,
  });

  if (sourceFiles.length === 0) {
    logger.info('源目录无 GGUF 文件，无需迁移', { sourceDir });
    result.elapsedMs = Date.now() - startTime;
    return result;
  }

  // 2. 统计源文件总大小
  let totalSizeBytes = 0;
  try {
    for (const f of sourceFiles) {
      totalSizeBytes += statSync(f).size;
    }
  } catch {}
  logger.info('待迁移文件统计', {
    fileCount: sourceFiles.length,
    totalSizeGB: (totalSizeBytes / 1024 ** 3).toFixed(2),
  });

  // 3. 逐文件迁移
  for (let i = 0; i < sourceFiles.length; i++) {
    // 检查是否取消
    if (signal?.aborted) {
      result.success = false;
      logger.info('迁移被用户取消', {
        processed: i,
        total: sourceFiles.length,
        migrated: result.migratedFiles.length,
        skipped: result.skippedFiles.length,
        failed: result.failedFiles.length,
      });
      break;
    }

    const sourcePath = sourceFiles[i];
    const fileName = basename(sourcePath);
    const destPath = join(targetDir, fileName);

    logger.debug('开始处理文件', {
      index: i + 1,
      total: sourceFiles.length,
      fileName,
      sourcePath,
      destPath,
    });

    try {
      // 检查目标是否已存在
      const destExists = existsSync(destPath);

      if (destExists && !overwrite) {
        const existingSize = statSync(destPath).size;
        result.skippedFiles.push(sourcePath);
        logger.debug('文件已存在且不覆盖，跳过', {
          fileName,
          destPath,
          existingSizeGB: (existingSize / 1024 ** 3).toFixed(2),
        });
        onProgress?.({
          current: i + 1,
          total: sourceFiles.length,
          file: fileName,
          percent: Math.round(((i + 1) / sourceFiles.length) * 100),
          phase: 'skipped',
        });
        continue;
      }

      // 获取源文件大小
      const stat = statSync(sourcePath);
      const fileSizeGB = stat.size / 1024 ** 3;

      // 迁移文件
      if (copy) {
        // 复制模式
        logger.debug('复制文件中', { fileName, sizeGB: fileSizeGB.toFixed(2) });
        const fsPromises = require('fs/promises');
        await fsPromises.copyFile(sourcePath, destPath);
      } else {
        // 移动模式（跨磁盘时自动降级）
        try {
          logger.debug('移动文件中', {
            fileName,
            sizeGB: fileSizeGB.toFixed(2),
          });
          renameSync(sourcePath, destPath);
        } catch (err: any) {
          if (err.code === 'EXDEV' || err.code === 'XDEV') {
            // 跨盘符降级：复制 + 删除源
            logger.info('跨磁盘移动已降级为复制+删除', {
              fileName,
              sourcePath,
              destPath,
              errorCode: err.code,
            });
            const fsPromises = require('fs/promises');
            await fsPromises.copyFile(sourcePath, destPath);
            unlinkSync(sourcePath);
            logger.debug('降级迁移完成', { fileName });
          } else {
            logger.error('移动文件失败', {
              fileName,
              sourcePath,
              destPath,
              errorCode: err.code,
              errorMessage: err.message,
            });
            throw err;
          }
        }
      }

      // 验证文件
      const destStat = statSync(destPath);
      result.migratedFiles.push({
        source: sourcePath,
        destination: destPath,
        size: stat.size,
      });

      logger.info('文件迁移成功', {
        fileName,
        sizeGB: fileSizeGB.toFixed(2),
        mode: copy ? 'copy' : 'move',
      });

      // 推送进度
      onProgress?.({
        current: i + 1,
        total: sourceFiles.length,
        file: fileName,
        percent: Math.round(((i + 1) / sourceFiles.length) * 100),
        phase: 'migrating',
      });
    } catch (fileError: any) {
      result.failedFiles.push({
        path: sourcePath,
        error:
          fileError instanceof Error ? fileError.message : String(fileError),
      });
      result.success = false;

      logger.error('文件迁移失败', {
        fileName,
        sourcePath,
        errorCode: fileError.code,
        errorMessage: fileError.message || String(fileError),
        stack: fileError.stack?.slice(0, 200),
      });

      onProgress?.({
        current: i + 1,
        total: sourceFiles.length,
        file: fileName,
        percent: Math.round(((i + 1) / sourceFiles.length) * 100),
        phase: 'error',
        error:
          fileError instanceof Error ? fileError.message : String(fileError),
      });
    }
  }

  result.elapsedMs = Date.now() - startTime;

  logger.info('模型迁移完成', {
    success: result.success,
    sourceDir,
    targetDir,
    migrated: result.migratedFiles.length,
    migratedSizeGB: (
      result.migratedFiles.reduce((s, f) => s + f.size, 0) /
      1024 ** 3
    ).toFixed(2),
    skipped: result.skippedFiles.length,
    failed: result.failedFiles.length,
    elapsedMs: result.elapsedMs,
    failedDetails: result.failedFiles.map((f) => ({
      path: f.path,
      error: f.error.slice(0, 100),
    })),
  });

  return result;
};

/** 全局单例 */
export const llamaCppServerManager = LlamaCppServerManager.getInstance();

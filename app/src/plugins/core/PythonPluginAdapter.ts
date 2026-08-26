/**
 * PythonPluginAdapter — Python 插件 → plugins 体系适配层（PY-3）
 *
 * 职责：
 * 1. 生命周期映射：initialize（spawn venv 解释器 + startup 握手 + 协议版本协商）/
 *    activate（pull listTools/listSkills 注册进全局 ToolRegistry）/
 *    deactivate / destroy（shutdown RPC → 强杀 → 注销工具）
 * 2. 工具/技能注册：activate 后 pull，命名冲突 onConflict='error'（不静默覆盖）
 * 3. 服务注入反向 RPC：Python 侧 ServiceProxy 调用经 fromChild 请求转发到 KernelServiceRegistry，
 *    注入白名单 = manifest inject/injectOptional 并集（防提权）
 * 4. config / events 主进程侧桥接
 *
 * 桥：复用 JsonRpcBridge（PY-1 泛化基类），pythonPath = venv 内解释器。
 */
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import {
  JsonRpcBridge,
  BRIDGE_PROTOCOL_VERSION,
} from '../../ai/python/JsonRpcBridge';
import { WorkerGuard } from '../../ai/python/WorkerGuard';
import { getToolRegistry } from '../../tools/ToolRegistry';
import { buildTool } from '../../tools/types/Tool';
import type { ToolParam } from '../../tools/types/Tool';
import { createToolResult } from '../../tools/types/ToolResult';
import {
  KernelServiceRegistry,
  KernelServiceId,
} from '../api/KernelServiceRegistry';
import { resolveDataSubDir } from '@modules/core/paths';
import { join, delimiter } from 'path';
import { trackProcess } from '../../services/mcp/transports/ChildProcessTracker';
import { globalEventBus } from '../../core/events/EventBus';

const logger = getLogger('plugins:core:pythonPluginAdapter');

/** Python 插件运行时状态 */
export type PythonPluginState =
  | 'created'
  | 'starting'
  | 'running'
  | 'failed'
  | 'stopped';

/** PythonPluginAdapter 配置 */
export interface PythonPluginConfig {
  pluginId: string;
  pluginName: string;
  version: string;
  /** venv 内解释器路径（spawn 必传，杜绝 PATH 误用） */
  pythonPath: string;
  /** 插件入口脚本（main.py） */
  workerScript: string;
  /** 启动超时（默认 15s，大依赖场景） */
  startupTimeoutMs?: number;
  /** 受限 env（buildSafeEnv 基线 + PYTHONPATH 注入 vendored SDK） */
  env?: NodeJS.ProcessEnv;
  /** 注入白名单（manifest inject） */
  inject?: string[];
  /** 注入白名单（manifest injectOptional） */
  injectOptional?: string[];
}

/** Python 插件声明的工具（对齐 ToolRegistration 结构） */
export interface PythonToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Python 插件声明的技能 */
export interface PythonSkillInfo {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * PythonPluginAdapter
 * 管理一个 Python 插件子进程（经 WorkerGuard 看护，崩溃自动重启 + 熔断），
 * 实现生命周期 + 工具注册 + 服务注入桥接。
 */
export class PythonPluginAdapter {
  private guard: WorkerGuard;
  private state: PythonPluginState = 'created';
  private tools: PythonToolInfo[] = [];
  private skills: PythonSkillInfo[] = [];
  private config: PythonPluginConfig;
  private registry: KernelServiceRegistry;
  /** 主进程侧 config 存储（pluginId → key → value，JSON 文件持久化） */
  private configStore: Record<string, unknown> = {};
  private configPath: string;
  /** 插件订阅的事件列表 */
  private subscribedEvents: Set<string> = new Set();

  constructor(config: PythonPluginConfig, registry: KernelServiceRegistry) {
    this.config = config;
    this.registry = registry;
    this.configPath = join(
      resolveDataSubDir('plugin-config'),
      `${config.pluginId}.json`
    );
    // PY-5：WorkerGuard 看护（bridge factory 注入 venv 解释器配置；崩溃指数退避重启 + 熔断）
    this.guard = new WorkerGuard({
      createBridge: () =>
        new JsonRpcBridge({
          pythonPath: config.pythonPath,
          workerScript: config.workerScript,
          startupTimeoutMs: config.startupTimeoutMs ?? 15000,
          // PY-3 vendored 定位：默认把 vendored liri-sdk 目录注入 PYTHONPATH，
          // 使「无 pip 依赖的插件能 import liri」默认成立（调用方可覆盖）
          env: buildSpawnEnv(config),
          onChildRequest: (method, params) =>
            this.handleChildRequest(method, params),
          onNotify: (frame) => this.handleNotify(frame),
        }),
      circuitMessage: `Python plugin ${config.pluginId} 已熔断停用（连续崩溃）`,
      // M2：崩溃自动恢复后复检协议版本（initialize RPC）
      onRecovered: () => this.renegotiateProtocol(),
    });
  }

  /** M2：崩溃自动恢复后重新做 initialize 版本协商（不重新 spawn） */
  private async renegotiateProtocol(): Promise<void> {
    try {
      const init = await this.guard.requestResult<{
        protocolVersion: number;
      }>('initialize', {});
      if (init.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
        logger.warn(
          `Python plugin ${this.config.pluginId} 恢复后协议版本不匹配: ` +
            `${init.protocolVersion} vs ${BRIDGE_PROTOCOL_VERSION}`
        );
        this.state = 'failed';
      } else {
        logger.info(`Python plugin ${this.config.pluginId} 恢复后版本协商通过`);
      }
    } catch (error) {
      logger.warn(`Python plugin ${this.config.pluginId} 恢复后版本协商失败`, {
        error,
      });
    }
  }

  // ==================== 生命周期 ====================

  /** initialize：spawn + startup 握手 + initialize RPC（协议版本协商） */
  async initialize(sessionId?: string): Promise<void> {
    this.state = 'starting';
    try {
      await this.guard.start();
      const init = await this.guard.requestResult<{
        protocolVersion: number;
      }>('initialize', { sessionId });
      if (init.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
        throw new AppError(
          `Python plugin ${this.config.pluginId} 协议版本不兼容: ` +
            `子进程 ${init.protocolVersion} vs 主进程 ${BRIDGE_PROTOCOL_VERSION}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'PYTHON_PLUGIN_PROTOCOL_MISMATCH'
        );
      }
      this.loadConfigFromDisk();
      this.state = 'running';
      // PY-5：注册进 ChildProcessTracker，主进程退出时统一回收，避免孤儿进程
      const child = this.guard.getBridge().getProcess();
      if (child?.pid) {
        trackProcess(child, this.config.pluginId);
      }
      logger.info(`Python plugin ${this.config.pluginId} initialized`, {
        protocolVersion: init.protocolVersion,
      });
    } catch (error) {
      this.state = 'failed';
      throw error;
    }
  }

  /** activate：pull 工具/技能清单并注册进全局 ToolRegistry */
  async activate(): Promise<void> {
    const [tools, skills] = await Promise.all([
      this.guard.requestResult<PythonToolInfo[]>('listTools', {}),
      this.guard.requestResult<PythonSkillInfo[]>('listSkills', {}),
    ]);
    this.tools = tools ?? [];
    this.skills = skills ?? [];

    // 注册工具到全局单例 ToolRegistry（撞名报错，不静默覆盖）
    const registry = getToolRegistry();
    for (const tool of this.tools) {
      registry.registerTool(
        toRegisteredTool(tool, (args) => this.callTool(tool.name, args)),
        {
          onConflict: 'error',
        }
      );
    }
    logger.info(`Python plugin ${this.config.pluginId} activated`, {
      tools: this.tools.map((t) => t.name),
      skills: this.skills.map((s) => s.id),
    });
  }

  /**
   * deactivate：优雅停用（M3 语义明确）
   * 注意：**deactivate ≠ 销毁子进程**——首版进程与插件生命周期绑定，
   * 进程销毁只在 destroy()（shutdown RPC + 注销工具 + 进程回收）统一处理。
   * 上层如需"停用但保留进程"应使用 WorkerGuard 熔断/健康机制，勿依赖本方法销毁进程。
   */
  async deactivate(): Promise<void> {
    // 首版：停用不销毁进程（热替换/按需暂停留后续迭代）
    this.state = 'running';
  }

  /** destroy：shutdown RPC → 进程终止 → 注销工具 → 清订阅 */
  async destroy(): Promise<void> {
    try {
      await this.guard.requestResult('shutdown', {}, 3000);
    } catch {
      // shutdown 失败不阻断销毁
    } finally {
      this.guard.destroy();
    }
    this.unregisterTools();
    this.subscribedEvents.clear();
    this.state = 'stopped';
    logger.info(`Python plugin ${this.config.pluginId} destroyed`);
  }

  /** 注销该插件注册的全部工具 */
  private unregisterTools(): void {
    const registry = getToolRegistry();
    for (const tool of this.tools) {
      registry.unregisterTool(tool.name);
    }
    this.tools = [];
  }

  // ==================== 调用 ====================

  /** 调用 Python 插件工具 */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    return this.guard.requestResult('callTool', { name, args });
  }

  /** 执行 Python 插件技能 */
  async executeSkill(
    id: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    return this.guard.requestResult('executeSkill', { id, args });
  }

  /** 向 Python 插件推送系统事件（notify） */
  notify(event: string, data: unknown): void {
    if (!this.subscribedEvents.has(event)) return;
    this.guard.getBridge().sendNotify({ event, data });
  }

  // ==================== 反向 RPC（子进程 → 主进程） ====================

  private async handleChildRequest(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case 'injectService':
        return this.handleInjectService(params);
      case 'getConfig':
        return this.configStore[String(params.key)];
      case 'setConfig':
        this.configStore[String(params.key)] = params.value;
        return undefined;
      case 'saveConfig':
        this.persistConfig();
        return undefined;
      case 'subscribeEvent':
        this.subscribedEvents.add(String(params.event));
        return undefined;
      case 'unsubscribeEvent':
        this.subscribedEvents.delete(String(params.event));
        return undefined;
      case 'emitEvent': {
        // Python 插件事件 → 全局事件总线（命名空间：plugin:<pluginId>:<event>）
        const event = String(params.event);
        globalEventBus.publish(`plugin:${this.config.pluginId}:${event}`, {
          pluginId: this.config.pluginId,
          event,
          data: params.data,
          timestamp: Date.now(),
        });
        logger.debug(`Python plugin ${this.config.pluginId} emit`, { event });
        return undefined;
      }
      default:
        throw new AppError(
          `Python plugin ${this.config.pluginId} 未知反向方法: ${method}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'PYTHON_PLUGIN_UNKNOWN_CHILD_METHOD'
        );
    }
  }

  /** 服务代理反向调用：白名单校验 + KernelServiceRegistry 服务方法调用 */
  private async handleInjectService(
    params: Record<string, unknown>
  ): Promise<unknown> {
    const serviceId = String(params.serviceId);
    const serviceMethod = String(params.method);
    const args = Array.isArray(params.args) ? (params.args as unknown[]) : [];
    const kwargs = (params.kwargs ?? {}) as Record<string, unknown>;

    // 注入白名单 = manifest inject/injectOptional 并集（防提权）
    const allowed = new Set([
      ...(this.config.inject ?? []),
      ...(this.config.injectOptional ?? []),
    ]);
    if (!allowed.has(serviceId)) {
      throw new AppError(
        `Python plugin ${this.config.pluginId} 未授权访问服务: ${serviceId}`,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'PYTHON_PLUGIN_SERVICE_ACCESS_DENIED'
      );
    }

    const instance = this.registry.resolveInternal(
      serviceId as KernelServiceId
    );
    if (!instance) {
      throw new AppError(
        `Kernel service not registered: ${serviceId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'KERNEL_SERVICE_NOT_FOUND'
      );
    }
    const fn = (instance as Record<string, unknown>)[serviceMethod];
    if (typeof fn !== 'function') {
      throw new AppError(
        `Service ${serviceId} 无方法 ${serviceMethod}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'SERVICE_METHOD_NOT_FOUND'
      );
    }
    return (fn as (...a: unknown[]) => unknown).apply(instance, [
      ...args,
      ...Object.values(kwargs),
    ]);
  }

  private handleNotify(frame: Record<string, unknown>): void {
    logger.debug(`Python plugin ${this.config.pluginId} notify`, {
      event: frame.event,
    });
  }

  // ==================== config 持久化 ====================

  private loadConfigFromDisk(): void {
    try {
      const { existsSync, readFileSync } = require('fs') as typeof import('fs');
      if (existsSync(this.configPath)) {
        this.configStore = JSON.parse(readFileSync(this.configPath, 'utf-8'));
      }
    } catch (error) {
      logger.warn(`Python plugin ${this.config.pluginId} 读取配置失败`, {
        error,
      });
    }
  }

  private persistConfig(): void {
    try {
      const { writeFileSync, mkdirSync } = require('fs') as typeof import('fs');
      const { dirname } = require('path') as typeof import('path');
      mkdirSync(dirname(this.configPath), { recursive: true });
      writeFileSync(this.configPath, JSON.stringify(this.configStore, null, 2));
    } catch (error) {
      logger.warn(`Python plugin ${this.config.pluginId} 保存配置失败`, {
        error,
      });
    }
  }

  // ==================== 状态 ====================

  getState(): PythonPluginState {
    return this.state;
  }

  getTools(): PythonToolInfo[] {
    return this.tools;
  }

  getSkills(): PythonSkillInfo[] {
    return this.skills;
  }

  isReady(): boolean {
    return this.state === 'running' && this.guard.isReady();
  }
}

/** vendored liri-sdk 目录（PY-3 vendored 定位：PYTHONPATH 注入用） */
function resolveVendoredSdkDir(): string {
  const projectDir = process.env.PYAPP_PROJECT_DIR || process.cwd();
  return join(projectDir, 'app', 'src', 'ai', 'python', 'sdk');
}

/**
 * 构造 spawn env：默认把 vendored liri-sdk 目录注入 PYTHONPATH（3.6 可用方向），
 * 使「无 pip 依赖的插件能 import liri」默认成立；调用方 config.env 可覆盖/追加。
 */
function buildSpawnEnv(config: PythonPluginConfig): NodeJS.ProcessEnv {
  const env = { ...(config.env ?? {}) };
  const sdkDir = resolveVendoredSdkDir();
  const existing = env.PYTHONPATH;
  env.PYTHONPATH = existing ? `${sdkDir}${delimiter}${existing}` : sdkDir;
  return env;
}

/** PythonToolInfo → Tool（buildTool 填充默认方法；execute 桥接 callTool RPC） */
function toRegisteredTool(
  info: PythonToolInfo,
  execute: (args: Record<string, unknown>) => Promise<unknown>
) {
  const params: ToolParam[] = Object.entries(info.parameters ?? {}).map(
    ([name, schema]) => {
      const s = (schema ?? {}) as Record<string, unknown>;
      return {
        name,
        type: typeof s.type === 'string' ? s.type : 'string',
        description: typeof s.description === 'string' ? s.description : '',
        required: s.required === true,
        default: s.default,
        enum: Array.isArray(s.enum) ? (s.enum as string[]) : undefined,
      };
    }
  );

  return buildTool({
    name: info.name,
    description: info.description,
    params,
    isEnabled: () => true,
    isConcurrencySafe: () => true,
    execute: async (input: Record<string, unknown>) => {
      const result = await execute(input);
      return createToolResult(result);
    },
  });
}

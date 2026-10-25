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
 * config 口径（2026-10-25 收敛双轨）：**不另建存储** —— 与 Node 插件共用
 * `PluginConfigManager`（`~/.pyapp/plugins/config/config.json`），经 `PluginConfigPort` 收窄到
 * 本插件命名空间。旧版 `<data>/plugin-config/<id>.json` 在首次启动时**一次性并入**（见
 * `migrateLegacyConfig`），此后不再读写该文件。
 *
 * 桥：复用 JsonRpcBridge（PY-1 泛化基类），pythonPath = venv 内解释器。
 */
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import {
  JsonRpcBridge,
  BRIDGE_PROTOCOL_VERSION,
  WorkerGuard,
} from '@modules/ai';
import { getToolRegistry } from '../../tools/ToolRegistry';
import { buildTool } from '../../tools/types/Tool';
import type { ToolParam } from '../../tools/types/Tool';
import { createToolResult } from '../../tools/types/ToolResult';
import {
  KernelServiceRegistry,
  KernelServiceId,
} from '../api/KernelServiceRegistry';
import {
  resolvePluginConfigPort,
  type PluginConfigPort,
} from '../host/pluginConfigPort';
import { migrateLegacyPythonConfig } from './pythonPluginConfigMigration';
import { resolveDataSubDir, resolveProjectRoot } from '@openliri/kernel/paths';
import { join, delimiter } from 'path';
import { trackProcess } from '../../services/mcp/transports/ChildProcessTracker';
import { globalEventBus } from '@openliri/kernel/events/EventBus';

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
  /** 宿主侧配置端口（懒解析；唯一事实源 = `PluginConfigManager`，见 `pluginConfigPort.ts`） */
  private configPortPromise?: Promise<PluginConfigPort | null>;
  /** 插件订阅的事件列表 */
  private subscribedEvents: Set<string> = new Set();

  constructor(config: PythonPluginConfig, registry: KernelServiceRegistry) {
    this.config = config;
    this.registry = registry;
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
      await this.migrateLegacyConfig();
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
        return this.readConfigValue(String(params.key));
      case 'setConfig':
        await this.writeConfigValue(String(params.key), params.value);
        return undefined;
      case 'saveConfig':
        // 写入即落盘（`PluginConfigManager.setConfigValue` → `persistConfigs`），无需二次保存
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

  // ==================== config（与 Node 插件共用 PluginConfigManager） ====================

  /** 懒解析**全局唯一**配置端口（禁止第二实例：两个 manager 会互相覆盖同一份配置文件） */
  private configPort(): Promise<PluginConfigPort | null> {
    this.configPortPromise ??= resolvePluginConfigPort();
    return this.configPortPromise;
  }

  private async readConfigValue(key: string): Promise<unknown> {
    const port = await this.configPort();
    return port ? port.read(this.config.pluginId)[key] : undefined;
  }

  private async writeConfigValue(key: string, value: unknown): Promise<void> {
    const port = await this.configPort();
    if (!port) {
      throw new AppError(
        `Python plugin ${this.config.pluginId} 配置端口不可用（插件系统未就绪）`,
        ErrorCategory.CONFIGURATION,
        ErrorSeverity.HIGH,
        'PYTHON_PLUGIN_CONFIG_PORT_UNAVAILABLE'
      );
    }
    const result = port.write(this.config.pluginId, key, value);
    if (!result.ok) {
      throw new AppError(
        `Python plugin ${this.config.pluginId} 配置写入被拒：${
          result.errors.join('；') || '未知原因'
        }`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'PYTHON_PLUGIN_CONFIG_WRITE_REJECTED'
      );
    }
  }

  /**
   * 一次性迁移旧版双轨存储 `<data>/plugin-config/<id>.json` → 共用存储。
   * 迁移口径（只补缺失键 / 被拒即保留旧文件 / 成功改名 `.migrated`）见 `pythonPluginConfigMigration.ts`。
   */
  private async migrateLegacyConfig(): Promise<void> {
    const legacyPath = join(
      resolveDataSubDir('plugin-config'),
      `${this.config.pluginId}.json`
    );
    const port = await this.configPort();
    if (!port) return;

    const result = migrateLegacyPythonConfig({
      pluginId: this.config.pluginId,
      port,
      legacyPath,
    });
    if (result.status === 'invalid') {
      logger.warn(
        `Python plugin ${this.config.pluginId} 旧配置不可解析，保留旧文件跳过迁移`,
        { legacyPath, reason: result.invalidReason }
      );
      return;
    }
    if (result.status === 'blocked') {
      logger.warn(
        `Python plugin ${this.config.pluginId} 旧配置项迁移被拒，保留旧文件待下次重试`,
        { legacyPath, key: result.blockedKey, errors: result.errors }
      );
      return;
    }
    if (result.status === 'migrated') {
      logger.info(
        `Python plugin ${this.config.pluginId} 旧配置已并入共用存储（旧文件改名留档）`,
        {
          legacyPath: `${legacyPath}.migrated`,
          importedKeys: result.importedKeys,
        }
      );
      return;
    }
    if (result.status === 'rename-failed') {
      logger.warn(
        `Python plugin ${this.config.pluginId} 旧配置已并入但改名留档失败`,
        { legacyPath, errors: result.errors }
      );
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
  const projectDir = resolveProjectRoot();
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
  // PY-3 编码修复（2026-08-30）：Windows 下 Python stdout 默认 GBK(cp936)，Bun 按
  // UTF-8 解码子进程输出 → 中文工具描述/参数乱码（"锟斤拷"）。强制 UTF-8 输出。
  // 调用方显式设置过则保留其值。
  if (env.PYTHONIOENCODING === undefined) {
    env.PYTHONIOENCODING = 'utf-8';
  }
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

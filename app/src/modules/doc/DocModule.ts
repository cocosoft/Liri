/**
 * doc 模块主类
 * 负责模块生命周期管理、Feature Flag 路由、MCP 集成协调
 */

import { getLogger } from '@modules/monitoring';
import { feature, resolveOutputDir } from '@modules/core';
import { join } from 'path';
import { readdirSync, statSync } from 'fs';

import type {
  OfficeCLIInfo,
  DocModuleStatus,
  DocCapabilityReport,
} from './types';

import { DocModuleStatus as Status } from './types';

import {
  detectOfficeCLI,
  buildOfficeCLIMcpConfig,
  getVersionConstraint,
} from './detection/OfficeCLIDetector';
import { parseOfficeCLIError } from './detection/OfficeCLIErrorParser';
import {
  registerOfficeCLIInstallPrompt,
  registerVersionMismatchPrompt,
} from './detection/elicitationPrompts';
import { MCPRequestQueue } from './concurrency/MCPRequestQueue';
import { ExecutionGuardian } from './execution/ExecutionGuardian';
import { ResourceGuardian } from './execution/ResourceGuardian';
import { docMetrics } from './observability/OfficeMetrics';
import { OfficeAuditLogger } from './audit/OfficeAuditLogger';
import { DocChannelHandler } from './channel/DocChannelHandler';
import { DocOrchestrator } from './orchestration/DocOrchestrator';
import { TemplateEngine } from './template/TemplateEngine';
import { TemplateMarketplace } from './template/TemplateMarketplace';

const logger = getLogger('doc:lifecycle');

/** doc 模块单例 */
let docModuleInstance: DocModule | null = null;

export class DocModule {
  private status: DocModuleStatus = Status.UNINITIALIZED;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  /** 检测到的 OfficeCLI 版本号（initFullMode 时记录） */
  private officeCLIVersion?: string;

  /** 核心组件 */
  readonly executionGuardian = new ExecutionGuardian();
  readonly resourceGuardian = new ResourceGuardian();
  readonly requestQueue = new MCPRequestQueue();
  readonly channelHandler = new DocChannelHandler();

  /** 模板引擎 */
  readonly templateEngine = new TemplateEngine();
  readonly templateMarketplace = new TemplateMarketplace(this.templateEngine);

  /**
   * 获取模块单例
   */
  static getInstance(): DocModule {
    if (!docModuleInstance) {
      docModuleInstance = new DocModule();
    }
    return docModuleInstance;
  }

  /**
   * 模块加载阶段：依赖注入完成，服务已注册但未初始化
   */
  async onLoad(): Promise<void> {
    logger.info('DocModule 加载中...');
  }

  /**
   * 就绪阶段：所有依赖模块已就绪，执行业务初始化
   */
  async onReady(): Promise<void> {
    if (!feature('DOC_MODULE')) {
      logger.info('DOC_MODULE feature flag 已关闭，跳过 doc 模块');
      return;
    }

    const startMs = Date.now();

    // 检测 OfficeCLI（含 CJK 检查和版本约束校验）
    const info = detectOfficeCLI();
    docMetrics.cliDetectDuration.record(Date.now() - startMs);

    if (info.installed) {
      // 版本兼容检查
      const constraint = getVersionConstraint();
      const versionOk = this.checkVersionCompatibility(info, constraint);
      if (!versionOk) {
        logger.warn('OfficeCLI 版本不兼容，进入降级模式', {
          version: info.version,
          lastTested: constraint.lastTested,
        });
        await this.initDegradedMode();
        return;
      }

      await this.initFullMode(info);
    } else {
      // 回退检查：detectOfficeCLI 未找到，但可能已通过 MCP 配置连接了 officecli
      const existingMcp = await this.findExistingOfficeCLIMcp();
      if (existingMcp) {
        logger.info(
          'detectOfficeCLI 未找到但 MCP 中已有 officecli 服务器，进入完整模式'
        );
        this.status = Status.FULL;
        this.officeCLIVersion = existingMcp.version;
        await this.syncMCPServerTools();
      } else {
        // 最终回退：主动尝试通过 MCP 客户端直接连接 officecli
        // MCP 配置可能未自动重连（重启后），此处主动触发连接
        const connected = await this.tryDirectMcpConnect();
        if (connected) {
          this.status = Status.FULL;
          await this.syncMCPServerTools();
        } else {
          await this.initDegradedMode();
        }
      }
    }

    // 注册渠道感知工具
    this.channelHandler.registerTools();

    // 注册模板引擎（需 DOC_TEMPLATE flag）
    if (feature('DOC_TEMPLATE')) {
      this.templateMarketplace.registerBuiltinTemplates();
      logger.info('模板引擎已就绪', {
        templateCount: this.templateEngine.templateCount,
      });
    }

    // 启动健康检查
    this.startHealthCheck();
  }

  /**
   * 销毁阶段：释放资源，逆序调用
   */
  async onDestroy(): Promise<void> {
    logger.info('DocModule 销毁中...');
    this.stopHealthCheck();
    this.requestQueue.flush();
    this.status = Status.SHUTDOWN;
  }

  /**
   * 获取当前模块状态
   */
  getStatus(): DocModuleStatus {
    return this.status;
  }

  /**
   * 获取能力报告（前端 /v1/doc/status 的数据来源）
   */
  getCapabilities(): DocCapabilityReport {
    const templateMetas = this.templateEngine.getTemplates();
    const templateNames = templateMetas.map((t) => t.name);

    return {
      status: this.status,
      officeCliInfo: {
        installed: this.status === Status.FULL,
        version: this.officeCLIVersion,
      },
      connectedCount: this.status === Status.FULL ? 1 : 0,
      toolCount: this.templateEngine.templateCount,
      templateCount: this.templateEngine.templateCount,
      templates: templateNames,
      documents: this.scanOutputDirectory(),
    };
  }

  /**
   * 动态刷新 MCP 连接状态
   * 当缓存为 DEGRADED 时检查 MCPServerManager（唯一事实来源）中是否已有 officecli。
   * MCPConnectionManager（适配层）在连接成功时已同步到 MCPServerManager，无需重复检查。
   * 解决用户通过 UI 连接 MCP officecli 后模块仍显示"未安装"的问题。
   */
  async refreshMCPStatus(): Promise<void> {
    if (this.status === Status.FULL) return;

    try {
      const { getMCPServerManager } =
        await import('@modules/services/mcp/MCPServerManager');
      const manager = getMCPServerManager();

      if (manager.getServer('officecli')) {
        logger.info('MCPServerManager 中检测到 officecli，状态修正为 FULL');
        this.status = Status.FULL;
        await this.syncMCPServerTools();
      }
    } catch (error) {
      logger.debug('MCP 状态刷新失败', { error: String(error) });
    }
  }

  /**
   * 主动尝试通过 MCP 客户端直接连接 officecli
   * 用于 MCP 配置未自动重连的场景（如重启后），在进入 DEGRADED 前做最终尝试。
   */
  private async tryDirectMcpConnect(): Promise<boolean> {
    try {
      const { getMcpToolsCommandsAndResources } =
        await import('@modules/services/mcp/client');
      const { getMCPServerManager } =
        await import('@modules/services/mcp/MCPServerManager');

      let connected = false;

      await getMcpToolsCommandsAndResources(
        (result) => {
          if (result.connection.type === 'connected') {
            const manager = getMCPServerManager();
            manager.addServer('officecli', result.connection.config);
            connected = true;
            logger.info('主动连接 officecli 成功，已注册到 MCPServerManager');
          }
        },
        {
          officecli: buildOfficeCLIMcpConfig({
            installed: true,
            path: 'officecli',
          }) as any,
        }
      );

      return connected;
    } catch (error) {
      logger.warn('主动连接 officecli 失败', { error: String(error) });
      return false;
    }
  }

  /**
   * 同步 MCP officecli 工具到 ToolManager
   * DocModule 通过 MCPServerManager 连接 officecli，但 MCPToolBridge 从
   * MCPConnectionManager.toolsCache 获取工具列表。此处通过 MCP 客户端管线
   * 重新获取工具，注入 toolsCache，再触发 MCPToolBridge 同步到 ToolManager。
   */
  private async syncMCPServerTools(): Promise<void> {
    try {
      const mcpConfig = buildOfficeCLIMcpConfig({
        installed: true,
        path: 'officecli',
      });

      const { getMcpToolsCommandsAndResources } =
        await import('@modules/services/mcp/client');
      const { mcpConnectionManager } =
        await import('@modules/services/mcp/MCPConnectionManager');

      // 通过 MCP 客户端连接 officecli 并获取工具列表
      await getMcpToolsCommandsAndResources(
        (result) => {
          if (result.tools?.length > 0) {
            mcpConnectionManager.addServerTools('officecli', result.tools);
            logger.info(
              `officecli 工具已注入 toolsCache: ${result.tools.length} 个`
            );
          }
        },
        { officecli: mcpConfig as any }
      );

      // 触发 MCPToolBridge 从 toolsCache 同步到 ToolManager
      const { mcpSystem } = await import('@modules/services/mcp');
      const count = await mcpSystem.refreshAllTools();
      logger.info(`MCP 工具已刷新：${count} 个工具可用`);
    } catch (error) {
      logger.warn('MCP 工具刷新失败', { error: String(error) });
    }
  }

  /**
   * 扫描输出目录中的文档文件列表
   */
  private scanOutputDirectory(): {
    name: string;
    size: number;
    mtime: number;
  }[] {
    try {
      const outputDir = resolveOutputDir();
      const entries = readdirSync(outputDir);
      return entries
        .filter((e: string) => /\.(docx|xlsx|pptx|pdf|html)$/i.test(e))
        .map((e: string) => {
          const s = statSync(join(outputDir, e));
          return { name: e, size: s.size, mtime: s.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 20);
    } catch {
      return [];
    }
  }

  /**
   * 检查版本兼容性
   */
  private checkVersionCompatibility(
    info: OfficeCLIInfo,
    constraint: ReturnType<typeof getVersionConstraint>
  ): boolean {
    if (!info.version) return true;
    if (constraint.knownIncompatible.includes(info.version)) return false;
    return true;
  }

  /**
   * 检查 MCP Server Manager 中是否已有 officecli 服务器注册
   * 用于 detectOfficeCLI() 失败时的回退检查
   */
  private async findExistingOfficeCLIMcp(): Promise<{
    version?: string;
  } | null> {
    try {
      const { getMCPServerManager } =
        await import('@modules/services/mcp/MCPServerManager');
      const manager = getMCPServerManager();
      const server = manager.getServer('officecli');

      if (server) {
        logger.info('MCP 中检测到已有 officecli 服务器连接');
        return { version: undefined };
      }
    } catch (error) {
      logger.debug('检查 MCP officecli 服务器失败', { error: String(error) });
    }
    return null;
  }

  /**
   * 完整模式初始化：OfficeCLI 已安装
   */
  private async initFullMode(info: OfficeCLIInfo): Promise<void> {
    this.status = Status.FULL;
    this.officeCLIVersion = info.version;
    logger.info('OfficeCLI 已安装，进入完整模式', { version: info.version });

    // 生成 MCP 配置并注册服务器
    const mcpConfig = buildOfficeCLIMcpConfig(info);

    try {
      // 动态导入 MCP 服务（避免循环依赖）
      const { getMCPServerManager } =
        await import('@modules/services/mcp/MCPServerManager');
      const manager = getMCPServerManager();

      // 注册 OfficeCLI 为 MCP Server
      manager.addServer('officecli', mcpConfig as any);
      logger.info('OfficeCLI MCP Server 已注册');

      // MCPToolBridge 在启动时已执行 syncTools，此时需手动触发刷新
      await this.syncMCPServerTools();
    } catch (error) {
      logger.warn('MCP Server 注册失败，尝试降级', { error: String(error) });
      await this.initDegradedMode();
      return;
    }

    await OfficeAuditLogger.record({
      user: 'system',
      operation: 'doc_init_full',
      target: `officecli v${info.version}`,
      result: 'success',
    });

    logger.info('DocModule 完整模式初始化完成');
  }

  /**
   * 降级模式初始化：OfficeCLI 未安装，仅文件读取可用
   */
  private async initDegradedMode(): Promise<void> {
    this.status = Status.DEGRADED;
    logger.info('OfficeCLI 未安装，进入降级模式（仅可读）');

    // 注册安装引导（ElicitationHandler）
    registerOfficeCLIInstallPrompt();

    await OfficeAuditLogger.record({
      user: 'system',
      operation: 'doc_init_degraded',
      target: 'officecli',
      result: 'success',
    });
  }

  /**
   * 启动健康检查定时器（30s 间隔）
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(() => {
      logger.debug('Doc 模块健康检查 tick', { status: this.status });
      // TODO: 检查 OfficeCLI MCP 连接状态
    }, 30000);
  }

  /**
   * 停止健康检查定时器
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * 处理 OfficeCLI 崩溃后的降级
   */
  async handleOfficeCLICrash(): Promise<void> {
    docMetrics.cliCrashTotal.inc();

    for (let i = 0; i < 3; i++) {
      logger.warn('OfficeCLI 重连尝试', { attempt: i + 1 });
      // TODO: 尝试重连
    }

    // 重连失败 → DEGRADED 状态
    this.status = Status.DEGRADED;
    logger.warn('OfficeCLI 重连失败，文档进入降级模式（仅可读）');

    await OfficeAuditLogger.record({
      user: 'system',
      operation: 'doc_degraded',
      target: 'officecli',
      result: 'success',
    });
  }
}

/**
 * doc 模块主类
 * 负责模块生命周期管理、Feature Flag 路由、MCP 集成协调
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { feature } from '@modules/core';
import { isBuildVariant } from '@modules/core/featureFlags';

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

const logger = new Logger({
  module: 'doc:lifecycle',
  level: LogLevel.INFO,
});

/** doc 模块单例 */
let docModuleInstance: DocModule | null = null;

export class DocModule {
  private status: DocModuleStatus = Status.UNINITIALIZED;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

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
    // 构建变体守卫：非 enterprise 版本直接跳过
    if (!isBuildVariant('enterprise')) {
      logger.info('非 enterprise 构建变体，跳过 doc 模块');
      return;
    }

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
      await this.initDegradedMode();
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
   * 获取能力报告
   */
  getCapabilities(): DocCapabilityReport {
    return {
      status: this.status,
      officeCliInfo: {
        installed: this.status === Status.FULL,
        version: undefined,
      },
      connectedCount: this.status === Status.FULL ? 1 : 0,
      toolCount: this.templateEngine.templateCount,
      templateCount: this.templateEngine.templateCount,
    };
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
   * 完整模式初始化：OfficeCLI 已安装
   */
  private async initFullMode(info: OfficeCLIInfo): Promise<void> {
    this.status = Status.FULL;
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

      // MCPToolBridge 将自动同步工具到 ToolManager
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

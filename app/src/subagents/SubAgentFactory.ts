/**
 * 子代理工厂
 * 负责创建不同类型的子代理
 */

import {
  SubAgentFactory,
  SubAgent,
  SubAgentConfig,
  SubAgentType,
  SubAgentStatus,
  SubAgentManager,
} from './types/SubAgentTypes';
import { BaseSubAgent, GenericSubAgent } from './BaseSubAgent';
import { createSubAgentConfig } from './types/SubAgentTypes';

/**
 * 子代理工厂实现
 */
export class SubAgentFactoryImpl implements SubAgentFactory {
  /**
   * 创建子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createSubAgent(config: SubAgentConfig): SubAgent {
    switch (config.type) {
      case SubAgentType.GENERIC:
        return this.createGenericSubAgent(config);
      case SubAgentType.CODE_EXECUTION:
        return this.createCodeExecutionSubAgent(config);
      case SubAgentType.WEB_SEARCH:
        return this.createWebSearchSubAgent(config);
      case SubAgentType.DATA_ANALYSIS:
        return this.createDataAnalysisSubAgent(config);
      case SubAgentType.SYSTEM_MANAGEMENT:
        return this.createSystemManagementSubAgent(config);
      case SubAgentType.SECURITY_ANALYSIS:
        return this.createSecurityAnalysisSubAgent(config);
      case SubAgentType.NLP:
        return this.createNLPSubAgent(config);
      case SubAgentType.MULTIMODAL:
        return this.createMultimodalSubAgent(config);
      default:
        return this.createGenericSubAgent(config);
    }
  }

  /**
   * 创建通用子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createGenericSubAgent(config: Partial<SubAgentConfig>): SubAgent {
    const fullConfig = createSubAgentConfig({
      ...config,
      type: SubAgentType.GENERIC,
      description: config.description || 'Generic sub agent',
    });
    return new GenericSubAgent(fullConfig);
  }

  /**
   * 创建代码执行子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createCodeExecutionSubAgent(config: Partial<SubAgentConfig>): SubAgent {
    const fullConfig = createSubAgentConfig({
      ...config,
      type: SubAgentType.CODE_EXECUTION,
      description: config.description || 'Code execution sub agent',
      toolConfig: {
        enabledTools: [
          'bash',
          'powershell',
          'file_read',
          'file_write',
          'file_edit',
        ],
        ...config.toolConfig,
      },
      securityConfig: {
        sandboxEnabled: true,
        networkAccess: false,
        filesystemAccess: true,
        environmentAccess: false,
        ...config.securityConfig,
      },
    });
    return new GenericSubAgent(fullConfig);
  }

  /**
   * 创建网络搜索子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createWebSearchSubAgent(config: Partial<SubAgentConfig>): SubAgent {
    const fullConfig = createSubAgentConfig({
      ...config,
      type: SubAgentType.WEB_SEARCH,
      description: config.description || 'Web search sub agent',
      toolConfig: {
        enabledTools: ['web_search', 'web_fetch'],
        ...config.toolConfig,
      },
      securityConfig: {
        sandboxEnabled: true,
        networkAccess: true,
        filesystemAccess: false,
        environmentAccess: false,
        ...config.securityConfig,
      },
    });
    return new GenericSubAgent(fullConfig);
  }

  /**
   * 创建数据分析子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createDataAnalysisSubAgent(config: Partial<SubAgentConfig>): SubAgent {
    const fullConfig = createSubAgentConfig({
      ...config,
      type: SubAgentType.DATA_ANALYSIS,
      description: config.description || 'Data analysis sub agent',
      toolConfig: {
        enabledTools: ['file_read', 'file_write', 'bash'],
        ...config.toolConfig,
      },
      securityConfig: {
        sandboxEnabled: true,
        networkAccess: false,
        filesystemAccess: true,
        environmentAccess: false,
        ...config.securityConfig,
      },
    });
    return new GenericSubAgent(fullConfig);
  }

  /**
   * 创建系统管理子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createSystemManagementSubAgent(config: Partial<SubAgentConfig>): SubAgent {
    const fullConfig = createSubAgentConfig({
      ...config,
      type: SubAgentType.SYSTEM_MANAGEMENT,
      description: config.description || 'System management sub agent',
      toolConfig: {
        enabledTools: ['bash', 'powershell', 'file_read', 'file_write'],
        ...config.toolConfig,
      },
      securityConfig: {
        sandboxEnabled: false,
        networkAccess: true,
        filesystemAccess: true,
        environmentAccess: true,
        ...config.securityConfig,
      },
    });
    return new GenericSubAgent(fullConfig);
  }

  /**
   * 创建安全分析子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createSecurityAnalysisSubAgent(config: Partial<SubAgentConfig>): SubAgent {
    const fullConfig = createSubAgentConfig({
      ...config,
      type: SubAgentType.SECURITY_ANALYSIS,
      description: config.description || 'Security analysis sub agent',
      toolConfig: {
        enabledTools: ['bash', 'powershell', 'file_read', 'grep'],
        ...config.toolConfig,
      },
      securityConfig: {
        sandboxEnabled: true,
        networkAccess: true,
        filesystemAccess: true,
        environmentAccess: false,
        ...config.securityConfig,
      },
    });
    return new GenericSubAgent(fullConfig);
  }

  /**
   * 创建自然语言处理子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createNLPSubAgent(config: Partial<SubAgentConfig>): SubAgent {
    const fullConfig = createSubAgentConfig({
      ...config,
      type: SubAgentType.NLP,
      description:
        config.description || 'Natural language processing sub agent',
      toolConfig: {
        enabledTools: ['web_fetch'],
        ...config.toolConfig,
      },
      securityConfig: {
        sandboxEnabled: true,
        networkAccess: true,
        filesystemAccess: false,
        environmentAccess: false,
        ...config.securityConfig,
      },
    });
    return new GenericSubAgent(fullConfig);
  }

  /**
   * 创建多模态处理子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createMultimodalSubAgent(config: Partial<SubAgentConfig>): SubAgent {
    const fullConfig = createSubAgentConfig({
      ...config,
      type: SubAgentType.MULTIMODAL,
      description: config.description || 'Multimodal processing sub agent',
      toolConfig: {
        enabledTools: ['web_fetch', 'web_search'],
        ...config.toolConfig,
      },
      securityConfig: {
        sandboxEnabled: true,
        networkAccess: true,
        filesystemAccess: false,
        environmentAccess: false,
        ...config.securityConfig,
      },
    });
    return new GenericSubAgent(fullConfig);
  }
}

/**
 * 子代理管理器
 * 负责管理所有子代理的生命周期
 */
export class SubAgentManagerImpl implements SubAgentManager {
  /** 子代理工厂 */
  private factory: SubAgentFactory;
  /** 子代理存储 */
  private subAgents: Map<string, SubAgent> = new Map();
  /** 执行统计 */
  private stats: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
  } = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
  };

  /**
   * 构造函数
   * @param factory 子代理工厂实例
   */
  constructor(factory?: SubAgentFactory) {
    this.factory = factory || new SubAgentFactoryImpl();
  }

  /**
   * 创建子代理
   * @param config 子代理配置
   * @returns 子代理ID
   */
  createSubAgent(config: SubAgentConfig): string {
    const subAgent = this.factory.createSubAgent(config);
    this.subAgents.set(subAgent.getInfo().id, subAgent);
    return subAgent.getInfo().id;
  }

  /**
   * 获取子代理
   * @param subAgentId 子代理ID
   * @returns 子代理实例
   */
  getSubAgent(subAgentId: string): SubAgent | undefined {
    return this.subAgents.get(subAgentId);
  }

  /**
   * 获取所有子代理
   * @returns 子代理实例列表
   */
  getSubAgents(): SubAgent[] {
    return Array.from(this.subAgents.values());
  }

  /**
   * 获取子代理信息
   * @param subAgentId 子代理ID
   * @returns 子代理信息
   */
  getSubAgentInfo(subAgentId: string): SubAgentInfo | undefined {
    const subAgent = this.subAgents.get(subAgentId);
    return subAgent?.getInfo();
  }

  /**
   * 获取所有子代理信息
   * @returns 子代理信息列表
   */
  getSubAgentInfos(): SubAgentInfo[] {
    return Array.from(this.subAgents.values()).map((subAgent) =>
      subAgent.getInfo()
    );
  }

  /**
   * 启动子代理
   * @param subAgentId 子代理ID
   * @returns 启动结果
   */
  async startSubAgent(subAgentId: string): Promise<boolean> {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return false;
    }
    return await subAgent.start();
  }

  /**
   * 停止子代理
   * @param subAgentId 子代理ID
   * @returns 停止结果
   */
  async stopSubAgent(subAgentId: string): Promise<boolean> {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return false;
    }
    return await subAgent.stop();
  }

  /**
   * 暂停子代理
   * @param subAgentId 子代理ID
   * @returns 暂停结果
   */
  async pauseSubAgent(subAgentId: string): Promise<boolean> {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return false;
    }
    return await subAgent.pause();
  }

  /**
   * 恢复子代理
   * @param subAgentId 子代理ID
   * @returns 恢复结果
   */
  async resumeSubAgent(subAgentId: string): Promise<boolean> {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return false;
    }
    return await subAgent.resume();
  }

  /**
   * 执行子代理任务
   * @param request 执行请求
   * @returns 执行响应
   */
  async executeSubAgent(
    request: SubAgentExecutionRequest
  ): Promise<SubAgentExecutionResponse> {
    const subAgent = this.subAgents.get(request.subAgentId);
    if (!subAgent) {
      return {
        id: `response_${Date.now()}`,
        requestId: request.id,
        subAgentId: request.subAgentId,
        result: null,
        status: 'failure',
        error: `Sub-agent ${request.subAgentId} not found`,
        executionTime: 0,
      };
    }

    const response = await subAgent.execute(request);

    // 更新统计信息
    this.stats.totalExecutions++;
    if (response.status === 'success') {
      this.stats.successfulExecutions++;
    } else {
      this.stats.failedExecutions++;
    }

    return response;
  }

  /**
   * 发送消息给子代理
   * @param message 消息
   * @returns 发送结果
   */
  async sendMessage(message: SubAgentMessage): Promise<boolean> {
    const subAgent = this.subAgents.get(message.recipientId);
    if (!subAgent) {
      return false;
    }
    return await subAgent.sendMessage(message);
  }

  /**
   * 删除子代理
   * @param subAgentId 子代理ID
   * @returns 删除结果
   */
  async deleteSubAgent(subAgentId: string): Promise<boolean> {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return false;
    }

    await subAgent.stop();
    this.subAgents.delete(subAgentId);
    return true;
  }

  /**
   * 清除所有子代理
   * @returns 清除结果
   */
  async clearSubAgents(): Promise<boolean> {
    for (const subAgent of this.subAgents.values()) {
      await subAgent.stop();
    }
    this.subAgents.clear();
    return true;
  }

  /**
   * 获取子代理统计信息
   * @returns 统计信息
   */
  getStats(): {
    totalSubAgents: number;
    runningSubAgents: number;
    pausedSubAgents: number;
    errorSubAgents: number;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
  } {
    const subAgents = this.getSubAgents();
    return {
      totalSubAgents: subAgents.length,
      runningSubAgents: subAgents.filter(
        (sa) => sa.getStatus() === SubAgentStatus.RUNNING
      ).length,
      pausedSubAgents: subAgents.filter(
        (sa) => sa.getStatus() === SubAgentStatus.PAUSED
      ).length,
      errorSubAgents: subAgents.filter(
        (sa) => sa.getStatus() === SubAgentStatus.ERROR
      ).length,
      totalExecutions: this.stats.totalExecutions,
      successfulExecutions: this.stats.successfulExecutions,
      failedExecutions: this.stats.failedExecutions,
    };
  }
}

/**
 * 创建子代理工厂实例
 * @returns 子代理工厂实例
 */
export function createSubAgentFactory(): SubAgentFactory {
  return new SubAgentFactoryImpl();
}

/**
 * 创建子代理管理器实例
 * @param factory 子代理工厂实例
 * @returns 子代理管理器实例
 */
export function createSubAgentManager(
  factory?: SubAgentFactory
): SubAgentManager {
  return new SubAgentManagerImpl(factory);
}

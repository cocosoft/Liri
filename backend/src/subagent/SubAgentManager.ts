/**
 * 子agent管理核心
 */
import {
  SubAgent,
  SubAgentConfig,
  SubAgentStatus,
  SubAgentType,
} from './types/SubAgent';
import { SubAgentFactory } from './SubAgentFactory';

/**
 * 子agent管理器
 */
export class SubAgentManager {
  private subAgents: Map<string, SubAgent> = new Map();
  private subAgentFactories: Map<string, SubAgentFactory> = new Map();
  private factory: SubAgentFactory;

  /**
   * 构造函数
   * @param factory 子agent工厂
   */
  constructor(factory: SubAgentFactory) {
    this.factory = factory;
  }

  /**
   * 创建子agent
   * @param config 子agent配置
   * @returns 子agent实例
   */
  async createSubAgent(config: SubAgentConfig): Promise<SubAgent> {
    // 检查子agent ID是否已存在
    if (this.subAgents.has(config.id)) {
      throw new Error(`SubAgent with id ${config.id} already exists`);
    }

    // 创建子agent
    let subAgent: SubAgent;
    switch (config.type) {
      case SubAgentType.IN_PROCESS:
        subAgent = this.factory.createInProcessSubAgent(config as any);
        break;
      case SubAgentType.PROCESS:
        subAgent = this.factory.createProcessSubAgent(config as any);
        break;
      case SubAgentType.TMUX:
        subAgent = this.factory.createTmuxSubAgent(config as any);
        break;
      case SubAgentType.ITERM:
        subAgent = this.factory.createITermSubAgent(config as any);
        break;
      case SubAgentType.CUSTOM:
        subAgent = this.factory.createCustomSubAgent(
          config.type,
          config as any
        );
        break;
      default:
        throw new Error(`Unknown subagent type: ${config.type}`);
    }

    // 保存子agent
    this.subAgents.set(config.id, subAgent);

    // 启动子agent
    await subAgent.start();

    return subAgent;
  }

  /**
   * 获取子agent
   * @param id 子agent ID
   * @returns 子agent实例
   */
  getSubAgent(id: string): SubAgent | undefined {
    return this.subAgents.get(id);
  }

  /**
   * 获取所有子agent
   * @returns 子agent实例数组
   */
  getSubAgents(): SubAgent[] {
    return Array.from(this.subAgents.values());
  }

  /**
   * 启动子agent
   * @param id 子agent ID
   */
  async startSubAgent(id: string): Promise<void> {
    const subAgent = this.subAgents.get(id);
    if (!subAgent) {
      throw new Error(`SubAgent with id ${id} not found`);
    }

    await subAgent.start();
  }

  /**
   * 停止子agent
   * @param id 子agent ID
   */
  async stopSubAgent(id: string): Promise<void> {
    const subAgent = this.subAgents.get(id);
    if (!subAgent) {
      throw new Error(`SubAgent with id ${id} not found`);
    }

    await subAgent.stop();
    this.subAgents.delete(id);
  }

  /**
   * 暂停子agent
   * @param id 子agent ID
   */
  async pauseSubAgent(id: string): Promise<void> {
    const subAgent = this.subAgents.get(id);
    if (!subAgent) {
      throw new Error(`SubAgent with id ${id} not found`);
    }

    await subAgent.pause();
  }

  /**
   * 恢复子agent
   * @param id 子agent ID
   */
  async resumeSubAgent(id: string): Promise<void> {
    const subAgent = this.subAgents.get(id);
    if (!subAgent) {
      throw new Error(`SubAgent with id ${id} not found`);
    }

    await subAgent.resume();
  }

  /**
   * 向子agent发送任务
   * @param id 子agent ID
   * @param task 任务
   */
  async sendTask(id: string, task: any): Promise<void> {
    const subAgent = this.subAgents.get(id);
    if (!subAgent) {
      throw new Error(`SubAgent with id ${id} not found`);
    }

    await subAgent.sendMessage(task);
  }

  /**
   * 获取子agent状态
   * @param id 子agent ID
   * @returns 子agent状态
   */
  getSubAgentStatus(id: string): SubAgentStatus {
    const subAgent = this.subAgents.get(id);
    if (!subAgent) {
      throw new Error(`SubAgent with id ${id} not found`);
    }

    return subAgent.getStatus();
  }

  /**
   * 注册子agent类型
   * @param type 子agent类型
   * @param factory 子agent工厂
   */
  registerSubAgentType(type: string, factory: SubAgentFactory): void {
    this.subAgentFactories.set(type, factory);
  }

  /**
   * 注销子agent类型
   * @param type 子agent类型
   */
  unregisterSubAgentType(type: string): void {
    this.subAgentFactories.delete(type);
  }

  /**
   * 获取子agent工厂
   * @param type 子agent类型
   * @returns 子agent工厂
   */
  getSubAgentFactory(type: string): SubAgentFactory | undefined {
    return this.subAgentFactories.get(type);
  }

  /**
   * 清理所有子agent
   */
  async cleanup(): Promise<void> {
    const subAgentIds = Array.from(this.subAgents.keys());
    for (const id of subAgentIds) {
      await this.stopSubAgent(id);
    }
  }

  /**
   * 获取子agent数量
   * @returns 子agent数量
   */
  size(): number {
    return this.subAgents.size;
  }

  /**
   * 检查子agent是否存在
   * @param id 子agent ID
   * @returns 是否存在
   */
  hasSubAgent(id: string): boolean {
    return this.subAgents.has(id);
  }
}

/**
 * 创建子agent管理器
 * @param factory 子agent工厂
 * @returns 子agent管理器实例
 */
export function createSubAgentManager(
  factory: SubAgentFactory
): SubAgentManager {
  return new SubAgentManager(factory);
}

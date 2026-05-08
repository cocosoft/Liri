//
/**
 * 代理服务
 */

import { AgentService, AgentConfig, AIAgent } from '../models/types';
import { AIAgentImpl } from '../agent';
import { ToolFactory } from '../tools/agentTool';
import { join } from 'path';
import {
  readdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from 'fs';
import { AIModelType } from '@modules/ai/models/types';

/**
 * 代理服务类
 */
export class AgentServiceImpl implements AgentService {
  private config: AgentConfig;
  private agents: Map<string, AIAgent> = new Map();

  /**
   * 构造函数
   * @param config 服务配置
   */
  constructor(config: AgentConfig) {
    this.config = config;

    // 确保存储目录存在
    if (!existsSync(this.config.memoryPath)) {
      mkdirSync(this.config.memoryPath, { recursive: true });
    }

    // 加载代理
    this.loadAgents();
  }

  /**
   * 创建代理
   * @param config 代理配置
   * @returns AI代理
   */
  createAgent(config: Partial<AgentConfig> = {}): AIAgent {
    const agentConfig: AgentConfig = {
      ...this.config,
      ...config,
      tools: config.tools || this.config.tools,
    };

    const agent = new AIAgentImpl(agentConfig);
    this.agents.set(agent.id, agent);
    this.saveAgent(agent);
    return agent;
  }

  /**
   * 获取代理
   * @param agentId 代理ID
   * @returns AI代理或undefined
   */
  getAgent(agentId: string): AIAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 列出所有代理
   * @returns 代理列表
   */
  listAgents(): AIAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 删除代理
   * @param agentId 代理ID
   * @returns 是否成功
   */
  deleteAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      this.deleteAgentFile(agentId);
      return true;
    }
    return false;
  }

  /**
   * 更新代理
   * @param agentId 代理ID
   * @param config 代理配置
   * @returns AI代理或undefined
   */
  updateAgent(
    agentId: string,
    config: Partial<AgentConfig>
  ): AIAgent | undefined {
    const agent = this.agents.get(agentId);
    if (agent) {
      // 类型断言，因为AIAgent接口没有updateConfig方法
      (agent as any).updateConfig(config);
      this.saveAgent(agent);
      return agent;
    }
    return undefined;
  }

  /**
   * 设置默认模型
   * @param model 模型类型
   */
  setDefaultModel(model: AIModelType): void {
    this.config.model = model;
  }

  /**
   * 获取默认模型
   * @returns 默认模型类型
   */
  getDefaultModel(): AIModelType {
    return this.config.model;
  }

  /**
   * 更新配置
   * @param config 配置部分
   */
  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...config };

    // 确保存储目录存在
    if (!existsSync(this.config.memoryPath)) {
      mkdirSync(this.config.memoryPath, { recursive: true });
    }
  }

  /**
   * 获取配置
   * @returns 服务配置
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * 保存代理
   * @param agent AI代理
   */
  private saveAgent(agent: AIAgent): void {
    const agentPath = join(this.config.memoryPath, `${agent.id}.json`);
    try {
      writeFileSync(
        agentPath,
        JSON.stringify((agent as any).serialize(), null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('Failed to save agent:', error);
    }
  }

  /**
   * 删除代理文件
   * @param agentId 代理ID
   */
  private deleteAgentFile(agentId: string): void {
    const agentPath = join(this.config.memoryPath, `${agentId}.json`);
    try {
      if (existsSync(agentPath)) {
        // 这里应该使用fs.unlinkSync，但为了安全起见，我们先检查文件是否存在
        const fs = require('fs');
        fs.unlinkSync(agentPath);
      }
    } catch (error) {
      console.error('Failed to delete agent file:', error);
    }
  }

  /**
   * 加载代理
   */
  private loadAgents(): void {
    try {
      const files = readdirSync(this.config.memoryPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const agentPath = join(this.config.memoryPath, file);
          const data = readFileSync(agentPath, 'utf-8');
          const agentData = JSON.parse(data);
          const agent = AIAgentImpl.deserialize(agentData);
          this.agents.set(agent.id, agent);
        }
      }
    } catch (error) {
      console.error('Failed to load agents:', error);
    }
  }
}

/**
 * 创建代理服务实例
 * @param config 服务配置
 * @returns 代理服务实例
 */
export function createAgentService(
  config: Partial<AgentConfig> = {}
): AgentService {
  const defaultConfig: AgentConfig = {
    model: AIModelType.GPT_3_5_TURBO,
    temperature: 0.7,
    maxTokens: 1000,
    timeout: 60000,
    memoryPath: join(process.cwd(), 'agent_memory'),
    defaultStrategy: 'direct_answer',
    tools: ToolFactory.createDefaultTools(),
  };

  return new AgentServiceImpl({ ...defaultConfig, ...config });
}

/**
 * 代理服务实例
 */
export const agentService = createAgentService();

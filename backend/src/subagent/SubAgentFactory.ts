/**
 * 子agent工厂
 */
import {
  SubAgent,
  SubAgentConfig,
  SubAgentType,
  InProcessSubAgentConfig,
  ProcessSubAgentConfig,
  TmuxSubAgentConfig,
  ITermSubAgentConfig,
  CustomSubAgentConfig,
} from './types/SubAgent';
import { InProcessSubAgent } from './types/InProcessSubAgent';
import { ProcessSubAgent } from './types/ProcessSubAgent';
import { TmuxSubAgent } from './types/TmuxSubAgent';
import { ITermSubAgent } from './types/ITermSubAgent';

/**
 * 子agent工厂
 */
export class SubAgentFactory {
  /**
   * 创建进程内子agent
   * @param config 进程内子agent配置
   * @returns 进程内子agent实例
   */
  createInProcessSubAgent(config: InProcessSubAgentConfig): SubAgent {
    return new InProcessSubAgent(config);
  }

  /**
   * 创建进程外子agent
   * @param config 进程外子agent配置
   * @returns 进程外子agent实例
   */
  createProcessSubAgent(config: ProcessSubAgentConfig): SubAgent {
    return new ProcessSubAgent(config);
  }

  /**
   * 创建Tmux子agent
   * @param config Tmux子agent配置
   * @returns Tmux子agent实例
   */
  createTmuxSubAgent(config: TmuxSubAgentConfig): SubAgent {
    return new TmuxSubAgent(config);
  }

  /**
   * 创建iTerm子agent
   * @param config iTerm子agent配置
   * @returns iTerm子agent实例
   */
  createITermSubAgent(config: ITermSubAgentConfig): SubAgent {
    return new ITermSubAgent(config);
  }

  /**
   * 创建自定义子agent
   * @param type 子agent类型
   * @param config 自定义子agent配置
   * @returns 自定义子agent实例
   */
  createCustomSubAgent(type: string, config: CustomSubAgentConfig): SubAgent {
    // 这里可以根据类型创建不同的自定义子agent
    // 目前返回一个基本的进程内子agent
    return new InProcessSubAgent({
      ...config,
      type: SubAgentType.IN_PROCESS,
    } as InProcessSubAgentConfig);
  }

  /**
   * 创建子agent
   * @param config 子agent配置
   * @returns 子agent实例
   */
  createSubAgent(config: SubAgentConfig): SubAgent {
    switch (config.type) {
      case SubAgentType.IN_PROCESS:
        return this.createInProcessSubAgent(config as InProcessSubAgentConfig);
      case SubAgentType.PROCESS:
        return this.createProcessSubAgent(config as ProcessSubAgentConfig);
      case SubAgentType.TMUX:
        return this.createTmuxSubAgent(config as TmuxSubAgentConfig);
      case SubAgentType.ITERM:
        return this.createITermSubAgent(config as ITermSubAgentConfig);
      case SubAgentType.CUSTOM:
        return this.createCustomSubAgent(
          config.type,
          config as CustomSubAgentConfig
        );
      default:
        throw new Error(`Unknown subagent type: ${config.type}`);
    }
  }
}

/**
 * 创建子agent工厂
 * @returns 子agent工厂实例
 */
export function createSubAgentFactory(): SubAgentFactory {
  return new SubAgentFactory();
}

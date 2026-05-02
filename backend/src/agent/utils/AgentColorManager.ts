/**
 * Agent颜色管理器
 * 负责管理Agent的颜色分配和回收
 * 参考CC源码 cc_code/backend/tools/AgentTool/agentColorManager.ts 实现
 */

import { logger } from '../../utils/log';

/**
 * Agent颜色名称
 */
export type AgentColorName = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink' | 'cyan';

/**
 * Agent颜色列表
 */
export const AGENT_COLORS: readonly AgentColorName[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'cyan',
] as const;

/**
 * Agent颜色到主题颜色的映射
 */
export const AGENT_COLOR_TO_THEME_COLOR: Record<AgentColorName, string> = {
  red: 'red_FOR_SUBAGENTS_ONLY',
  blue: 'blue_FOR_SUBAGENTS_ONLY',
  green: 'green_FOR_SUBAGENTS_ONLY',
  yellow: 'yellow_FOR_SUBAGENTS_ONLY',
  purple: 'purple_FOR_SUBAGENTS_ONLY',
  orange: 'orange_FOR_SUBAGENTS_ONLY',
  pink: 'pink_FOR_SUBAGENTS_ONLY',
  cyan: 'cyan_FOR_SUBAGENTS_ONLY',
};

/**
 * Tmux颜色名称映射
 */
export const AGENT_COLOR_TO_TMUX_COLOR: Record<AgentColorName, string> = {
  red: 'red',
  blue: 'blue',
  green: 'green',
  yellow: 'yellow',
  purple: 'magenta',
  orange: 'colour208',
  pink: 'colour205',
  cyan: 'cyan',
};

/**
 * Agent颜色信息
 */
export interface AgentColorInfo {
  color: AgentColorName;
  themeColor: string;
  tmuxColor: string;
}

/**
 * Agent颜色分配记录
 */
interface ColorAllocation {
  agentId: string;
  color: AgentColorName;
  allocatedAt: number;
}

/**
 * Agent颜色管理器
 */
export class AgentColorManager {
  private colorMap: Map<string, AgentColorName> = new Map();
  private allocationOrder: ColorAllocation[] = [];
  private usedColors: Set<AgentColorName> = new Set();

  /**
   * 分配颜色给Agent
   * @param agentId Agent ID
   * @param preferredColor 首选颜色（可选）
   * @returns 分配的颜色信息
   */
  allocateColor(agentId: string, preferredColor?: AgentColorName): AgentColorInfo {
    let color: AgentColorName;

    // 如果已有颜色，直接返回
    const existingColor = this.colorMap.get(agentId);
    if (existingColor) {
      return this.getColorInfo(existingColor);
    }

    // 如果有首选颜色且可用，使用首选颜色
    if (preferredColor && !this.usedColors.has(preferredColor)) {
      color = preferredColor;
    } else {
      // 分配一个未使用的颜色
      color = this.getNextAvailableColor();
    }

    // 记录分配
    this.colorMap.set(agentId, color);
    this.usedColors.add(color);
    this.allocationOrder.push({
      agentId,
      color,
      allocatedAt: Date.now(),
    });

    logger.debug(`Allocated color ${color} to agent ${agentId}`);

    return this.getColorInfo(color);
  }

  /**
   * 释放Agent的颜色
   * @param agentId Agent ID
   */
  releaseColor(agentId: string): void {
    const color = this.colorMap.get(agentId);
    if (color) {
      this.usedColors.delete(color);
      this.colorMap.delete(agentId);

      // 从分配顺序中移除
      this.allocationOrder = this.allocationOrder.filter(a => a.agentId !== agentId);

      logger.debug(`Released color ${color} from agent ${agentId}`);
    }
  }

  /**
   * 获取Agent的颜色
   * @param agentId Agent ID
   * @returns 颜色信息或undefined
   */
  getColor(agentId: string): AgentColorInfo | undefined {
    const color = this.colorMap.get(agentId);
    return color ? this.getColorInfo(color) : undefined;
  }

  /**
   * 检查Agent是否有颜色
   * @param agentId Agent ID
   * @returns 是否有颜色
   */
  hasColor(agentId: string): boolean {
    return this.colorMap.has(agentId);
  }

  /**
   * 获取所有已分配的颜色
   * @returns 颜色映射
   */
  getAllColors(): Map<string, AgentColorName> {
    return new Map(this.colorMap);
  }

  /**
   * 获取已使用的颜色列表
   * @returns 已使用的颜色列表
   */
  getUsedColors(): AgentColorName[] {
    return Array.from(this.usedColors);
  }

  /**
   * 获取可用的颜色列表
   * @returns 可用的颜色列表
   */
  getAvailableColors(): AgentColorName[] {
    return AGENT_COLORS.filter(c => !this.usedColors.has(c));
  }

  /**
   * 重置所有颜色分配
   */
  reset(): void {
    this.colorMap.clear();
    this.usedColors.clear();
    this.allocationOrder = [];
    logger.debug('Reset all agent color allocations');
  }

  /**
   * 获取下一个可用颜色
   */
  private getNextAvailableColor(): AgentColorName {
    // 首先尝试FIFO顺序，回收最早使用的颜色（如果全部被使用）
    if (this.usedColors.size >= AGENT_COLORS.length) {
      const oldest = this.allocationOrder[0];
      if (oldest) {
        const oldColor = oldest.color;
        this.colorMap.delete(oldest.agentId);
        this.allocationOrder.shift();
        logger.debug(`Reclaiming oldest color ${oldColor} from agent ${oldest.agentId}`);
        return oldColor;
      }
    }

    // 找到第一个未使用的颜色
    for (const color of AGENT_COLORS) {
      if (!this.usedColors.has(color)) {
        return color;
      }
    }

    // 如果所有颜色都被使用，返回默认颜色
    return 'blue';
  }

  /**
   * 获取颜色的完整信息
   */
  private getColorInfo(color: AgentColorName): AgentColorInfo {
    return {
      color,
      themeColor: AGENT_COLOR_TO_THEME_COLOR[color],
      tmuxColor: AGENT_COLOR_TO_TMUX_COLOR[color],
    };
  }

  /**
   * 获取特定Agent类型的默认颜色
   * @param agentType Agent类型
   * @returns 颜色名称
   */
  getDefaultColorForType(agentType: string): AgentColorName | undefined {
    // 根据Agent类型返回固定的默认颜色
    const defaults: Record<string, AgentColorName> = {
      'general-purpose': 'blue',
      'plan': 'yellow',
      'explore': 'green',
      'verification': 'cyan',
    };

    return defaults[agentType];
  }

  /**
   * 验证颜色是否有效
   * @param color 颜色名称
   * @returns 是否有效
   */
  isValidColor(color: string): color is AgentColorName {
    return AGENT_COLORS.includes(color as AgentColorName);
  }
}

/**
 * 导出单例
 */
export const agentColorManager = new AgentColorManager();

/**
 * 便捷函数：获取Agent颜色
 */
export function getAgentColor(agentId: string): AgentColorInfo | undefined {
  return agentColorManager.getColor(agentId);
}

/**
 * 便捷函数：分配Agent颜色
 */
export function allocateAgentColor(agentId: string, preferredColor?: AgentColorName): AgentColorInfo {
  return agentColorManager.allocateColor(agentId, preferredColor);
}

/**
 * 便捷函数：释放Agent颜色
 */
export function releaseAgentColor(agentId: string): void {
  agentColorManager.releaseColor(agentId);
}

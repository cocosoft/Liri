/**
 * 拒绝追踪器
 * 负责记录和追踪工具执行拒绝事件，支持累计拒绝统计和升级告警
 */

/**
 * 拒绝记录
 */
export interface DenialRecord {
  /** 工具名称 */
  toolName: string;

  /** 拒绝原因 */
  reason: string;

  /** 用户ID（可选） */
  userId?: string;

  /** 拒绝时间戳 */
  timestamp: Date;
}

/**
 * 拒绝统计信息
 */
export interface DenialStats {
  /** 按工具分组的拒绝计数 */
  byTool: Record<string, number>;

  /** 总拒绝次数 */
  totalDenials: number;

  /** 最后拒绝时间 */
  lastDenialTime: Date | null;

  /** 连续拒绝次数（全局） */
  consecutiveDenials: number;
}

/**
 * 工具拒绝状态（内部使用）
 */
interface ToolDenialState {
  /** 该工具的连续拒绝次数 */
  consecutive: number;

  /** 该工具的总拒绝次数 */
  total: number;

  /** 最后拒绝时间 */
  lastTime: Date;

  /** 拒绝历史记录 */
  history: DenialRecord[];
}

/**
 * 拒绝追踪器
 * 追踪每个工具的拒绝次数，当连续拒绝达到阈值时触发升级告警
 */
export class DenialTracker {
  /** 连续拒绝阈值，达到此值后 shouldEscalateToUser 返回 true */
  static readonly DEFAULT_ESCALATION_THRESHOLD = 3;

  /** 工具拒绝状态映射 */
  private toolStates: Map<string, ToolDenialState> = new Map();

  /** 全局连续拒绝计数 */
  private globalConsecutive = 0;

  /** 全局总拒绝计数 */
  private globalTotal = 0;

  /** 最后拒绝时间 */
  private lastDenialTime: Date | null = null;

  /** 升级阈值 */
  private escalationThreshold: number;

  /**
   * @param escalationThreshold 连续拒绝升级阈值，默认为 3
   */
  constructor(
    escalationThreshold: number = DenialTracker.DEFAULT_ESCALATION_THRESHOLD
  ) {
    this.escalationThreshold = escalationThreshold;
  }

  /**
   * 设置升级阈值
   */
  setEscalationThreshold(threshold: number): void {
    this.escalationThreshold = threshold;
  }

  /**
   * 获取升级阈值
   */
  getEscalationThreshold(): number {
    return this.escalationThreshold;
  }

  /**
   * 记录一次拒绝事件
   *
   * @param toolName 被拒绝的工具名称
   * @param reason 拒绝原因
   * @param userId 用户ID（可选）
   */
  trackDenial(toolName: string, reason: string, userId?: string): void {
    const now = new Date();

    // 更新工具状态
    let state = this.toolStates.get(toolName);
    if (!state) {
      state = {
        consecutive: 0,
        total: 0,
        lastTime: now,
        history: [],
      };
      this.toolStates.set(toolName, state);
    }

    state.consecutive++;
    state.total++;
    state.lastTime = now;
    state.history.push({
      toolName,
      reason,
      userId,
      timestamp: now,
    });

    // 更新全局状态
    this.globalConsecutive++;
    this.globalTotal++;
    this.lastDenialTime = now;
  }

  /**
   * 记录一次成功执行（重置该工具的连续拒绝计数）
   *
   * @param toolName 成功执行的工具名称
   */
  recordSuccess(toolName: string): void {
    const state = this.toolStates.get(toolName);
    if (state) {
      state.consecutive = 0;
    }

    // 重置全局连续计数
    this.globalConsecutive = 0;
  }

  /**
   * 获取拒绝统计信息
   */
  getDenialStats(): DenialStats {
    const byTool: Record<string, number> = {};
    for (const [toolName, state] of this.toolStates) {
      byTool[toolName] = state.total;
    }

    return {
      byTool,
      totalDenials: this.globalTotal,
      lastDenialTime: this.lastDenialTime,
      consecutiveDenials: this.globalConsecutive,
    };
  }

  /**
   * 判断指定工具是否应升级到用户确认
   * 当工具的连续拒绝次数达到阈值时返回 true
   *
   * @param toolName 工具名称
   */
  shouldEscalateToUser(toolName: string): boolean {
    const state = this.toolStates.get(toolName);
    if (!state) {
      return false;
    }
    return state.consecutive >= this.escalationThreshold;
  }

  /**
   * 获取指定工具的工具级别连续拒绝次数
   *
   * @param toolName 工具名称
   */
  getConsecutiveDenials(toolName: string): number {
    const state = this.toolStates.get(toolName);
    return state ? state.consecutive : 0;
  }

  /**
   * 获取指定工具的总拒绝次数
   *
   * @param toolName 工具名称
   */
  getTotalDenials(toolName: string): number {
    const state = this.toolStates.get(toolName);
    return state ? state.total : 0;
  }

  /**
   * 获取拒绝历史记录
   *
   * @param limit 限制返回的记录条数，默认返回全部。limit=0 时返回空数组
   */
  getDenialHistory(limit?: number): DenialRecord[] {
    if (limit !== undefined && limit <= 0) {
      return [];
    }

    const allRecords: DenialRecord[] = [];
    for (const state of this.toolStates.values()) {
      allRecords.push(...state.history);
    }

    // 按时间戳降序排序
    allRecords.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (limit !== undefined) {
      return allRecords.slice(0, limit);
    }
    return allRecords;
  }

  /**
   * 获取指定工具的拒绝历史
   *
   * @param toolName 工具名称
   * @param limit 限制返回的记录条数
   */
  getToolDenialHistory(toolName: string, limit?: number): DenialRecord[] {
    const state = this.toolStates.get(toolName);
    if (!state) {
      return [];
    }

    const records = [...state.history].reverse();
    if (limit !== undefined && limit > 0) {
      return records.slice(0, limit);
    }
    return records;
  }

  /**
   * 重置所有追踪状态
   */
  reset(): void {
    this.toolStates.clear();
    this.globalConsecutive = 0;
    this.globalTotal = 0;
    this.lastDenialTime = null;
  }

  /**
   * 重置指定工具的拒绝状态
   *
   * @param toolName 工具名称
   */
  resetTool(toolName: string): void {
    const state = this.toolStates.get(toolName);
    if (state) {
      state.consecutive = 0;
      state.total = 0;
      state.history = [];
    }
  }

  /**
   * 获取所有被追踪的工具名称列表
   */
  getTrackedTools(): string[] {
    return Array.from(this.toolStates.keys());
  }

  /**
   * 获取被追踪的工具数量
   */
  getTrackedToolCount(): number {
    return this.toolStates.size;
  }
}

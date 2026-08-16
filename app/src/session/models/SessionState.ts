import { getLogger } from '@modules/monitoring';

const logger = getLogger('session:models:state');

/**
 * 状态历史记录
 */
export interface StateHistory {
  /**
   * 状态名称
   */
  state: string;

  /**
   * 状态时间戳
   */
  timestamp: Date;
}

/**
 * 会话状态接口
 */
export interface SessionState {
  /**
   * 当前状态
   */
  currentState: string;

  /**
   * 状态历史记录
   */
  history: StateHistory[];

  /**
   * 会话配置
   */
  config: Record<string, unknown>;
}

/**
 * 合法会话状态集合（P1-27 修复）：对齐新状态机（state/session/types.ts）8 状态枚举。
 * 旧实现默认 'active' 不在该枚举中，导致持久化的状态新状态机不认。
 */
export const SESSION_STATES: ReadonlySet<string> = new Set([
  'idle',
  'running',
  'requires_action',
  'paused',
  'completed',
  'error',
  'archived',
  'aborted',
]);

/**
 * 会话状态类
 */
export class SessionState implements SessionState {
  /**
   * 创建一个新的会话状态实例
   * @param currentState 当前状态
   * @param history 状态历史记录
   * @param config 会话配置
   */
  constructor(
    public currentState: string = 'idle',
    public history: StateHistory[] = [],
    public config: Record<string, unknown> = {}
  ) {
    // 初始化时添加当前状态到历史记录
    if (history.length === 0) {
      this.addStateHistory(currentState);
    }
  }

  /**
   * 添加状态历史记录
   * @param state 状态名称
   */
  addStateHistory(state: string): void {
    this.history.push({
      state,
      timestamp: new Date(),
    });
  }

  /**
   * 更新当前状态
   * @param state 新的状态
   */
  updateState(state: string): void {
    // P1-27 修复：状态词汇表校验——对齐新状态机（state/session/types.ts）8 状态枚举，
    // 旧值 'active' 不在枚举中（此前任意字符串可写入，持久化后新状态机不认）。
    if (!SESSION_STATES.has(state)) {
      logger.warn('非法会话状态，忽略更新', {
        from: this.currentState,
        to: state,
      });
      return;
    }
    if (state !== this.currentState) {
      const from = this.currentState;
      this.currentState = state;
      this.addStateHistory(state);
      logger.debug('会话状态切换', { from, to: state });
    }
  }

  /**
   * 设置配置项
   * @param key 配置键
   * @param value 配置值
   */
  setConfig(key: string, value: any): void {
    this.config[key] = value;
  }

  /**
   * 获取配置项
   * @param key 配置键
   * @returns 配置值
   */
  getConfig(key: string): any {
    return this.config[key];
  }

  /**
   * 移除配置项
   * @param key 配置键
   */
  removeConfig(key: string): void {
    delete this.config[key];
  }

  /**
   * 序列化状态
   * @returns 序列化后的状态对象
   */
  toJSON(): object {
    return {
      currentState: this.currentState,
      history: this.history.map((h) => ({
        state: h.state,
        timestamp: h.timestamp.toISOString(),
      })),
      config: this.config,
    };
  }

  /**
   * 从JSON创建状态
   * @param data JSON数据
   * @returns 状态实例
   */
  static fromJSON(data: any): SessionState {
    return new SessionState(
      data.currentState || 'idle',
      (data.history || []).map((h: any) => ({
        state: h.state,
        timestamp: new Date(h.timestamp),
      })),
      data.config || {}
    );
  }
}

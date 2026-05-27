/**
 * 消息发送门控状态机
 * 在初始刷新（flush）期间控制消息写入
 * 当桥接会话启动时，历史消息通过单个HTTP POST刷新到服务器。
 * 在刷新期间，新消息必须排队以防止与历史消息交错到达服务器。
 */

export class FlushGate<T> {
  private _active: boolean = false;
  private _pending: T[] = [];

  get active(): boolean {
    return this._active;
  }

  get pendingCount(): number {
    return this._pending.length;
  }

  /**
   * 标记刷新进行中。enqueue()将开始对项目进行排队
   */
  start(): void {
    this._active = true;
  }

  /**
   * 结束刷新并返回排队的项目以供排干
   * 调用者负责发送返回的项目
   */
  end(): T[] {
    this._active = false;
    return this._pending.splice(0);
  }

  /**
   * 如果刷新处于活动状态，则将项目排队并返回true
   * 如果刷新不活动，则返回false（调用者应直接发送）
   */
  enqueue(...items: T[]): boolean {
    if (!this._active) return false;
    this._pending.push(...items);
    return true;
  }

  /**
   * 丢弃所有排队的项目（永久传输关闭）
   * 返回丢弃的项目数量
   */
  drop(): number {
    this._active = false;
    const count = this._pending.length;
    this._pending.length = 0;
    return count;
  }

  /**
   * 清除活动标志而不丢弃排队的项目
   * 用于传输替换（onWorkReceived）— 新传输的刷新将排干待处理项目
   */
  deactivate(): void {
    this._active = false;
  }

  /**
   * 获取所有待处理项目但不删除它们
   */
  peek(): T[] {
    return [...this._pending];
  }

  /**
   * 检查是否有待处理项目
   */
  hasPending(): boolean {
    return this._pending.length > 0;
  }

  /**
   * 清除所有待处理项目并返回它们
   */
  clear(): T[] {
    const items = this._pending.splice(0);
    return items;
  }
}

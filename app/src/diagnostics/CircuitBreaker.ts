/**
 * 断路器组件
 *
 * 为非关键服务提供指数退避重试机制：
 * - 连续失败 N 次后断开电路，跳过后续操作
 * - 经过冷却时间后自动半开，允许重试
 * - 成功时重置计数器
 *
 * 使用场景：Gateway 预加载、GitHub Release 检查等非关键服务
 */

/**
 * 断路器内部状态快照
 */
export interface CircuitState {
  /** 当前连续失败次数 */
  failureCount: number;
  /** 最近一次失败时间戳 */
  lastFailureTime: number;
  /** 电路是否断开 */
  isOpen: boolean;
  /** 下次允许重试的时间戳 */
  nextRetryTime: number;
}

/**
 * 断路器配置选项
 */
export interface CircuitBreakerOptions {
  /** 断路器名称（用于日志标识） */
  name: string;
  /** 触发断路的连续失败次数阈值，默认 3 */
  maxFailures?: number;
  /** 基础退避延迟（毫秒），默认 5_000 */
  baseDelayMs?: number;
  /** 最大退避延迟（毫秒），默认 300_000（5分钟） */
  maxDelayMs?: number;
}

const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_BASE_DELAY_MS = 5_000;
const DEFAULT_MAX_DELAY_MS = 300_000;

/**
 * 断路器
 *
 * 实现指数退避策略：断开后的等待时间 = baseDelay * 2^(超过阈值的失败次数)
 * 例如 maxFailures=3, baseDelay=5s:
 *   - 第3次失败: 5s
 *   - 第4次失败: 10s
 *   - 第5次失败: 20s
 *   - ...上限为 maxDelayMs
 */
export class CircuitBreaker {
  private state: CircuitState;
  private readonly options: Required<Omit<CircuitBreakerOptions, 'name'>> &
    Pick<CircuitBreakerOptions, 'name'>;
  private static instances = new Map<string, CircuitBreaker>();

  constructor(options: CircuitBreakerOptions) {
    this.options = {
      maxFailures: options.maxFailures ?? DEFAULT_MAX_FAILURES,
      baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      maxDelayMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      name: options.name,
    };
    this.state = {
      failureCount: 0,
      lastFailureTime: 0,
      isOpen: false,
      nextRetryTime: 0,
    };
  }

  /**
   * 获取或创建命名断路器实例（单例复用）
   */
  static getOrCreate(
    name: string,
    opts?: Partial<CircuitBreakerOptions>
  ): CircuitBreaker {
    let breaker = CircuitBreaker.instances.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker({ name, ...opts });
      CircuitBreaker.instances.set(name, breaker);
    }
    return breaker;
  }

  /**
   * 检查断路器是否断开
   *
   * 若断开且未到重试时间，返回 true（跳过操作）；
   * 若已到重试时间，自动将电路切换为半开状态，返回 false（允许重试）
   */
  isOpen(): boolean {
    if (!this.state.isOpen) return false;

    if (Date.now() >= this.state.nextRetryTime) {
      this.state.isOpen = false;
      return false;
    }

    return true;
  }

  /**
   * 记录成功，重置失败计数和断路器状态
   */
  recordSuccess(): void {
    this.state.failureCount = 0;
    this.state.isOpen = false;
    this.state.nextRetryTime = 0;
  }

  /**
   * 记录失败，按指数退避计算下次重试时间
   */
  recordFailure(): void {
    this.state.failureCount++;
    this.state.lastFailureTime = Date.now();

    if (this.state.failureCount >= this.options.maxFailures) {
      const excessFailures = this.state.failureCount - this.options.maxFailures;
      const delay = Math.min(
        this.options.baseDelayMs * Math.pow(2, excessFailures),
        this.options.maxDelayMs
      );
      this.state.isOpen = true;
      this.state.nextRetryTime = Date.now() + delay;
    }
  }

  /**
   * 获取当前状态快照
   */
  getState(): Readonly<CircuitState> {
    return { ...this.state };
  }

  /**
   * 获取剩余冷却时间（毫秒）。0 表示未断开或已冷却完毕
   */
  getRemainingCooldown(): number {
    if (!this.state.isOpen) return 0;
    return Math.max(0, this.state.nextRetryTime - Date.now());
  }

  /**
   * 重置断路器至初始状态
   */
  reset(): void {
    this.state = {
      failureCount: 0,
      lastFailureTime: 0,
      isOpen: false,
      nextRetryTime: 0,
    };
  }

  /**
   * 清理所有断路器实例（主要用于测试）
   */
  static resetAll(): void {
    CircuitBreaker.instances.clear();
  }
}

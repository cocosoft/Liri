//
/**
 * 任务抖动服务
 * 实现任务抖动功能，包括一次性任务提前执行和周期性任务延迟执行
 * 参考CC源码: cc_code/backend/utils/cronJitterConfig.ts
 */

/**
 * 任务抖动配置
 */
export interface CronJitterConfig {
  recurringFrac: number;
  recurringCapMs: number;
  oneShotMaxMs: number;
  oneShotFloorMs: number;
  oneShotMinuteMod: number;
  recurringMaxAgeMs: number;
}

/**
 * 默认任务抖动配置
 */
export const DEFAULT_CRON_JITTER_CONFIG: CronJitterConfig = {
  recurringFrac: 0.1,
  recurringCapMs: 60000,
  oneShotMaxMs: 60000,
  oneShotFloorMs: 30000,
  oneShotMinuteMod: 60,
  recurringMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
};

const HALF_HOUR_MS = 30 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 任务抖动服务类
 */
export class TaskJitterService {
  private static instance: TaskJitterService;
  private config: CronJitterConfig = { ...DEFAULT_CRON_JITTER_CONFIG };
  private hashSeed: number = Date.now();

  private constructor() {
    this.hashSeed = Math.floor(Math.random() * 1000000);
  }

  /**
   * 获取单例实例
   */
  static getInstance(): TaskJitterService {
    if (!TaskJitterService.instance) {
      TaskJitterService.instance = new TaskJitterService();
    }
    return TaskJitterService.instance;
  }

  /**
   * 更新抖动配置
   * @param config 新的配置
   */
  updateConfig(config: Partial<CronJitterConfig>): void {
    this.config = { ...this.config, ...config };
    this.validateConfig();
  }

  /**
   * 获取当前配置
   * @returns 当前抖动配置
   */
  getConfig(): CronJitterConfig {
    return { ...this.config };
  }

  /**
   * 验证配置有效性
   */
  private validateConfig(): void {
    if (this.config.recurringFrac < 0 || this.config.recurringFrac > 1) {
      throw new Error('recurringFrac must be between 0 and 1');
    }

    if (
      this.config.recurringCapMs < 0 ||
      this.config.recurringCapMs > HALF_HOUR_MS
    ) {
      throw new Error('recurringCapMs must be between 0 and 1800000');
    }

    if (
      this.config.oneShotMaxMs < 0 ||
      this.config.oneShotMaxMs > HALF_HOUR_MS
    ) {
      throw new Error('oneShotMaxMs must be between 0 and 1800000');
    }

    if (
      this.config.oneShotFloorMs < 0 ||
      this.config.oneShotFloorMs > HALF_HOUR_MS
    ) {
      throw new Error('oneShotFloorMs must be between 0 and 1800000');
    }

    if (this.config.oneShotMinuteMod < 1 || this.config.oneShotMinuteMod > 60) {
      throw new Error('oneShotMinuteMod must be between 1 and 60');
    }

    if (
      this.config.recurringMaxAgeMs < 0 ||
      this.config.recurringMaxAgeMs > THIRTY_DAYS_MS
    ) {
      throw new Error('recurringMaxAgeMs must be between 0 and 2592000000');
    }

    if (this.config.oneShotFloorMs > this.config.oneShotMaxMs) {
      throw new Error('oneShotFloorMs cannot be greater than oneShotMaxMs');
    }
  }

  /**
   * 计算基于任务ID的哈希值
   * @param taskId 任务ID
   * @returns 哈希值（0-1）
   */
  private hashTaskId(taskId: string): number {
    let hash = this.hashSeed;
    for (let i = 0; i < taskId.length; i++) {
      const char = taskId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash) / 2147483647;
  }

  /**
   * 计算周期性任务的抖动延迟
   * @param taskId 任务ID
   * @returns 抖动延迟（毫秒）
   */
  calculateRecurringJitter(taskId: string): number {
    const jitterFraction = this.hashTaskId(taskId) * this.config.recurringFrac;
    const jitterMs = jitterFraction * this.config.recurringCapMs;
    return Math.floor(jitterMs);
  }

  /**
   * 计算一次性任务的最大延迟
   * @param taskId 任务ID
   * @returns 最大延迟（毫秒）
   */
  calculateOneShotMaxDelay(taskId: string): number {
    const jitterFraction = this.hashTaskId(taskId);
    const range = this.config.oneShotMaxMs - this.config.oneShotFloorMs;
    return this.config.oneShotFloorMs + Math.floor(jitterFraction * range);
  }

  /**
   * 计算周期性任务的下一次执行时间（考虑抖动）
   * @param cronExpression cron表达式
   * @param lastFireTime 上次执行时间
   * @param taskId 任务ID
   * @returns 下一次执行时间（毫秒）
   */
  calculateNextRecurringFireTime(
    cronExpression: string,
    lastFireTime: number,
    taskId: string
  ): number | null {
    const nextFireTime = this.calculateNextCronRun(
      cronExpression,
      lastFireTime
    );
    if (nextFireTime === null) {
      return null;
    }

    const jitter = this.calculateRecurringJitter(taskId);
    return nextFireTime + jitter;
  }

  /**
   * 计算一次性任务的下一次执行时间（考虑抖动）
   * @param cronExpression cron表达式
   * @param createdAt 任务创建时间
   * @param taskId 任务ID
   * @returns 下一次执行时间（毫秒）
   */
  calculateNextOneShotFireTime(
    cronExpression: string,
    createdAt: number,
    taskId: string
  ): number | null {
    const baseTime = Math.max(createdAt, Date.now());
    const nextFireTime = this.calculateNextCronRun(cronExpression, baseTime);
    if (nextFireTime === null) {
      return null;
    }

    const jitter = this.calculateOneShotMaxDelay(taskId);
    return nextFireTime + jitter;
  }

  /**
   * 计算下一次cron执行时间
   * @param cronExpression cron表达式
   * @param fromTime 起始时间
   * @returns 下一次执行时间（毫秒）
   */
  private calculateNextCronRun(
    cronExpression: string,
    fromTime: number
  ): number | null {
    const parts = cronExpression.split(' ');
    if (parts.length !== 5) {
      return null;
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map((p) =>
      p.trim()
    );

    const fromDate = new Date(fromTime);
    const currentMinute = fromDate.getMinutes();
    const currentHour = fromDate.getHours();
    const currentDayOfMonth = fromDate.getDate();
    const currentMonth = fromDate.getMonth() + 1;
    const currentDayOfWeek = fromDate.getDay();

    let targetMinute = this.parseCronField(minute, currentMinute, 0, 59);
    let targetHour = this.parseCronField(hour, currentHour, 0, 23);
    let targetDayOfMonth = this.parseCronField(
      dayOfMonth,
      currentDayOfMonth,
      1,
      31
    );
    let targetMonth = this.parseCronField(month, currentMonth, 1, 12);
    let targetDayOfWeek = this.parseCronField(
      dayOfWeek,
      currentDayOfWeek,
      0,
      6
    );

    if (
      targetMinute === null ||
      targetHour === null ||
      targetDayOfMonth === null ||
      targetMonth === null ||
      targetDayOfWeek === null
    ) {
      return null;
    }

    let year = fromDate.getFullYear();
    const maxIterations = 366 * 24 * 60;

    for (let i = 0; i < maxIterations; i++) {
      const candidate = new Date(
        year,
        targetMonth! - 1,
        targetDayOfMonth!,
        targetHour!,
        targetMinute!
      );

      if (candidate.getTime() <= fromTime) {
        this.advanceNextTime(
          candidate,
          minute,
          hour,
          dayOfMonth,
          month,
          dayOfWeek
        );
        targetMinute = this.parseCronField(
          minute,
          candidate.getMinutes(),
          0,
          59
        );
        targetHour = this.parseCronField(hour, candidate.getHours(), 0, 23);
        targetDayOfMonth = this.parseCronField(
          dayOfMonth,
          candidate.getDate(),
          1,
          31
        );
        targetMonth = this.parseCronField(
          month,
          candidate.getMonth() + 1,
          1,
          12
        );
        targetDayOfWeek = this.parseCronField(
          dayOfWeek,
          candidate.getDay(),
          0,
          6
        );
        year = candidate.getFullYear();
        continue;
      }

      if (
        this.matchesCronField(targetMonth!, month, currentMonth, 1, 12) &&
        this.matchesCronField(
          targetDayOfMonth!,
          dayOfMonth,
          currentDayOfMonth,
          1,
          31
        ) &&
        this.matchesCronField(
          targetDayOfWeek!,
          dayOfWeek,
          currentDayOfWeek,
          0,
          6
        )
      ) {
        return candidate.getTime();
      }

      this.advanceNextTime(
        candidate,
        minute,
        hour,
        dayOfMonth,
        month,
        dayOfWeek
      );
      targetMinute = this.parseCronField(minute, candidate.getMinutes(), 0, 59);
      targetHour = this.parseCronField(hour, candidate.getHours(), 0, 23);
      targetDayOfMonth = this.parseCronField(
        dayOfMonth,
        candidate.getDate(),
        1,
        31
      );
      targetMonth = this.parseCronField(month, candidate.getMonth() + 1, 1, 12);
      targetDayOfWeek = this.parseCronField(
        dayOfWeek,
        candidate.getDay(),
        0,
        6
      );
      year = candidate.getFullYear();
    }

    return null;
  }

  /**
   * 解析cron字段
   */
  private parseCronField(
    field: string,
    current: number,
    min: number,
    max: number
  ): number | null {
    if (field === '*') {
      return current;
    }

    if (field.includes('/')) {
      const [range, step] = field.split('/');
      const stepNum = parseInt(step, 10);
      if (range === '*') {
        return Math.floor(current / stepNum) * stepNum;
      }
      const [start, end] = range.split('-').map((n) => parseInt(n, 10));
      const adjustedCurrent = Math.max(current, start);
      return Math.floor((adjustedCurrent - start) / stepNum) * stepNum + start;
    }

    if (field.includes('-')) {
      const [start, end] = field.split('-').map((n) => parseInt(n, 10));
      if (current < start || current > end) {
        return start;
      }
      return current;
    }

    if (field.includes(',')) {
      const values = field.split(',').map((n) => parseInt(n, 10));
      for (const v of values.sort((a, b) => a - b)) {
        if (v >= current) {
          return v;
        }
      }
      return values[0];
    }

    const value = parseInt(field, 10);
    if (isNaN(value) || value < min || value > max) {
      return null;
    }

    return value;
  }

  /**
   * 检查字段是否匹配
   */
  private matchesCronField(
    value: number,
    field: string,
    current: number,
    min: number,
    max: number
  ): boolean {
    if (field === '*') {
      return true;
    }

    if (field.includes('/')) {
      const [range, step] = field.split('/');
      const stepNum = parseInt(step, 10);
      if (range === '*') {
        return value % stepNum === 0;
      }
      const [start] = range.split('-').map((n) => parseInt(n, 10));
      return value >= start && (value - start) % stepNum === 0;
    }

    if (field.includes('-')) {
      const [start, end] = field.split('-').map((n) => parseInt(n, 10));
      return value >= start && value <= end;
    }

    if (field.includes(',')) {
      const values = field.split(',').map((n) => parseInt(n, 10));
      return values.includes(value);
    }

    return value === parseInt(field, 10);
  }

  /**
   * 推进到下一个匹配时间
   */
  private advanceNextTime(
    date: Date,
    minute: string,
    hour: string,
    dayOfMonth: string,
    month: string,
    dayOfWeek: string
  ): void {
    date.setMinutes(date.getMinutes() + 1);

    if (date.getMinutes() !== 0) {
      return;
    }

    date.setHours(date.getHours() + 1);

    if (date.getHours() !== 0) {
      return;
    }

    date.setDate(date.getDate() + 1);

    if (dayOfMonth === '*' && dayOfWeek === '*') {
      return;
    }

    if (dayOfMonth !== '*' && dayOfWeek === '*') {
      return;
    }

    if (dayOfMonth === '*' && dayOfWeek !== '*') {
      return;
    }
  }

  /**
   * 检查任务是否已过期
   * @param createdAt 任务创建时间
   * @param isRecurring 是否为周期性任务
   * @param isPermanent 是否为永久任务
   * @returns 是否过期
   */
  isTaskExpired(
    createdAt: number,
    isRecurring: boolean,
    isPermanent: boolean
  ): boolean {
    if (!isRecurring || isPermanent) {
      return false;
    }

    if (this.config.recurringMaxAgeMs === 0) {
      return false;
    }

    return Date.now() - createdAt >= this.config.recurringMaxAgeMs;
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.config = { ...DEFAULT_CRON_JITTER_CONFIG };
    this.hashSeed = Math.floor(Math.random() * 1000000);
  }
}

/**
 * 导出单例
 */
export const taskJitterService = TaskJitterService.getInstance();

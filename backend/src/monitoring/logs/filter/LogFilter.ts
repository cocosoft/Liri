/**
 * LogFilter 日志子系统过滤
 * 对标 CC 的子系统过滤能力
 */

/**
 * 过滤规则
 */
export interface FilterRule {
  name: string;
  subsystem?: string;
  level?: string;
  pattern?: RegExp | string;
  action: 'include' | 'exclude';
}

/**
 * 过滤配置
 */
export interface LogFilterConfig {
  enabled: boolean;
  rules: FilterRule[];
  defaultAction: 'include' | 'exclude';
}

/**
 * 日志过滤器
 */
export class LogFilter {
  private config: LogFilterConfig;

  constructor(config?: Partial<LogFilterConfig>) {
    this.config = {
      enabled: config?.enabled !== false,
      rules: config?.rules || [],
      defaultAction: config?.defaultAction || 'include',
    };
  }

  /**
   * 判断是否应包含
   */
  shouldInclude(subsystem: string, level: string, message: string): boolean {
    if (!this.config.enabled) return true;

    for (const rule of this.config.rules) {
      if (this.matchRule(rule, subsystem, level, message)) {
        return rule.action === 'include';
      }
    }

    return this.config.defaultAction === 'include';
  }

  /**
   * 过滤日志行
   */
  filter(line: string): string | null {
    if (!this.config.enabled) return line;

    const parsed = this.parseLogLine(line);
    if (!parsed) return this.config.defaultAction === 'include' ? line : null;

    const { subsystem, level, message } = parsed;

    return this.shouldInclude(subsystem, level, message) ? line : null;
  }

  /**
   * 过滤数组
   */
  filterArray(lines: string[]): string[] {
    const result: string[] = [];

    for (const line of lines) {
      const filtered = this.filter(line);

      if (filtered !== null) {
        result.push(filtered);
      }
    }

    return result;
  }

  /**
   * 添加规则
   */
  addRule(rule: FilterRule): void {
    this.config.rules.push(rule);
  }

  /**
   * 启用子系统
   */
  enableSubsystem(subsystem: string): void {
    this.config.rules.push({ name: `enable-${subsystem}`, subsystem, action: 'include' });
  }

  /**
   * 禁用子系统
   */
  disableSubsystem(subsystem: string): void {
    this.config.rules.push({ name: `disable-${subsystem}`, subsystem, action: 'exclude' });
  }

  /**
   * 匹配规则
   */
  private matchRule(rule: FilterRule, subsystem: string, level: string, message: string): boolean {
    if (rule.subsystem && !subsystem.includes(rule.subsystem)) return false;

    if (rule.level && level !== rule.level) return false;

    if (rule.pattern) {
      if (rule.pattern instanceof RegExp) {
        return rule.pattern.test(message);
      }

      return message.includes(rule.pattern);
    }

    return true;
  }

  /**
   * 解析日志行
   */
  private parseLogLine(line: string): { subsystem: string; level: string; message: string } | null {
    const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]\s+\[(\w+)\]\s+\[(\w+)\]\s+(.+)$/);

    if (match) {
      return { subsystem: match[3], level: match[2], message: match[4] };
    }

    const simpleMatch = line.match(/^\[(\w+)\]\s+\[(\w+)\]\s+(.+)$/);

    if (simpleMatch) {
      return { subsystem: simpleMatch[1], level: simpleMatch[2], message: simpleMatch[3] };
    }

    return null;
  }
}

export const logFilter = new LogFilter();

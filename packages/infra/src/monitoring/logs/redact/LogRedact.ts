/**
 * LogRedact 日志脱敏
 * 对标 CC 的日志脱敏能力
 */

/**
 * 脱敏模式
 */
export interface RedactPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * 脱敏配置
 */
export interface LogRedactConfig {
  enabled: boolean;
  patterns: RedactPattern[];
  maskChar: string;
}

/**
 * 默认敏感模式
 */
const DEFAULT_PATTERNS: RedactPattern[] = [
  {
    name: 'api-key',
    pattern: /(api[_-]?key|apikey)['":]\s*['"]?([^'"\s,}]+)/gi,
    replacement: '$1: ***REDACTED***',
  },
  {
    name: 'url-key-param',
    // URL/WS 查询参数中的 key= 值（如 Gemini Live `wss://...?key=AIza...`）
    pattern: /([?&]key=)[^&\s'"}]+/gi,
    replacement: '$1***REDACTED***',
  },
  {
    name: 'token',
    pattern: /(token|bearer)['":]\s*['"]?([^'"\s,}]+)/gi,
    replacement: '$1: ***REDACTED***',
  },
  {
    name: 'password',
    pattern: /(password|passwd)['":]\s*['"]?([^'"\s,}]+)/gi,
    replacement: '$1: ***REDACTED***',
  },
  {
    name: 'secret',
    pattern: /(secret)['":]\s*['"]?([^'"\s,}]+)/gi,
    replacement: '$1: ***REDACTED***',
  },
  {
    name: 'authorization-header',
    pattern: /(authorization|auth):\s*['"]?([^'"\s\r\n,}]+)/gi,
    replacement: '$1: ***REDACTED***',
  },
  {
    name: 'jwt',
    pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    replacement: '***JWT_REDACTED***',
  },
  {
    name: 'private-key',
    pattern:
      /-----BEGIN (RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC )?PRIVATE KEY-----/g,
    replacement: '***PRIVATE_KEY_REDACTED***',
  },
  {
    name: 'credit-card',
    pattern: /\b(\d{4}[-\s]?){3}\d{4}\b/g,
    // P2 修复（2026-08-14 排查）：原 replacement 为 '****-****-****-${1}'——
    // `${1}` 在 String.replace 中不是特殊模式（特殊的是 `$1`），按字面残留到日志
    // （证据：raw: 3.****-****-****-${1}）。改为纯掩码，去除占位符残留。
    replacement: '****-****-****',
  },
];

/**
 * 日志脱敏器
 */
export class LogRedact {
  private config: LogRedactConfig;

  constructor(config?: Partial<LogRedactConfig>) {
    this.config = {
      enabled: config?.enabled !== false,
      patterns: config?.patterns || [...DEFAULT_PATTERNS],
      maskChar: config?.maskChar || '*',
    };
  }

  /**
   * 脱敏日志行
   */
  redact(line: string): string {
    if (!this.config.enabled) return line;

    let result = line;

    for (const rp of this.config.patterns) {
      result = result.replace(rp.pattern, rp.replacement);
    }

    return result;
  }

  /**
   * 脱敏数组
   */
  redactArray(lines: string[]): string[] {
    return lines.map((line) => this.redact(line));
  }

  /**
   * 添加脱敏模式
   */
  addPattern(pattern: RedactPattern): void {
    this.config.patterns.push(pattern);
  }

  /**
   * 重置为默认模式
   */
  resetPatterns(): void {
    this.config.patterns = [...DEFAULT_PATTERNS];
  }

  /**
   * 获取配置
   */
  getConfig(): LogRedactConfig {
    return { ...this.config, patterns: [...this.config.patterns] };
  }
}

export const logRedact = new LogRedact();

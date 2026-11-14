/**
 * Gateway 运行时页脚
 * 对标 Hermes gateway/runtime_footer.py
 * 在 Gateway 响应末尾追加运行时信息
 */

/**
 * 运行时页脚配置
 */
export interface RuntimeFooterConfig {
  enabled: boolean;
  showVersion: boolean;
  showUptime: boolean;
  showModel: boolean;
  showCostEstimate: boolean;
  showLatency: boolean;
  maxFooterLength: number;
  format: 'text' | 'markdown' | 'minimal';
}

/**
 * 默认配置
 */
const DEFAULT_FOOTER_CONFIG: RuntimeFooterConfig = {
  enabled: true,
  showVersion: true,
  showUptime: true,
  showModel: false,
  showCostEstimate: false,
  showLatency: false,
  maxFooterLength: 300,
  format: 'minimal',
};

/**
 * 运行时信息
 */
export interface RuntimeInfo {
  version: string;
  uptimeMs: number;
  model?: string;
  estimatedCost?: number;
  latencyMs?: number;
  requestId?: string;
  channelCount?: number;
}

/**
 * Gateway 运行时页脚服务
 */
export class RuntimeFooterFactory {
  private config: RuntimeFooterConfig;
  private startTime: number;

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<RuntimeFooterConfig>) {
    this.config = { ...DEFAULT_FOOTER_CONFIG, ...config };
    this.startTime = Date.now();
  }

  /**
   * 生成运行时页脚
   * @param info 运行时信息
   * @returns 页脚文本
   */
  generate(info?: Partial<RuntimeInfo>): string {
    if (!this.config.enabled) return '';

    const lines: string[] = [];
    const runtime: RuntimeInfo = {
      version: info?.version || process.env['Liri_VERSION'] || 'unknown',
      uptimeMs: info?.uptimeMs || Date.now() - this.startTime,
      model: info?.model,
      estimatedCost: info?.estimatedCost,
      latencyMs: info?.latencyMs,
      requestId: info?.requestId,
      channelCount: info?.channelCount,
    };

    switch (this.config.format) {
      case 'text':
        return this.generateTextFooter(runtime, lines);
      case 'markdown':
        return this.generateMarkdownFooter(runtime, lines);
      case 'minimal':
      default:
        return this.generateMinimalFooter(runtime);
    }
  }

  /**
   * 生成文本格式页脚
   */
  private generateTextFooter(info: RuntimeInfo, lines: string[]): string {
    lines.push('---');

    if (this.config.showVersion) {
      lines.push(`[Liri v${info.version}]`);
    }

    if (this.config.showUptime && info.uptimeMs > 0) {
      const uptimeSeconds = Math.floor(info.uptimeMs / 1000);
      const hours = Math.floor(uptimeSeconds / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);

      lines.push(`[运行时间: ${hours}h${minutes}m]`);
    }

    if (this.config.showModel && info.model) {
      lines.push(`[模型: ${info.model}]`);
    }

    if (this.config.showCostEstimate && info.estimatedCost !== undefined) {
      lines.push(`[成本: $${info.estimatedCost.toFixed(4)}]`);
    }

    if (this.config.showLatency && info.latencyMs !== undefined) {
      lines.push(`[延迟: ${info.latencyMs}ms]`);
    }

    return lines.join(' ');
  }

  /**
   * 生成 Markdown 格式页脚
   */
  private generateMarkdownFooter(info: RuntimeInfo, lines: string[]): string {
    lines.push('---');
    lines.push('');

    if (this.config.showVersion) {
      lines.push(`> 🤖 **Liri** v${info.version}`);
    }

    if (this.config.showUptime && info.uptimeMs > 0) {
      const uptimeSeconds = Math.floor(info.uptimeMs / 1000);
      const hours = Math.floor(uptimeSeconds / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);

      lines.push(`> ⏱ 运行时间: ${hours}h${minutes}m`);
    }

    if (this.config.showModel && info.model) {
      lines.push(`> 🧠 模型: \`${info.model}\``);
    }

    if (this.config.showCostEstimate && info.estimatedCost !== undefined) {
      lines.push(`> 💰 预估成本: $${info.estimatedCost.toFixed(4)}`);
    }

    return lines.join('\n');
  }

  /**
   * 生成极简页脚
   */
  private generateMinimalFooter(info: RuntimeInfo): string {
    const parts: string[] = [];

    if (this.config.showVersion) {
      parts.push(`v${info.version}`);
    }

    if (this.config.showLatency && info.latencyMs !== undefined) {
      parts.push(`${info.latencyMs}ms`);
    }

    if (parts.length === 0) return '';

    return `[${parts.join(' | ')}]`;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<RuntimeFooterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): RuntimeFooterConfig {
    return { ...this.config };
  }
}

/**
 * 全局页脚工厂
 */
let globalFooterFactory: RuntimeFooterFactory | null = null;

/**
 * 获取全局运行时页脚工厂
 */
export function getRuntimeFooterFactory(): RuntimeFooterFactory {
  if (!globalFooterFactory) {
    globalFooterFactory = new RuntimeFooterFactory();
  }

  return globalFooterFactory;
}

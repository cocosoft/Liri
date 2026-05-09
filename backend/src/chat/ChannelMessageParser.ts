/**
 * 通道消息解析服务
 * 实现通道消息的解析和格式化
 */

/**
 * 通道消息标签
 */
export const CHANNEL_TAG = 'channel';

/**
 * 通道箭头符号
 */
export const CHANNEL_ARROW = '→';

/**
 * 通道消息配置
 */
export interface ChannelMessageConfig {
  TRUNCATE_AT?: number;
}

/**
 * 通道消息解析结果
 */
export interface ParsedChannelMessage {
  source: string;
  user?: string;
  chatId?: string;
  content: string;
  truncatedContent: string;
  displaySource: string;
}

/**
 * 简单截断函数
 */
function truncateToWidth(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) {
    return text;
  }
  return text.substring(0, maxWidth - 3) + '...';
}

/**
 * 通道消息解析服务
 */
export class ChannelMessageParser {
  private static instance: ChannelMessageParser;
  private config: Required<ChannelMessageConfig>;
  private channelPattern: RegExp;
  private userAttrPattern: RegExp;
  private chatIdAttrPattern: RegExp;

  private constructor(config: ChannelMessageConfig = {}) {
    this.config = {
      TRUNCATE_AT: config.TRUNCATE_AT ?? 60,
    };

    // 匹配 <channel source="..." user="..." chat_id="...">content</channel>
    this.channelPattern = new RegExp(
      `<${CHANNEL_TAG}\\s+source="([^"]+)"([^>]*)>\\n?([\\s\\S]*?)\\n?</${CHANNEL_TAG}>`
    );

    // 匹配 user="..."
    this.userAttrPattern = /\buser="([^"]+)"/;

    // 匹配 chat_id="..."
    this.chatIdAttrPattern = /\bchat_id="([^"]+)"/;
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: ChannelMessageConfig): ChannelMessageParser {
    if (!ChannelMessageParser.instance) {
      ChannelMessageParser.instance = new ChannelMessageParser(config);
    }
    return ChannelMessageParser.instance;
  }

  /**
   * 解析显示服务器名称（插件提供的服务器名称如 plugin:slack-channel:slack）
   */
  displayServerName(name: string): string {
    const i = name.lastIndexOf(':');
    return i === -1 ? name : name.slice(i + 1);
  }

  /**
   * 解析通道消息
   */
  parse(text: string): ParsedChannelMessage | null {
    const match = this.channelPattern.exec(text);
    if (!match) {
      return null;
    }

    const [, source, attrs, content] = match;

    // 解析用户属性
    const userMatch = this.userAttrPattern.exec(attrs ?? '');
    const user = userMatch?.[1];

    // 解析聊天ID属性
    const chatIdMatch = this.chatIdAttrPattern.exec(attrs ?? '');
    const chatId = chatIdMatch?.[1];

    // 清理和截断内容
    const body = (content ?? '').trim().replace(/\s+/g, ' ');
    const truncatedContent = truncateToWidth(body, this.config.TRUNCATE_AT);

    return {
      source,
      user,
      chatId,
      content: body,
      truncatedContent,
      displaySource: this.displayServerName(source ?? ''),
    };
  }

  /**
   * 检查文本是否为通道消息
   */
  isChannelMessage(text: string): boolean {
    return this.channelPattern.test(text);
  }

  /**
   * 格式化通道消息为显示文本
   */
  formatForDisplay(parsed: ParsedChannelMessage): string {
    const parts: string[] = [];

    // 添加箭头和来源
    parts.push(`${CHANNEL_ARROW} ${parsed.displaySource}`);

    // 添加用户（如果有）
    if (parsed.user) {
      parts.push(` · ${parsed.user}`);
    }

    // 添加冒号
    parts.push(':');

    // 添加内容
    parts.push(` ${parsed.truncatedContent}`);

    return parts.join('');
  }

  /**
   * 格式化通道消息为完整文本
   */
  formatFullText(parsed: ParsedChannelMessage): string {
    const parts: string[] = [];

    parts.push(`${CHANNEL_ARROW} ${parsed.displaySource}`);

    if (parsed.user) {
      parts.push(` · ${parsed.user}`);
    }

    parts.push(`: ${parsed.content}`);

    return parts.join('');
  }

  /**
   * 从原始文本提取通道消息内容
   */
  extractContent(text: string): { isChannelMessage: boolean; content: string } {
    const parsed = this.parse(text);

    if (!parsed) {
      return {
        isChannelMessage: false,
        content: text,
      };
    }

    return {
      isChannelMessage: true,
      content: parsed.content,
    };
  }

  /**
   * 创建通道消息XML
   */
  createChannelMessage(
    source: string,
    content: string,
    options?: { user?: string; chatId?: string }
  ): string {
    const attrs: string[] = [`source="${source}"`];

    if (options?.user) {
      attrs.push(`user="${options.user}"`);
    }

    if (options?.chatId) {
      attrs.push(`chat_id="${options.chatId}"`);
    }

    return `<${CHANNEL_TAG} ${attrs.join(' ')}>${content}</${CHANNEL_TAG}>`;
  }

  /**
   * 设置截断长度
   */
  setTruncateAt(length: number): void {
    this.config.TRUNCATE_AT = length;
  }

  /**
   * 获取截断长度
   */
  getTruncateAt(): number {
    return this.config.TRUNCATE_AT;
  }
}

/**
 * 获取通道消息解析器实例
 */
export function getChannelMessageParser(
  config?: ChannelMessageConfig
): ChannelMessageParser {
  return ChannelMessageParser.getInstance(config);
}

/**
 * 解析通道消息（便捷函数）
 */
export function parseChannelMessage(text: string): ParsedChannelMessage | null {
  const parser = getChannelMessageParser();
  return parser.parse(text);
}

/**
 * 检查是否为通道消息（便捷函数）
 */
export function isChannelMessage(text: string): boolean {
  const parser = getChannelMessageParser();
  return parser.isChannelMessage(text);
}

/**
 * 格式化通道消息（便捷函数）
 */
export function formatChannelMessage(
  text: string,
  fullText: boolean = false
): string {
  const parser = getChannelMessageParser();
  const parsed = parser.parse(text);

  if (!parsed) {
    return text;
  }

  return fullText
    ? parser.formatFullText(parsed)
    : parser.formatForDisplay(parsed);
}

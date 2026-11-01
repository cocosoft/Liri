/**
 * 日志脱敏中间件
 * 对标 Hermes agent/redact.py 的预处理管道
 * 在日志输出前自动执行脱敏，适用于 Logger 和 Gateway 日志输出点
 */
import { RedactConfigManager } from './RedactConfig';
import { RuntimeRedactEngine } from './RuntimeRedactEngine';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('RedactMiddleware');

/**
 * 脱敏中间件类
 * 提供对日志消息和上下文的结构化脱敏
 */
export class RedactMiddleware {
  private engine: RuntimeRedactEngine;

  /**
   * 构造函数
   * @param engine 脱敏引擎实例（可选，默认使用全局单例）
   */
  constructor(engine?: RuntimeRedactEngine) {
    this.engine = engine || RedactConfigManager.getEngine();
  }

  /**
   * 获取脱敏引擎
   * @returns 脱敏引擎实例
   */
  getEngine(): RuntimeRedactEngine {
    return this.engine;
  }

  /**
   * 脱敏字符串消息
   * @param message 原始消息
   * @returns 脱敏后的消息
   */
  redactMessage(message: string): string {
    if (!this.engine.isEnabled()) {
      return message;
    }

    const result = this.engine.redactText(message);

    if (RedactConfigManager.isDryRun() && result.redacted) {
      logger.warn('脱敏试运行：检测到敏感模式', {
        matchCount: result.matches.length,
        patterns: result.matches.join(', '),
      });
    }

    return result.output;
  }

  /**
   * 脱敏日志条目（消息 + 上下文）
   * @param message 日志消息
   * @param context 日志上下文对象
   * @returns 脱敏后的消息和上下文
   */
  redactLogEntry(
    message: string,
    context?: Record<string, unknown>
  ): { message: string; context?: Record<string, unknown> } {
    if (!this.engine.isEnabled()) {
      return { message, context };
    }

    const result = this.engine.redactLogEntry(message, context);

    if (RedactConfigManager.isDryRun()) {
      if (!context) {
        const textResult = this.engine.redactText(message);
        if (textResult.redacted) {
          logger.warn('脱敏试运行：日志消息', {
            matchCount: textResult.matches.length,
          });
        }
      } else {
        const objResult = this.engine.redactObject(context);
        if (objResult.redacted) {
          logger.warn('脱敏试运行：上下文对象', {
            redactedKeys: objResult.redactedKeys.length,
          });
        }
      }
    }

    return result;
  }

  /**
   * 脱敏对象中的所有敏感字段
   * @param obj 原始对象
   * @returns 脱敏后的对象
   */
  redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    if (!this.engine.isEnabled()) {
      return obj;
    }

    const result = this.engine.redactObject(obj);

    if (RedactConfigManager.isDryRun() && result.redacted) {
      logger.warn('脱敏试运行：对象脱敏', {
        redactedKeys: result.redactedKeys.length,
      });
    }

    return result.output;
  }

  /**
   * 脱敏 JSON 字符串
   * @param jsonStr JSON 格式字符串
   * @returns 脱敏后的 JSON 字符串
   */
  redactJson(jsonStr: string): string {
    if (!this.engine.isEnabled()) {
      return jsonStr;
    }

    const result = this.engine.redactJson(jsonStr);

    if (RedactConfigManager.isDryRun() && result.redacted) {
      logger.warn('脱敏试运行：JSON', { matchCount: result.matches.length });
    }

    return result.output;
  }

  /**
   * 脱敏 API 请求/响应日志
   * @param direction 日志方向（request/response）
   * @param message 日志消息
   * @param body 请求/响应体
   * @returns 脱敏后的日志内容
   */
  redactApiLog(
    direction: 'request' | 'response',
    message: string,
    body?: Record<string, unknown>
  ): { message: string; body?: Record<string, unknown> } {
    if (!this.engine.isEnabled()) {
      return { message, body };
    }

    const redactedMessage = this.redactMessage(message);
    let redactedBody = body;

    if (body) {
      const bodyResult = this.engine.redactObject(body);
      if (bodyResult.redacted) {
        redactedBody = bodyResult.output;

        if (RedactConfigManager.isDryRun()) {
          logger.warn('脱敏试运行：API', {
            direction,
            redactedKeys: bodyResult.redactedKeys.length,
          });
        }
      }
    }

    return { message: redactedMessage, body: redactedBody };
  }
}

/**
 * 全局脱敏中间件单例
 */
let globalRedactMiddleware: RedactMiddleware | null = null;

/**
 * 获取全局脱敏中间件实例
 * @returns 脱敏中间件实例
 */
export function getRedactMiddleware(): RedactMiddleware {
  if (!globalRedactMiddleware) {
    globalRedactMiddleware = new RedactMiddleware();
  }

  return globalRedactMiddleware;
}

/**
 * 重置全局脱敏中间件（用于测试）
 */
export function resetRedactMiddleware(): void {
  globalRedactMiddleware = null;
  RedactConfigManager.resetEngine();
}

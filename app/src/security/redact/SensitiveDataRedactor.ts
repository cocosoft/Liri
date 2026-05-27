/**
 * 敏感数据脱敏器
 * 对标 Hermes agent/redact.py 的脱敏功能
 * 提供 API Key、JWT Token、密码等敏感数据的脱敏能力
 */

import { RuntimeRedactEngine } from './RuntimeRedactEngine';

/**
 * 脱敏统计
 */
export interface RedactStats {
  /** 脱敏总次数 */
  totalRedacted: number;
  /** 最后一批脱敏匹配数 */
  lastMatchCount: number;
}

/**
 * 敏感数据脱敏器
 * 使用 RuntimeRedactEngine 提供更高层的脱敏接口
 */
export class SensitiveDataRedactor {
  private engine: RuntimeRedactEngine;
  private matchCount: number = 0;
  private totalRedacted: number = 0;

  /**
   * 构造函数
   * @param extraPatterns 额外的自定义敏感模式
   */
  constructor(extraPatterns: RegExp[] = []) {
    this.engine = new RuntimeRedactEngine(true, extraPatterns);
  }

  /**
   * 脱敏 API Key（部分遮盖）
   * 保留前6个字符和后4个字符，中间用 * 替代
   * @param value API Key 原文
   * @returns 脱敏后的 API Key
   */
  redactApiKey(value: string): string {
    if (!value) {
      return value;
    }

    this.matchCount = 1;
    this.totalRedacted++;

    return this.engine.redactToken(value);
  }

  /**
   * 脱敏 JWT Token（部分遮盖）
   * JWT 由三部分组成，仅遮盖中间的 payload 部分
   * @param value JWT Token 原文
   * @returns 脱敏后的 JWT Token
   */
  redactJWT(value: string): string {
    if (!value) {
      return value;
    }

    const parts = value.split('.');
    if (parts.length === 3) {
      this.matchCount = 1;
      this.totalRedacted++;

      const header = parts[0];
      const signature = parts[2];
      const maskedPayload = '*'.repeat(Math.min(parts[1].length, 16));

      return `${header}.${maskedPayload}.${signature}`;
    }

    this.matchCount = 1;
    this.totalRedacted++;

    return this.engine.redactToken(value);
  }

  /**
   * 脱敏密码/私钥（完全遮盖）
   * 始终返回 ***
   * @param _value 密码原文
   * @returns 固定的脱敏占位符
   */
  redactPassword(_value: string): string {
    this.matchCount = 1;
    this.totalRedacted++;

    return '***';
  }

  /**
   * 脱敏对象中的敏感字段（递归处理）
   * @param obj 原始对象
   * @returns 脱敏后的对象
   */
  redactObject<T extends Record<string, unknown>>(obj: T): T {
    const result = this.engine.redactObject(obj);
    this.matchCount = result.redactedKeys.length;
    this.totalRedacted += this.matchCount;

    return result.output as T;
  }

  /**
   * 脱敏文本中的敏感内容
   * @param text 原始文本
   * @returns 脱敏后的文本
   */
  redactText(text: string): string {
    const result = this.engine.redactText(text);
    this.matchCount = result.matches.length;
    this.totalRedacted += this.matchCount;

    return result.output;
  }

  /**
   * 获取最后一批脱敏匹配数
   * @returns 最后一批匹配数
   */
  getLastMatchCount(): number {
    return this.matchCount;
  }

  /**
   * 获取脱敏统计信息
   * @returns 脱敏统计
   */
  getStats(): RedactStats {
    return {
      totalRedacted: this.totalRedacted,
      lastMatchCount: this.matchCount,
    };
  }

  /**
   * 重置脱敏统计
   */
  resetStats(): void {
    this.totalRedacted = 0;
    this.matchCount = 0;
  }
}

/**
 * LegacyKeyAdapter — 旧式 UUID Key 兼容适配器
 *
 * Liri 当前使用 randomUUID() 生成会话 ID（见 SessionGateway.ts）。
 * 本适配器在迁移到结构化 SessionKey 期间提供向后兼容：
 * - 旧 UUID 格式被包装为 "legacy:{uuid}" 以统一处理
 * - 提供双向转换能力
 */

import { SessionKey } from './SessionKey';

export const LEGACY_PREFIX = 'legacy';

export class LegacyKeyAdapter {
  static toStructured(uuid: string): string {
    return `${LEGACY_PREFIX}:${uuid}`;
  }

  static isLegacyKey(key: string): boolean {
    return key.startsWith(`${LEGACY_PREFIX}:`) || this.isPlainUuid(key);
  }

  static isPlainUuid(key: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      key
    );
  }

  static toSessionKey(uuid: string): SessionKey | null {
    if (!this.isPlainUuid(uuid)) return null;

    return SessionKey.parse(this.toStructured(uuid)) ?? null;
  }

  static extractUuid(key: string): string {
    if (this.isPlainUuid(key)) return key;
    if (key.startsWith(`${LEGACY_PREFIX}:`)) {
      return key.slice(LEGACY_PREFIX.length + 1);
    }
    return key;
  }

  static createRoutingInfo(key: string): {
    isLegacy: boolean;
    isStructured: boolean;
    originalKey: string;
    normalizedKey: string;
  } {
    const isPlain = this.isPlainUuid(key);
    const isLegacy = key.startsWith(`${LEGACY_PREFIX}:`);

    return {
      isLegacy: isLegacy || isPlain,
      isStructured: !isLegacy && !isPlain,
      originalKey: key,
      normalizedKey: isPlain ? this.toStructured(key) : key,
    };
  }
}

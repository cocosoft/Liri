/**
 * 通道基础契约测试 · 共用夹具（2026-10-31）
 *
 * 各通道的 `config-schema` / `accounts` 形状高度同构（`getDefault*Config` / `validate*Config` /
 * `register*Account` …），逐个手写五组断言会产生大量重复。本夹具只做**与通道无关**的断言，
 * 每通道一个 ~20 行的测试文件（而不是把所有通道塞进一个文件——那样"谁有专属测试"就无法区分，
 * 支持等级台账的判据也会失真）。
 *
 * 覆盖：
 *  ① `CHANNEL_CATALOG` 登记完整（name / exportKey / credentials / isEnabled 可调用且返回布尔）；
 *  ② 默认配置包含全部必填字段；
 *  ③ 空配置的报错覆盖每个必填字段；
 *  ④ 合法最小配置 ⇒ 无错误；
 *  ⑤ 账户注册表的注册 / 列出 / 注销语义。
 */
import { describe, expect, it } from 'bun:test';

import { CHANNEL_CATALOG } from '../../../src/channels/ChannelCatalog';

export interface ChannelBasics {
  /** 通道 type（与 `CHANNEL_CATALOG` 一致） */
  id: string;
  /** 必填字段名（用于断言默认值与报错文本） */
  requiredKeys: readonly string[];
  defaults: () => object;
  validate: (raw: Record<string, unknown>) => string[];
  /** 合法最小配置（`validate` 必须返回空数组） */
  validConfig: Record<string, unknown>;
  accounts: {
    register: (id: string) => void;
    get: (id: string) => unknown;
    list: () => string[];
    remove: (id: string) => boolean;
  };
}

export function describeChannelBasics(b: ChannelBasics): void {
  describe(`${b.id} 通道基础契约`, () => {
    it('在 CHANNEL_CATALOG 登记，且 isEnabled 可调用并返回布尔', () => {
      const entry = CHANNEL_CATALOG.find((c) => c.type === b.id);
      expect(entry).toBeDefined();
      expect(entry!.name.length).toBeGreaterThan(0);
      expect(entry!.exportKey.length).toBeGreaterThan(0);
      expect(entry!.credentials.length).toBeGreaterThan(0);
      expect(typeof entry!.isEnabled(() => undefined)).toBe('boolean');
    });

    it('默认配置包含全部必填字段', () => {
      const config = b.defaults();
      for (const key of b.requiredKeys) {
        expect(config).toHaveProperty(key);
      }
    });

    it('空配置的报错覆盖每个必填字段', () => {
      const text = b.validate({}).join('\n');
      for (const key of b.requiredKeys) {
        expect(text).toContain(key);
      }
    });

    it('合法最小配置 ⇒ 无错误', () => {
      expect(b.validate(b.validConfig)).toHaveLength(0);
    });

    it('账户注册表：注册 / 列出 / 注销', () => {
      const id = `test-${b.id}-account`;
      b.accounts.register(id);
      expect(b.accounts.get(id)).toBeDefined();
      expect(b.accounts.list()).toContain(id);
      expect(b.accounts.remove(id)).toBe(true);
      expect(b.accounts.get(id)).toBeUndefined();
    });
  });
}

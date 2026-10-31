/**
 * Matrix 通道基础测试（2026-10-31，支持等级台账：community → core）
 *
 * 覆盖三块可离线验证的行为：
 *  ① `CHANNEL_CATALOG` 登记完整性（无 env 时关闭）；
 *  ② `validateMatrixConfig` 的必填 / 类型 / 数值区间校验（含边界值）；
 *  ③ `accounts` 注册表的副本语义 / resolve / 注销。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { CHANNEL_CATALOG } from '../../src/channels/ChannelCatalog';
import {
  getDefaultMatrixConfig,
  validateMatrixConfig,
} from '../../src/channels/matrix/config-schema';
import {
  getMatrixAccount,
  listMatrixAccountIds,
  registerMatrixAccount,
  removeMatrixAccount,
  resolveMatrixAccount,
} from '../../src/channels/matrix/accounts';

const VALID = {
  homeserverUrl: 'https://matrix.example.org',
  userId: '@bot:example.org',
  accessToken: 'tok',
};

describe('matrix 通道在 CHANNEL_CATALOG 的登记', () => {
  it('条目存在且带 exportKey / 凭据 / isEnabled', () => {
    const entry = CHANNEL_CATALOG.find((c) => c.type === 'matrix');
    expect(entry).toBeDefined();
    expect(entry!.name.length).toBeGreaterThan(0);
    expect(entry!.exportKey.length).toBeGreaterThan(0);
    expect(entry!.credentials.length).toBeGreaterThan(0);
    expect(typeof entry!.isEnabled).toBe('function');
  });

  it('无环境变量时默认不启用', () => {
    const entry = CHANNEL_CATALOG.find((c) => c.type === 'matrix')!;
    expect(entry.isEnabled(() => undefined)).toBe(false);
  });
});

describe('validateMatrixConfig', () => {
  it('默认配置：三项必填为空、autoJoinRooms=false、syncTimeoutMs=30000', () => {
    const config = getDefaultMatrixConfig();
    expect(config.homeserverUrl).toBe('');
    expect(config.userId).toBe('');
    expect(config.accessToken).toBe('');
    expect(config.autoJoinRooms).toBe(false);
    expect(config.syncTimeoutMs).toBe(30000);
  });

  it('空配置 ⇒ 报出三个必填项', () => {
    const errors = validateMatrixConfig({});
    expect(errors).toHaveLength(3);
    const all = errors.join('\n');
    expect(all).toContain('homeserverUrl');
    expect(all).toContain('userId');
    expect(all).toContain('accessToken');
  });

  it('合法最小配置 ⇒ 无错误', () => {
    expect(validateMatrixConfig(VALID)).toHaveLength(0);
  });

  it('autoJoinRooms 非布尔 ⇒ 报错', () => {
    const errors = validateMatrixConfig({ ...VALID, autoJoinRooms: 'yes' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('autoJoinRooms');
  });

  it('syncTimeoutMs 区间：1000 / 120000 通过，999 / 120001 / 非整数报错', () => {
    expect(
      validateMatrixConfig({ ...VALID, syncTimeoutMs: 1000 })
    ).toHaveLength(0);
    expect(
      validateMatrixConfig({ ...VALID, syncTimeoutMs: 120000 })
    ).toHaveLength(0);
    expect(validateMatrixConfig({ ...VALID, syncTimeoutMs: 999 })).toHaveLength(
      1
    );
    expect(
      validateMatrixConfig({ ...VALID, syncTimeoutMs: 120001 })
    ).toHaveLength(1);
    expect(
      validateMatrixConfig({ ...VALID, syncTimeoutMs: 30000.5 })
    ).toHaveLength(1);
  });
});

describe('matrix 账户注册表', () => {
  const id = 'test-matrix-account';
  const account = {
    userId: '@bot:example.org',
    accessToken: 'tok',
    homeserverUrl: 'https://matrix.example.org',
  };

  afterEach(() => {
    removeMatrixAccount(id);
  });

  it('register 对入参做浅拷贝（外部改入参不影响存储）', () => {
    const input = { ...account };
    registerMatrixAccount(id, input);
    input.accessToken = 'tampered';
    expect(getMatrixAccount(id)!.accessToken).toBe('tok');
  });

  it('resolve 带上 resolved=true；未注册返回 null', () => {
    registerMatrixAccount(id, account);
    expect(resolveMatrixAccount(id)!.resolved).toBe(true);
    expect(resolveMatrixAccount('missing')).toBeNull();
  });

  it('list 含已注册 id；remove 后不再可见', () => {
    registerMatrixAccount(id, account);
    expect(listMatrixAccountIds()).toContain(id);
    expect(removeMatrixAccount(id)).toBe(true);
    expect(getMatrixAccount(id)).toBeUndefined();
  });
});

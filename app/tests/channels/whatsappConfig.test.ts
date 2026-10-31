/**
 * WhatsApp 通道基础测试（2026-10-31，支持等级台账：community → core）
 *
 * 覆盖三块可离线验证的行为：
 *  ① `CHANNEL_CATALOG` 登记完整性（type / name / exportKey / 凭据 / isEnabled 无 env 时关闭）；
 *  ② `validateWhatsAppConfig` 的必填校验与类型校验；
 *  ③ `accounts` 注册表的副本语义 / resolve / 注销。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { CHANNEL_CATALOG } from '../../src/channels/ChannelCatalog';
import {
  getDefaultWhatsAppConfig,
  validateWhatsAppConfig,
} from '../../src/channels/whatsapp/config-schema';
import {
  getWhatsAppAccount,
  listWhatsAppAccountIds,
  registerWhatsAppAccount,
  removeWhatsAppAccount,
  resolveWhatsAppAccount,
} from '../../src/channels/whatsapp/accounts';

describe('whatsapp 通道在 CHANNEL_CATALOG 的登记', () => {
  it('条目存在且带 exportKey / 凭据 / isEnabled', () => {
    const entry = CHANNEL_CATALOG.find((c) => c.type === 'whatsapp');
    expect(entry).toBeDefined();
    expect(entry!.name.length).toBeGreaterThan(0);
    expect(entry!.exportKey.length).toBeGreaterThan(0);
    expect(entry!.credentials.length).toBeGreaterThan(0);
    expect(typeof entry!.isEnabled).toBe('function');
  });

  it('无环境变量时默认不启用（不占用通道配额）', () => {
    const entry = CHANNEL_CATALOG.find((c) => c.type === 'whatsapp')!;
    expect(entry.isEnabled(() => undefined)).toBe(false);
  });
});

describe('validateWhatsAppConfig', () => {
  it('默认配置：关闭、apiVersion 有默认值、必填字段为空', () => {
    const config = getDefaultWhatsAppConfig();
    expect(config.enabled).toBe(false);
    expect(config.apiVersion).toBe('v21.0');
    expect(config.phoneNumberId).toBe('');
    expect(config.accessToken).toBe('');
  });

  it('空配置 ⇒ 报出两个必填项', () => {
    const errors = validateWhatsAppConfig({});
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toContain('phoneNumberId');
    expect(errors.join('\n')).toContain('accessToken');
  });

  it('非字符串值同罪（避免数字/对象混入）', () => {
    const errors = validateWhatsAppConfig({
      phoneNumberId: 123,
      accessToken: {},
    });
    expect(errors).toHaveLength(2);
  });

  it('合法配置 ⇒ 无错误', () => {
    expect(
      validateWhatsAppConfig({ phoneNumberId: 'pn_1', accessToken: 'tok' })
    ).toHaveLength(0);
  });
});

describe('whatsapp 账户注册表', () => {
  const id = 'test-whatsapp-account';

  afterEach(() => {
    removeWhatsAppAccount(id);
  });

  it('register 对入参做浅拷贝（外部改入参不影响存储）', () => {
    const input = {
      phoneNumberId: 'pn_1',
      accessToken: 'tok',
      webhookVerifyToken: 'vs',
      apiVersion: 'v21.0',
    };
    registerWhatsAppAccount(id, input);
    input.accessToken = 'tampered';
    expect(getWhatsAppAccount(id)!.accessToken).toBe('tok');
  });

  it('resolve 带上 resolved=true；未注册返回 null', () => {
    registerWhatsAppAccount(id, {
      phoneNumberId: 'pn_1',
      accessToken: 'tok',
      webhookVerifyToken: 'vs',
      apiVersion: 'v21.0',
    });
    expect(resolveWhatsAppAccount(id)!.resolved).toBe(true);
    expect(resolveWhatsAppAccount('missing')).toBeNull();
  });

  it('list 含已注册 id；remove 后不再可见', () => {
    registerWhatsAppAccount(id, {
      phoneNumberId: 'pn_1',
      accessToken: 'tok',
      webhookVerifyToken: 'vs',
      apiVersion: 'v21.0',
    });
    expect(listWhatsAppAccountIds()).toContain(id);
    expect(removeWhatsAppAccount(id)).toBe(true);
    expect(getWhatsAppAccount(id)).toBeUndefined();
    expect(removeWhatsAppAccount(id)).toBe(false);
  });
});

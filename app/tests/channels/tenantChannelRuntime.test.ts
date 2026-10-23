/**
 * 多租户 P3：租户通道运行时托管的纯逻辑
 *
 * 锁三件事：
 *  ① `buildTenantEntries`：只挑「有归属 + 已启用 + 有凭据」的配置，实例键 `<owner>::<type>`；
 *     单个配置实例化失败只记错误、不影响其余；
 *  ② `wrapHandlerWithOwnerScope`：本地（principal=null）原样返回；租户 ⇒ **每次调用**重入归属作用域
 *     （ALS 绑定调用时刻，注册时包一层无效）；
 *  ③ 两个租户同名通道互不影响（各自的 handler 看到自己的身份）。
 */
import { describe, expect, it } from 'bun:test';

import {
  buildTenantEntries,
  wrapHandlerWithOwnerScope,
} from '../../src/channels/setupChannels';
import type {
  IChannelPlugin,
  MessageContext,
} from '../../src/channels/types/IChannel';
import type { Principal } from '@modules/core/identity/principal';
import {
  getRequestPrincipal,
  isLocalPrincipal,
} from '@modules/core/identity/requestScope';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const fakePlugin = { id: 'telegram' } as unknown as IChannelPlugin;

describe('buildTenantEntries（P3）', () => {
  it('只挑有归属 + 启用 + 有凭据的配置，实例键 <owner>::<type>', async () => {
    const errors: string[] = [];
    const entries = await buildTenantEntries(
      [
        {
          type: 'telegram',
          enabled: true,
          options: { botToken: 'enc:x' },
          ownerKey: 'acme:alice',
        },
        {
          type: 'telegram',
          enabled: true,
          options: { botToken: 'enc:y' },
          ownerKey: 'acme:bob',
        },
        // 部署级配置（无归属）⇒ 不归本函数管
        { type: 'discord', enabled: true, options: { botToken: 'enc:z' } },
        // 租户但禁用
        {
          type: 'discord',
          enabled: false,
          options: { botToken: 'enc:z' },
          ownerKey: 'acme:alice',
        },
        // 租户但无凭据（空壳）⇒ 不连接
        { type: 'slack', enabled: true, options: {}, ownerKey: 'acme:alice' },
      ],
      async () => fakePlugin,
      errors
    );

    expect(entries.map((e) => e.name)).toEqual([
      'acme:alice::telegram',
      'acme:bob::telegram',
    ]);
    expect(entries.map((e) => e.ownerKey)).toEqual(['acme:alice', 'acme:bob']);
    expect(entries[0].plugin).toBe(fakePlugin);
    expect(errors).toEqual([]);
  });

  it('单个配置实例化失败 ⇒ 记错误，其余照常', async () => {
    const errors: string[] = [];
    const entries = await buildTenantEntries(
      [
        {
          type: 'telegram',
          enabled: true,
          options: { botToken: 'enc:x' },
          ownerKey: 'acme:alice',
        },
        {
          type: 'discord',
          enabled: true,
          options: { botToken: 'enc:y' },
          ownerKey: 'acme:alice',
        },
      ],
      async (type) => {
        if (type === 'discord') throw new Error('factory exploded');
        return fakePlugin;
      },
      errors
    );

    expect(entries.map((e) => e.name)).toEqual(['acme:alice::telegram']);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('acme:alice::discord');
    expect(errors[0]).toContain('factory exploded');
  });

  it('工厂返回空 ⇒ 记错误且不产生实例', async () => {
    const errors: string[] = [];
    const entries = await buildTenantEntries(
      [
        {
          type: 'telegram',
          enabled: true,
          options: { botToken: 'enc:x' },
          ownerKey: 'acme:alice',
        },
      ],
      async () => undefined,
      errors
    );

    expect(entries).toEqual([]);
    expect(errors[0]).toContain('工厂返回空');
  });
});

describe('wrapHandlerWithOwnerScope（P3）', () => {
  it('本地（principal=null）⇒ 原样返回，不改变既有行为', () => {
    const handler = async () => {};
    expect(wrapHandlerWithOwnerScope(handler, null)).toBe(handler);
  });

  it('租户 ⇒ 每次调用重入归属作用域（调用点本身无作用域）', async () => {
    const seen: string[] = [];
    const handler = async () => {
      const principal = getRequestPrincipal();
      seen.push(`${principal.tenantId}:${principal.userId}`);
    };

    const aliceHandler = wrapHandlerWithOwnerScope(handler, ALICE);
    const bobHandler = wrapHandlerWithOwnerScope(handler, BOB);

    // 模拟渠道异步链：调用点不在任何请求作用域内
    expect(isLocalPrincipal()).toBe(true);
    await aliceHandler({} as MessageContext);
    await bobHandler({} as MessageContext);
    expect(isLocalPrincipal()).toBe(true);

    expect(seen).toEqual(['acme:alice', 'acme:bob']);
  });
});

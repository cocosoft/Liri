/**
 * #21（2026-10-30）：渠道三层对账 —— 列表回显与开关错误可读性。
 *
 * 真机背景（`dev_docs/20261030/Liri-项目-会话-渠道一致性核查-20261030.md` §2.3）：
 * `channel_configs` 有 3 条 `enabled=1`（qq / feishu / dingtalk），UI 却显示
 * 「已启用 0 / 已连接 0 / 27 未注册」；点开关注册通道时既无报错也不生效。
 *
 * 本用例只测**纯函数**（不做模块 mock）：回显口径与错误映射。
 */
import { describe, expect, it } from 'bun:test';

import {
  buildUnregisteredChannelEntry,
  describeChannelToggleFailure,
} from '../../src/infrastructure/http/handlers/channel-handlers';

describe('#21 列表回显：未注册渠道也按 DB 配置说话', () => {
  const def = { type: 'qq', name: 'QQ' };

  it('DB enabled=1 且未注册 ⇒ enabled:true（不再被丢弃）', () => {
    const entry = buildUnregisteredChannelEntry({
      def,
      config: { enabled: true, options: { appId: 'x' } },
      display: { config: { appId: 'x' }, unreadableFields: [] },
      droppedByBuild: false,
    });
    expect(entry.enabled).toBe(true);
    expect(entry.connected).toBe(false);
    expect(entry.registered).toBe(false);
    expect(entry.unregisteredReason).toBe('not_registered');
    // 凭据回显走解密视图（不回显密文）
    expect(entry.config).toEqual({ appId: 'x' });
  });

  it('无 DB 配置 ⇒ enabled:false（不臆造启用）', () => {
    const entry = buildUnregisteredChannelEntry({
      def,
      droppedByBuild: false,
    });
    expect(entry.enabled).toBe(false);
    expect(entry.unregisteredReason).toBe('not_registered');
    expect(entry.config).toEqual({});
    expect(entry.unreadableCredentialFields).toEqual([]);
  });

  it('构建裁剪 ⇒ unregisteredReason=dropped_by_build', () => {
    const entry = buildUnregisteredChannelEntry({
      def,
      config: { enabled: true },
      droppedByBuild: true,
    });
    expect(entry.unregisteredReason).toBe('dropped_by_build');
    // 即便被裁剪，DB 的 enabled 也如实回显（由 UI 决定如何解释）
    expect(entry.enabled).toBe(true);
  });
});

describe('#21 开关失败：未注册必须给可读错误（ENOT_REGISTERED）', () => {
  it('已知但本实例未注册 ⇒ 409 / ENOT_REGISTERED（提示先启用并重启）', () => {
    const failure = describeChannelToggleFailure('qq', {
      droppedByBuild: false,
      known: true,
    });
    expect(failure.status).toBe(409);
    expect(failure.code).toBe('ENOT_REGISTERED');
    expect(failure.message).toContain('未在本实例注册');
    expect(failure.message).toContain('重启');
  });

  it('构建裁剪 ⇒ 404 / CHANNEL_DROPPED_BY_BUILD', () => {
    const failure = describeChannelToggleFailure('wecom', {
      droppedByBuild: true,
      known: false,
    });
    expect(failure.status).toBe(404);
    expect(failure.code).toBe('CHANNEL_DROPPED_BY_BUILD');
  });

  it('完全未知 ⇒ 404 / CHANNEL_UNKNOWN', () => {
    const failure = describeChannelToggleFailure('nope', {
      droppedByBuild: false,
      known: false,
    });
    expect(failure.status).toBe(404);
    expect(failure.code).toBe('CHANNEL_UNKNOWN');
  });
});

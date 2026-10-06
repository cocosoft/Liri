/**
 * N-81：ACP 远程暴露的 fail-closed 判据单测。
 *
 * 裁定（2026-10-06，用户）：**非回环监听地址 + 未配置 `ACP_REMOTE_AUTH_TOKEN` ⇒ 拒绝启动**。
 * 背景：ACP 的 `authToken` 是"本机信任基线"下的**可选**项，该基线的前提是只监听回环；
 * 一旦经 `ACP_REMOTE_HOST` 放到非回环地址，免认证即等同无鉴权暴露。
 *
 * 覆盖边界：回环（含 `127.0.0.0/8` 全段、`::1`、`localhost`、方括号/空白归一）·
 * 非回环（`0.0.0.0`、`::`、私网段、域名）· 空白 token 不算已配置。
 */
import { describe, expect, it } from 'bun:test';
import { resolveAcpRemoteRefusalReason } from '../../src/bridge/ModuleBridgeSetup';

describe('N-81 ACP 远程暴露 fail-closed 判据', () => {
  it('回环地址 + 无 token ⇒ 允许（本机信任基线）', () => {
    const loopbackHosts = [
      '127.0.0.1',
      '127.1.2.3',
      'localhost',
      'LOCALHOST',
      '::1',
      '[::1]',
      ' 127.0.0.1 ',
    ];
    for (const host of loopbackHosts) {
      expect(resolveAcpRemoteRefusalReason({ host })).toBeNull();
    }
  });

  it('未指定 / 空白 host ⇒ 允许（由 AcpWebSocketServer 兜底为回环，不构成暴露）', () => {
    expect(resolveAcpRemoteRefusalReason({})).toBeNull();
    expect(resolveAcpRemoteRefusalReason({ host: undefined })).toBeNull();
    expect(resolveAcpRemoteRefusalReason({ host: '' })).toBeNull();
    expect(resolveAcpRemoteRefusalReason({ host: '   ' })).toBeNull();
  });

  it('非回环地址 + 无 token ⇒ 拒绝，且原因含该地址', () => {
    const publicHosts = [
      '0.0.0.0',
      '::',
      '192.168.1.10',
      '10.0.0.5',
      'example.com',
      'acp.internal',
    ];
    for (const host of publicHosts) {
      const reason = resolveAcpRemoteRefusalReason({ host });
      expect(reason).not.toBeNull();
      expect(String(reason)).toContain(host);
    }
  });

  it('非回环地址 + 有 token ⇒ 允许', () => {
    expect(
      resolveAcpRemoteRefusalReason({ host: '0.0.0.0', authToken: 'k' })
    ).toBeNull();
    expect(
      resolveAcpRemoteRefusalReason({ host: '192.168.1.10', authToken: 'k' })
    ).toBeNull();
  });

  it('非回环 + 空白/空 token ⇒ 仍拒绝（空白不算已配置）', () => {
    expect(
      resolveAcpRemoteRefusalReason({ host: '0.0.0.0', authToken: '   ' })
    ).not.toBeNull();
    expect(
      resolveAcpRemoteRefusalReason({ host: '0.0.0.0', authToken: '' })
    ).not.toBeNull();
  });
});

/**
 * 移动端设备配对与短期 token（P2.5，2026-10-20）
 *
 * 锁住四件事：
 *   ① 配对码 → 短期 token（6 位码 / 一次配对一台设备）；
 *   ② token 是后续入站的**唯一**设备凭据（缺省 401、串号 403、过期 401）；
 *   ③ 重新配对**先吊销旧 token**（单设备单活跃 token）；
 *   ④ 解配 / 过期后 token 立即失效（不伪成功）。
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  authorizeMobileRequest,
  completeMobilePairing,
  listPairedMobileDevices,
  mobileDeviceTokenStore,
  MobileDeviceTokenStore,
  MOBILE_DEVICE_TOKEN_TTL_MS,
  resetMobilePairingForTest,
  startMobilePairing,
  unpairMobileDevice,
} from '../../src/channels/mobile/MobilePairingService';

afterEach(() => {
  resetMobilePairingForTest();
});

describe('MobilePairingService：配对与 token', () => {
  it('出码：6 位数字', () => {
    const { code } = startMobilePairing('desktop');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('错误配对码 ⇒ 失败（不签发 token）', () => {
    startMobilePairing('desktop');
    const result = completeMobilePairing({
      code: '000000',
      deviceId: 'dev-1',
      deviceName: 'iPhone',
    });
    expect(result.ok).toBe(false);
    expect(mobileDeviceTokenStore.size()).toBe(0);
  });

  it('正确配对码 ⇒ 签发 token；该 token 可通过入站鉴权', () => {
    const { code } = startMobilePairing('desktop');
    const result = completeMobilePairing({
      code,
      deviceId: 'dev-1',
      deviceName: 'iPhone',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deviceId).toBe('dev-1');
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    const auth = authorizeMobileRequest(`Bearer ${result.token}`, 'dev-1');
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    expect(auth.deviceId).toBe('dev-1');
  });

  it('请求体 deviceId 与 token 不一致 ⇒ 403（防串号）', () => {
    const { code } = startMobilePairing('desktop');
    const result = completeMobilePairing({
      code,
      deviceId: 'dev-1',
      deviceName: 'iPhone',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const auth = authorizeMobileRequest(`Bearer ${result.token}`, 'dev-2');
    expect(auth).toMatchObject({ ok: false, status: 403 });
  });

  it('缺 / 无效 Authorization ⇒ 401', () => {
    expect(authorizeMobileRequest(undefined)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(authorizeMobileRequest('Bearer nope')).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(authorizeMobileRequest('Basic abc')).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('重新配对 ⇒ 旧 token 立即吊销（单设备单活跃 token）', () => {
    const first = completeMobilePairing({
      code: startMobilePairing('desktop').code,
      deviceId: 'dev-1',
      deviceName: 'iPhone',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = completeMobilePairing({
      code: startMobilePairing('desktop').code,
      deviceId: 'dev-1',
      deviceName: 'iPhone',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(mobileDeviceTokenStore.size()).toBe(1);
    expect(authorizeMobileRequest(`Bearer ${first.token}`).ok).toBe(false);
    expect(authorizeMobileRequest(`Bearer ${second.token}`).ok).toBe(true);
  });

  it('解配 ⇒ token 失效且设备移出配对列表', () => {
    const result = completeMobilePairing({
      code: startMobilePairing('desktop').code,
      deviceId: 'dev-1',
      deviceName: 'iPhone',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(listPairedMobileDevices()).toEqual([
      expect.objectContaining({ deviceId: 'dev-1', hasActiveToken: true }),
    ]);

    expect(unpairMobileDevice('dev-1')).toBe(true);
    expect(authorizeMobileRequest(`Bearer ${result.token}`).ok).toBe(false);
    expect(listPairedMobileDevices()).toEqual([]);
  });

  it('过期 token ⇒ 校验失败（不返回过期记录）', async () => {
    const store = new MobileDeviceTokenStore();

    // ① 未过期：TTL 必须给足。原先用 1ms 在同一句里断言"仍有效"，
    //    issue→verify 之间在慢 runner 上就可能跨过 1ms ⇒ 2026-10-24 macOS CI 假红。
    const live = store.issue('dev-live', 'u1', 60_000);
    expect(store.verify(live.token)).not.toBeNull();

    // ② 已过期：TTL 1ms 后等待，再断言被清理
    const record = store.issue('dev-x', 'u1', 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(store.verify(record.token)).toBeNull();
    expect(store.hasActiveToken('dev-x')).toBe(false);
  });

  it('默认 TTL 为 12 小时（短期可吊销口径）', () => {
    expect(MOBILE_DEVICE_TOKEN_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });
});

/**
 * 动态端口（2026-10-20 分发前置）—— 端口解析 + 占用顺延
 *
 * 钉三件事：
 *  ① **解析口径**：`--http-port`（两种写法）> `LIRI_HTTP_PORT` > 默认 18990；
 *  ② **顺延条件**：仅"未显式指定端口"才顺延；显式指定 ⇒ 原样抛错（桌面壳靠它连对端口）；
 *  ③ **不掩盖真实故障**：非 `EADDRINUSE`（如 EACCES）立即抛出，不做无意义重试。
 */
import { describe, it, expect } from 'bun:test';

import {
  DEFAULT_HTTP_PORT,
  HTTP_PORT_SHIFT_ATTEMPTS,
  parseHttpPortFromArgs,
  resolveExplicitHttpPort,
  resolveHttpPort,
  resolveHttpPortIntent,
} from '@openliri/kernel/ports';
import {
  isAddressInUseError,
  startWithPortFallback,
} from '@openliri/kernel/httpPortFallback';

function addrInUse(port: number): NodeJS.ErrnoException {
  const err = new Error(`listen EADDRINUSE: ${port}`) as NodeJS.ErrnoException;
  err.code = 'EADDRINUSE';
  return err;
}

describe('端口解析（core/ports）', () => {
  it('默认端口与顺延次数是稳定常量', () => {
    expect(DEFAULT_HTTP_PORT).toBe(18990);
    expect(HTTP_PORT_SHIFT_ATTEMPTS).toBeGreaterThan(1);
  });

  it('--http-port 支持空格与等号两种写法', () => {
    expect(parseHttpPortFromArgs(['--http-port', '19001'])).toBe(19001);
    expect(parseHttpPortFromArgs(['--http-port=19002'])).toBe(19002);
  });

  it('--http-port 非法 / 缺失 ⇒ undefined（视为"未指定"，允许顺延）', () => {
    expect(parseHttpPortFromArgs(undefined)).toBeUndefined();
    expect(parseHttpPortFromArgs([])).toBeUndefined();
    expect(parseHttpPortFromArgs(['--http-port', 'abc'])).toBeUndefined();
    expect(parseHttpPortFromArgs(['--http-port', '0'])).toBeUndefined();
    expect(parseHttpPortFromArgs(['--http-port', '70000'])).toBeUndefined();
    expect(parseHttpPortFromArgs(['--http-port='])).toBeUndefined();
  });

  it('env 显式端口 / 缺省 / 非法 三态', () => {
    expect(resolveExplicitHttpPort({ LIRI_HTTP_PORT: '3000' })).toBe(3000);
    expect(resolveExplicitHttpPort({})).toBeUndefined();
    expect(resolveExplicitHttpPort({ LIRI_HTTP_PORT: 'nope' })).toBeUndefined();
    expect(resolveExplicitHttpPort({ LIRI_HTTP_PORT: '-1' })).toBeUndefined();
  });

  it('resolveHttpPort：env 优先，否则默认端口', () => {
    expect(resolveHttpPort({ LIRI_HTTP_PORT: '3000' })).toBe(3000);
    expect(resolveHttpPort({})).toBe(DEFAULT_HTTP_PORT);
  });
});

describe('端口意图（resolveHttpPortIntent）：谁有权禁止顺延', () => {
  it('CLI --http-port ⇒ 显式，禁止顺延（桌面壳按该端口连接）', () => {
    expect(resolveHttpPortIntent(['--http-port', '19001'], {})).toEqual({
      port: 19001,
      allowShift: false,
    });
  });

  it('env 指定**非默认**端口（Docker 3000）⇒ 显式，禁止顺延', () => {
    expect(resolveHttpPortIntent([], { LIRI_HTTP_PORT: '3000' })).toEqual({
      port: 3000,
      allowShift: false,
    });
  });

  it('env 等于默认端口（自动生成的 .env 常见形态）⇒ 视为未指定，允许顺延', () => {
    expect(
      resolveHttpPortIntent([], { LIRI_HTTP_PORT: String(DEFAULT_HTTP_PORT) })
    ).toEqual({ port: DEFAULT_HTTP_PORT, allowShift: true });
  });

  it('两者都缺省 ⇒ 默认端口 + 允许顺延', () => {
    expect(resolveHttpPortIntent(undefined, {})).toEqual({
      port: DEFAULT_HTTP_PORT,
      allowShift: true,
    });
  });

  it('CLI 优先于 env（即使 env 是非默认端口）', () => {
    expect(
      resolveHttpPortIntent(['--http-port=19002'], { LIRI_HTTP_PORT: '3000' })
    ).toEqual({ port: 19002, allowShift: false });
  });

  it('CLI 取值非法 ⇒ 回落到 env 判定（不因坏参数误判为显式）', () => {
    expect(
      resolveHttpPortIntent(['--http-port', 'abc'], {
        LIRI_HTTP_PORT: String(DEFAULT_HTTP_PORT),
      })
    ).toEqual({ port: DEFAULT_HTTP_PORT, allowShift: true });
  });
});

describe('端口顺延（core/httpPortFallback）', () => {
  it('EADDRINUSE 识别：仅 code=EADDRINUSE 为真', () => {
    expect(isAddressInUseError(addrInUse(18990))).toBe(true);
    expect(isAddressInUseError(new Error('boom'))).toBe(false);
    expect(isAddressInUseError({ code: 'EACCES' })).toBe(false);
    expect(isAddressInUseError(null)).toBe(false);
    expect(isAddressInUseError('EADDRINUSE')).toBe(false);
  });

  it('允许顺延：跳过被占用端口，返回实际端口并标记 shifted', async () => {
    const occupied = new Set([18990, 18991]);
    const tried: number[] = [];
    const result = await startWithPortFallback({
      port: 18990,
      allowShift: true,
      maxAttempts: 5,
      start: async (port) => {
        tried.push(port);
        if (occupied.has(port)) throw addrInUse(port);
        return `service@${port}`;
      },
    });

    expect(result.port).toBe(18992);
    expect(result.shifted).toBe(true);
    expect(result.value).toBe('service@18992');
    expect(tried).toEqual([18990, 18991, 18992]);
  });

  it('首选端口可用 ⇒ 不顺延、shifted=false', async () => {
    const result = await startWithPortFallback({
      port: 18990,
      allowShift: true,
      maxAttempts: 5,
      start: async (port) => port,
    });

    expect(result).toEqual({ value: 18990, port: 18990, shifted: false });
  });

  it('显式指定端口（禁止顺延）⇒ 只尝试一次并原样抛出 EADDRINUSE', async () => {
    const tried: number[] = [];
    await expect(
      startWithPortFallback({
        port: 18990,
        allowShift: false,
        maxAttempts: 20,
        start: async (port) => {
          tried.push(port);
          throw addrInUse(port);
        },
      })
    ).rejects.toThrow(/EADDRINUSE/);
    expect(tried).toEqual([18990]);
  });

  it('非 EADDRINUSE 立即抛出，不消耗重试次数（不掩盖真实故障）', async () => {
    const tried: number[] = [];
    const eacces = new Error('listen EACCES') as NodeJS.ErrnoException;
    eacces.code = 'EACCES';

    await expect(
      startWithPortFallback({
        port: 18990,
        allowShift: true,
        maxAttempts: 20,
        start: async (port) => {
          tried.push(port);
          throw eacces;
        },
      })
    ).rejects.toThrow(/EACCES/);
    expect(tried).toEqual([18990]);
  });

  it('全部尝试都被占用 ⇒ 抛出最后一次的 EADDRINUSE（不静默返回）', async () => {
    const tried: number[] = [];
    await expect(
      startWithPortFallback({
        port: 18990,
        allowShift: true,
        maxAttempts: 3,
        start: async (port) => {
          tried.push(port);
          throw addrInUse(port);
        },
      })
    ).rejects.toThrow(/EADDRINUSE: 18992/);
    expect(tried).toEqual([18990, 18991, 18992]);
  });
});

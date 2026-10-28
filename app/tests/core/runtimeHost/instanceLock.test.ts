/**
 * 单实例锁（2026-10-20 分发前置）—— 锁文件格式与端口发布
 *
 * 关键约束（钉死，防回归）：
 *  ① **兼容 legacy**：旧版本写的是裸 PID 文本 ⇒ 仍须能读出 pid（否则升级后
 *     首次启动会误判"锁内容异常"）；
 *  ② **端口可发现**：HTTP 绑定成功后 `publishInstanceEndpoint` 把**实际端口**写进锁，
 *     这是动态端口对客户端（桌面壳 / 移动端接入）的唯一发现面；
 *  ③ **不越权写**：锁被其他 PID 持有时，不得把别人的端点改掉；
 *  ④ **只删自己的锁**：退出清理不能误删其他实例的锁。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getInstanceLockPath,
  parseInstanceLock,
  publishInstanceEndpoint,
  readInstanceLock,
  releaseInstanceLock,
  writeInstanceLock,
  INSTANCE_LOCK_FILE_NAME,
} from '@modules/runtimeHost';

let tempDataDir = '';
let originalDataDir: string | undefined;

beforeEach(() => {
  originalDataDir = process.env.LIRI_DATA_DIR;
  tempDataDir = mkdtempSync(join(tmpdir(), 'liri-instance-lock-'));
  process.env.LIRI_DATA_DIR = tempDataDir;
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = originalDataDir;
  rmSync(tempDataDir, { recursive: true, force: true });
});

describe('锁文件解析（parseInstanceLock）', () => {
  it('legacy 裸 PID 文本仍可解析（升级兼容）', () => {
    expect(parseInstanceLock('4242')).toEqual({ pid: 4242 });
    expect(parseInstanceLock('  4242\n')).toEqual({ pid: 4242 });
  });

  it('v1 JSON：带端点时读出 port / host / startedAt', () => {
    const raw = JSON.stringify({
      v: 1,
      pid: 4242,
      startedAt: '2026-10-20T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18991,
    });
    expect(parseInstanceLock(raw)).toEqual({
      pid: 4242,
      port: 18991,
      host: '127.0.0.1',
      startedAt: '2026-10-20T00:00:00.000Z',
    });
  });

  it('v1 JSON：端口尚未发布时允许缺省', () => {
    const raw = JSON.stringify({ v: 1, pid: 4242 });
    expect(parseInstanceLock(raw)).toEqual({
      pid: 4242,
      port: undefined,
      host: undefined,
      startedAt: undefined,
    });
  });

  it('空内容 / 非法 JSON / 非法 pid ⇒ null（按"锁异常，覆盖并继续"处理）', () => {
    expect(parseInstanceLock('')).toBeNull();
    expect(parseInstanceLock('   ')).toBeNull();
    expect(parseInstanceLock('{oops')).toBeNull();
    expect(parseInstanceLock('{"v":1}')).toBeNull();
    expect(parseInstanceLock('{"v":1,"pid":0}')).toBeNull();
    expect(parseInstanceLock('{"v":1,"pid":-3}')).toBeNull();
    expect(parseInstanceLock('not-a-pid')).toBeNull();
  });
});

describe('锁文件读写与端口发布', () => {
  it('锁文件落在数据目录下的固定文件名', () => {
    expect(getInstanceLockPath()).toBe(
      join(tempDataDir, INSTANCE_LOCK_FILE_NAME)
    );
  });

  it('write → read 往返：写入 pid 时保留 v1 格式且端口缺省', () => {
    writeInstanceLock({ pid: 4242 });

    const raw = readFileSync(getInstanceLockPath(), 'utf-8');
    expect(JSON.parse(raw)).toMatchObject({ v: 1, pid: 4242 });
    expect(readInstanceLock()).toMatchObject({ pid: 4242, port: undefined });
  });

  it('publishInstanceEndpoint：动态端口写进锁，且保留 startedAt', () => {
    writeInstanceLock({
      pid: process.pid,
      startedAt: '2026-10-20T01:02:03.000Z',
    });

    publishInstanceEndpoint(19001, '127.0.0.1');

    const lock = readInstanceLock();
    expect(lock).toMatchObject({
      pid: process.pid,
      port: 19001,
      host: '127.0.0.1',
      startedAt: '2026-10-20T01:02:03.000Z',
    });
  });

  it('publishInstanceEndpoint：锁被其他 PID 持有时不覆盖（不越权改端点）', () => {
    writeInstanceLock({ pid: 999999, port: 18990, host: '127.0.0.1' });

    publishInstanceEndpoint(19002, '127.0.0.1');

    expect(readInstanceLock()).toMatchObject({
      pid: 999999,
      port: 18990,
    });
  });

  it('releaseInstanceLock：只删自己的锁', () => {
    writeInstanceLock({ pid: process.pid, port: 18990 });
    releaseInstanceLock();
    expect(existsSync(getInstanceLockPath())).toBe(false);

    writeInstanceLock({ pid: 999999, port: 18990 });
    releaseInstanceLock();
    expect(existsSync(getInstanceLockPath())).toBe(true);
  });

  it('readInstanceLock：文件不存在 / 内容损坏 ⇒ null（不抛）', () => {
    expect(readInstanceLock()).toBeNull();

    writeFileSync(getInstanceLockPath(), '{broken', 'utf-8');
    expect(readInstanceLock()).toBeNull();
  });
});

/**
 * G-10 P4：主动消息运行时接线契约。
 *
 * 覆盖：默认关（不建表、不启动扫描器）、开启后建表与幂等启动、停止后再启动。
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startProactiveRuntime,
  stopProactiveRuntime,
} from '../../src/proactive/ProactiveRuntime';

const dirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-proactive-runtime-'));
  dirs.push(dir);
  return join(dir, 'queue.db');
}

afterEach(async () => {
  await stopProactiveRuntime();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('ProactiveRuntime：默认关', () => {
  test('enabled=false ⇒ 不建库、不启动扫描器', async () => {
    const dbPath = tempDbPath();
    expect(await startProactiveRuntime({ enabled: false, dbPath })).toBe(false);
    expect(existsSync(dbPath)).toBe(false);
  });

  test('未启动时 stop 为空操作', async () => {
    await stopProactiveRuntime();
  });
});

describe('ProactiveRuntime：开启接线', () => {
  test('enabled=true ⇒ 建表；重复启动幂等', async () => {
    const dbPath = tempDbPath();
    expect(await startProactiveRuntime({ enabled: true, dbPath })).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
    expect(await startProactiveRuntime({ enabled: true, dbPath })).toBe(true);
  });

  test('停止后释放 DB，可再次启动', async () => {
    const dbPath = tempDbPath();
    expect(await startProactiveRuntime({ enabled: true, dbPath })).toBe(true);
    await stopProactiveRuntime();
    expect(await startProactiveRuntime({ enabled: true, dbPath })).toBe(true);
  });
});

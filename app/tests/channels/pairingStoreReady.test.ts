/**
 * PairingStore 跨实例加载（2026-10-19）。
 *
 * 验证新进程（CLI）在 `ready()` 后可读到磁盘上的 pending 码并成功批准，
 * 不再因“点火即忘”的异步加载而误判无效。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PairingStore } from '../../src/channels/policy/PairingStore';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-pairing-'));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('PairingStore：新进程跨实例', () => {
  test('新实例首次 isApproved 即读盘（旧实现的“点火即忘”会误拒首条消息）', async () => {
    const dir = tempDir();
    const writer = new PairingStore(dir);
    await writer.approve('feishu', 'ou_first');

    const reader = new PairingStore(dir);
    // 不显式 ready()，直接问 —— 必须等待磁盘加载后再判定
    expect(await reader.isApproved('feishu', 'ou_first')).toBe(true);
  });

  test('另一实例 ready() 后可凭磁盘 pending 码批准', async () => {
    const dir = tempDir();
    const writer = new PairingStore(dir);
    const code = await writer.generateCode('feishu', 'ou_cross', 60_000);

    const reader = new PairingStore(dir);
    await reader.ready();

    expect(await reader.approveByCode('feishu', code)).toBe(true);
    expect(await reader.isApproved('feishu', 'ou_cross')).toBe(true);
    expect(reader.listChannels()).toContain('feishu');
  });

  test('已过期的码 ⇒ 批准失败', async () => {
    const dir = tempDir();
    const store = new PairingStore(dir);
    const code = await store.generateCode('feishu', 'ou_expired', -1);
    await store.ready();

    expect(await store.approveByCode('feishu', code)).toBe(false);
  });

  test('未知通道/码 ⇒ 批准失败', async () => {
    const dir = tempDir();
    const store = new PairingStore(dir);
    await store.ready();
    expect(await store.approveByCode('feishu', 'NOPE')).toBe(false);
  });
});

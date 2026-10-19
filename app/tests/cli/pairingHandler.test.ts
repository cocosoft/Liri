/**
 * `Liri pairing` CLI handler（2026-10-19）。
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PairingStore } from '../../src/channels/policy/PairingStore';
import { createPairingHandler } from '../../src/cli/handlers/pairingHandler';

const dirs: string[] = [];
let store: PairingStore;
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'liri-pairing-cli-'));
  dirs.push(dir);
  store = new PairingStore(dir);
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

afterAll(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Liri pairing（CLI handler）', () => {
  test('approve 有效码 ⇒ 返回 true 且写入白名单', async () => {
    const code = await store.generateCode('feishu', 'ou_cli', 60_000);
    const handler = createPairingHandler(store);

    expect(await handler.handle('approve', ['feishu', code])).toBe(true);
    expect(await store.isApproved('feishu', 'ou_cli')).toBe(true);
  });

  test('approve 无效码 ⇒ 返回 false（退出码非零）', async () => {
    const handler = createPairingHandler(store);
    await store.ready();

    expect(await handler.handle('approve', ['feishu', 'BADCODE'])).toBe(false);
  });

  test('approve 缺参数 ⇒ 返回 false', async () => {
    const handler = createPairingHandler(store);
    expect(await handler.handle('approve', ['feishu'])).toBe(false);
  });

  test('list（全部通道）⇒ 返回 true', async () => {
    const code = await store.generateCode('telegram', 'ou_tg', 60_000);
    const handler = createPairingHandler(store);

    expect(await handler.handle('list', [])).toBe(true);
    // pending 码仍可被后续 approve 使用（list 不消费）
    expect(await handler.handle('approve', ['telegram', code])).toBe(true);
  });

  test('未识别子命令 ⇒ 返回 false（由调用方打印帮助）', async () => {
    const handler = createPairingHandler(store);
    expect(await handler.handle('nope', [])).toBe(false);
  });
});

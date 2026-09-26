/**
 * `.trash` 软删除区 **TTL 清理的分区覆盖**（2026-09-26 修根因）。
 *
 * **病根（实测）**：`purgeExpiredTrash()` 只扫 `this.basePath/.trash`，而**读取**跨
 * `[basePath, ...legacyRoots]`（`loadAllSessions`）⇒ **其他分区/旧布局的回收站永不清理**。
 * 后果实测：遗留 **7023 项 / 212.73MB**（顶层旧布局 113.04MB 已 19 天、`default` 分区 2.14MB 已 11–14 天）。
 *
 * 锁定：
 *  ① 单分区语义：超 TTL 删、未超期留（边界用 ±1 天，避开文件系统 mtime 精度抖动）；
 *  ② **跨分区（本根因的回归）**：真实 `FileSystemUnifiedStorage.initialize()` 对 `basePath`
 *     与 `legacyRoots` **两处**的超期项都清理（改回只扫 basePath ⇒ 本用例变红）；
 *  ③ 分区没有 `.trash` ⇒ 返回 0 且不抛错。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import {
  FileSystemUnifiedStorage,
  purgeExpiredTrashUnder,
} from '../../src/session/storage/FileSystemUnifiedStorage';
import type { StorageConfig } from '../../src/session/storage/UnifiedStorage';
import { StorageType } from '../../src/session/storage/UnifiedStorage';

const DAY = 24 * 60 * 60 * 1000;
const TTL = 7 * DAY;

const roots: string[] = [];

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/** 在 `<partition>/.trash/<name>` 造一个条目，并把 mtime 设为 `ageMs` 之前 */
function makeTrashEntry(
  partition: string,
  name: string,
  ageMs: number
): string {
  const dir = join(partition, '.trash', name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'session.json');
  writeFileSync(file, '{}', 'utf-8');
  const when = new Date(Date.now() - ageMs);
  utimesSync(file, when, when);
  utimesSync(dir, when, when);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe('purgeExpiredTrashUnder：单分区语义', () => {
  test('超 TTL 的条目被物理删除、未超期的保留（±1 天边界）', async () => {
    const partition = scratch('trash-one-');
    const expired = makeTrashEntry(partition, 'expired', TTL + DAY);
    const fresh = makeTrashEntry(partition, 'fresh', TTL - DAY);

    const removed = await purgeExpiredTrashUnder(partition, TTL);

    expect(removed).toBe(1);
    expect(existsSync(expired)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  test('分区没有 .trash ⇒ 返回 0 且不抛错', async () => {
    const partition = scratch('trash-none-');
    expect(await purgeExpiredTrashUnder(partition, TTL)).toBe(0);
  });
});

describe('分区覆盖：根因回归（读取跨分区 ⇒ 清理也必须跨分区）', () => {
  test('initialize() 清理 **basePath 与 legacyRoots 两处** 的超期项', async () => {
    const base = scratch('trash-base-');
    const legacy = scratch('trash-legacy-');

    const expiredInBase = makeTrashEntry(base, 'old-base', TTL + 2 * DAY);
    const expiredInLegacy = makeTrashEntry(legacy, 'old-legacy', TTL + 2 * DAY);
    const freshInLegacy = makeTrashEntry(legacy, 'fresh-legacy', TTL - 2 * DAY);

    const config: StorageConfig = {
      type: StorageType.FILESYSTEM,
      basePath: base,
      legacyRoots: [legacy],
    };
    const storage = new FileSystemUnifiedStorage(config);
    await storage.initialize();

    // 两处超期项都必须被清 —— 改回"只扫 basePath"时 `expiredInLegacy` 会残留 ⇒ 本断言变红
    expect(existsSync(expiredInBase)).toBe(false);
    expect(existsSync(expiredInLegacy)).toBe(false);
    // 未超期的仍保留
    expect(existsSync(freshInLegacy)).toBe(true);
  });

  test('initialize() 亦清理**旧布局顶层** `sessions/.trash`（读取已不涉及它，但同属回收站 ⇒ 同按 TTL）', async () => {
    const dataDir = scratch('trash-datadir-');
    const legacyTop = join(dataDir, 'sessions');
    const expired = makeTrashEntry(legacyTop, 'old-top', TTL + 2 * DAY);
    const fresh = makeTrashEntry(legacyTop, 'fresh-top', TTL - 2 * DAY);
    const base = scratch('trash-base3-');

    const prevDataDir = process.env.LIRI_DATA_DIR;
    process.env.LIRI_DATA_DIR = dataDir;
    try {
      const storage = new FileSystemUnifiedStorage({
        type: StorageType.FILESYSTEM,
        basePath: base,
        legacyRoots: [],
      });
      await storage.initialize();
    } finally {
      if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
      else process.env.LIRI_DATA_DIR = prevDataDir;
    }

    // 顶层回收站的超期项被清（这层是 113.04MB 那块的真实归属）
    expect(existsSync(expired)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

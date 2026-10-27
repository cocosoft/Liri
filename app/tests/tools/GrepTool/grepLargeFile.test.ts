/**
 * FIX-1（2026-10-27）：grep 大文件**不得静默跳过**。
 *
 * 真机背景（会话 `session_mvq91mtme1e76c5808`）：`events.jsonl` 6.84 MB 被 `>1MiB return`
 * 静默跳过，而 `stats.files` 已 +1 ⇒ 工具返回 `{matchCount:0, files:1, durationMs:0}`，
 * 模型据此判定"日志里没有失败记录"，改用 PowerShell 反复重查（Select-String 在同文件命中 627 次）。
 *
 * 本组钉住：
 * 1. 2 MiB 文件（旧的 1 MiB 上限之外）必须被真实搜索到；
 * 2. 超过 16 MiB 的新上限时跳过必须计入 `skippedLargeFiles`（可被上层显式告知）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { grep, grepAsync } from '../../../src/tools/GrepTool/grep';

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'grep-large-'));
  mkdirSync(join(tmpRoot, 'mid'), { recursive: true });
  mkdirSync(join(tmpRoot, 'huge'), { recursive: true });

  // 2 MiB：旧的 1 MiB 上限会跳过；末尾埋唯一标记
  const filler = 'x'.repeat(1023) + '\n'; // ≈1 KiB/行
  const midLines = new Array(2048).fill(filler); // ≈2 MiB
  midLines.push('NEEDLE_IN_MID_FILE\n');
  writeFileSync(join(tmpRoot, 'mid', 'events.jsonl'), midLines.join(''));

  // 17 MiB：超过新上限 16 MiB
  writeFileSync(
    join(tmpRoot, 'huge', 'messages.jsonl'),
    Buffer.alloc(17 * 1024 * 1024, 'a')
  );
});

afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // @ignore-catch
  }
});

describe('grep 大文件（FIX-1）', () => {
  test('2 MiB 文件会被真实搜索（旧实现返回 0 命中）', async () => {
    const result = await grepAsync({
      pattern: 'NEEDLE_IN_MID_FILE',
      searchPath: join(tmpRoot, 'mid'),
    });
    expect(result.matchCount).toBe(1);
    expect(result.fileCount).toBe(1);
    expect(result.stats?.skippedLargeFiles ?? 0).toBe(0);
  });

  test('超过 16 MiB 的文件被跳过时计入 skippedLargeFiles（不再静默）', async () => {
    const result = await grepAsync({
      pattern: 'NEEDLE_IN_MID_FILE',
      searchPath: join(tmpRoot, 'huge'),
    });
    expect(result.matchCount).toBe(0);
    expect(result.stats?.skippedLargeFiles).toBe(1);
  });

  test('同步 grep 与大文件路径同一口径', () => {
    const result = grep({
      pattern: 'NEEDLE_IN_MID_FILE',
      searchPath: join(tmpRoot, 'mid'),
    });
    expect(result.matchCount).toBe(1);
  });
});

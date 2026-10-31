/**
 * STATUS.md「评测基线题目」口径自证（2026-11-01）。
 *
 * 背景：README 曾写「36 题基线」，而 `src/evals/baseline.json` 的 `tasks` 已 38 项
 * ⇒ 与工具/通道/文档语料同属「易漂移数字」。现由 `gen-status.ts` 现算，本用例守住
 * 「STATUS.md 的题目数 == 基线 JSON 的逐题登记数」，任一侧改动未同步即失败。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP_DIR = process.cwd();
const BASELINE_FILE = join(APP_DIR, 'src', 'evals', 'baseline.json');
const STATUS_FILE = join(APP_DIR, '..', 'STATUS.md');

describe('STATUS.md「评测基线题目」与 baseline.json 同口径', () => {
  it('STATUS.md 的题目数 == baseline.json 的 tasks 键数', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as {
      tasks?: Record<string, unknown>;
    };
    const status = readFileSync(STATUS_FILE, 'utf-8');
    const row = /\| 评测基线题目 \| \*\*(\d+)\*\* \|/.exec(status);

    expect(row).not.toBeNull();
    expect(Number(row![1])).toBe(Object.keys(baseline.tasks ?? {}).length);
  });
});

/**
 * P0-1（2026-11-05）：会话工作区**重新定位**的入参校验。
 *
 * 背景：worktree 被清理后会话仍钉在死根，用户在失效提示条里选新目录 ⇒
 * `PATCH /v1/sessions/:id/meta { workspace_path }`。本用例锁：
 *   · 只接受**绝对路径**（相对值 / 项目名一律 400）；
 *   · 目标必须**已存在且是目录**（写错路径不许静默建目录 —— 那会造出"看似修好"的空目录）；
 *   · 通过时返回 `resolve` 规范化后的路径（落库口径统一）。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateWorkspacePathInput } from '../../src/infrastructure/http/handlers/session-handlers-utils';

const rootDir = mkdtempSync(join(tmpdir(), 'liri-ws-input-'));
const dir = join(rootDir, 'workspace');
const file = join(rootDir, 'note.txt');
// 建一个真实目录 + 一个普通文件（Windows / POSIX 同一套断言）
mkdirSync(dir, { recursive: true });
writeFileSync(file, 'x');

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe('P0-1 工作区重新定位入参校验', () => {
  test('绝对路径 + 已存在目录 ⇒ 通过并规范化', () => {
    const checked = validateWorkspacePathInput(dir);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      // `resolve` 会规整分隔符 / 尾部斜杠；不要求它改写盘符大小写
      expect(checked.path).toBe(dir);
    }
  });

  test('相对路径 / 空值 / 非字符串 ⇒ 拒绝', () => {
    for (const raw of [
      '',
      '   ',
      'relative/path',
      '../up',
      undefined,
      null,
      42,
    ]) {
      const checked = validateWorkspacePathInput(raw);
      expect(checked.ok).toBe(false);
    }
  });

  test('不存在 ⇒ 拒绝（不静默建目录）', () => {
    const checked = validateWorkspacePathInput(join(rootDir, 'missing-dir'));
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.error).toContain('existing directory');
    }
  });

  test('是文件而非目录 ⇒ 拒绝', () => {
    const checked = validateWorkspacePathInput(file);
    expect(checked.ok).toBe(false);
  });
});

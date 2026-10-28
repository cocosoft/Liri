// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LRO-D4（2026-10-26 复核发现）：`resolveProjectRoot()` 的 exe 推断不得命中宿主运行时。
 *
 * 原实现只判 `argv[0].endsWith('.exe')`：开发入口 `bun run …` 的 argv[0] 是 `bun.exe`
 * ⇒ 启动 cwd 为盘根时，"项目根"会被算成 **bun 安装目录**（`~/.bun/bin`），
 * `main.ts` 随即 `chdir` 到那里 ⇒ 工具 cwd / 受信工作区判定 / 相对路径全线偏移。
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { isRuntimeExecutable } from '@modules/environment';

const PATHS_SRC = readFileSync(
  // P1（2026-10-28）：paths 已从内核迁至 `@modules/environment`
  new URL('../../src/environment/paths.ts', import.meta.url),
  'utf8'
);

describe('LRO-D4：isRuntimeExecutable', () => {
  it('宿主运行时 exe ⇒ true（不得作为"应用 exe"推断项目根）', () => {
    for (const p of [
      'C:\\Users\\csdnc\\.bun\\bin\\bun.exe',
      'C:/Program Files/nodejs/node.exe',
      'C:\\Program Files\\nodejs\\npm.exe',
      'deno.exe',
      '/usr/local/bin/bunx.exe',
    ]) {
      expect(isRuntimeExecutable(p)).toBe(true);
    }
  });

  it('应用自身 exe / 非 exe / 空值 ⇒ false', () => {
    expect(
      isRuntimeExecutable('C:\\Program Files\\Liri\\liri_terminal.exe')
    ).toBe(false);
    expect(isRuntimeExecutable('/opt/liri/liri')).toBe(false);
    expect(isRuntimeExecutable(undefined)).toBe(false);
    expect(isRuntimeExecutable('')).toBe(false);
  });

  it('resolveProjectRoot 的 exe 推断必须带运行时排除（结构守卫）', () => {
    expect(PATHS_SRC).toContain('!isRuntimeExecutable(argv0)');
    expect(PATHS_SRC).toContain('RUNTIME_EXE_BASENAMES');
  });
});

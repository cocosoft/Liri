// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-03a（2026-10-17）：搜索根作用域的系统目录跳过。
 *
 * 不变量：
 * 1. home / 盘符根 ⇒ 追加系统/浏览器目录；
 * 2. 项目根 ⇒ 不追加（避免误跳项目内合法的同名目录）；
 * 3. 模式显式点名系统目录时仍豁免；
 * 4. 不传搜索根时保持旧行为（仅 SKIP_DIRS）。
 */
import { describe, it, expect } from 'bun:test';
import { homedir, tmpdir } from 'os';
import {
  SKIP_DIRS,
  ROOT_SCOPE_SKIP_DIRS,
  getSkipDirsForRoot,
  resolveSkipDirs,
} from '../../../src/tools/utils/searchSkipDirs.js';

describe('getSkipDirsForRoot', () => {
  it('home 根追加 AppData / Windows 等系统目录', () => {
    const dirs = getSkipDirsForRoot(homedir());
    expect(dirs.has('AppData')).toBe(true);
    expect(dirs.has('Windows')).toBe(true);
    expect(dirs.has('node_modules')).toBe(true);
  });

  it('项目根不追加系统目录', () => {
    const dirs = getSkipDirsForRoot(tmpdir());
    expect(dirs.has('AppData')).toBe(false);
    expect(dirs.has('node_modules')).toBe(true);
  });

  it('缺省搜索根保持旧行为', () => {
    expect(getSkipDirsForRoot()).toBe(SKIP_DIRS);
  });
});

describe('resolveSkipDirs 与搜索根组合', () => {
  it('home 根默认跳过 AppData', () => {
    const dirs = resolveSkipDirs('**/*.ts', homedir());
    expect(dirs.has('AppData')).toBe(true);
  });

  it('模式显式点名 AppData 时豁免', () => {
    const dirs = resolveSkipDirs('AppData/**/*.ts', homedir());
    expect(dirs.has('AppData')).toBe(false);
  });

  it('项目根不会出现系统目录（无论模式）', () => {
    const dirs = resolveSkipDirs('**/*.ts', tmpdir());
    expect(dirs.has('AppData')).toBe(false);
    expect(dirs).toBe(SKIP_DIRS);
  });

  it('根作用域集合包含基础集合', () => {
    for (const dir of SKIP_DIRS) {
      expect(ROOT_SCOPE_SKIP_DIRS.has(dir)).toBe(true);
    }
  });
});

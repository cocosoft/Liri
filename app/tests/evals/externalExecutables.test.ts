/**
 * 外部命令解析（eval 子进程依赖）：**优先级**与"找不到时的兜底语义"。
 *
 * 覆盖 2026-10-23 的实测缺口：`PATH` 不含 `git` / `tar` 时（GUI 启动的进程、
 * 精简环境），快照导出不能直接 `spawn … ENOENT` 一了百了 —— 要先按已知安装位置兜底，
 * 真找不到才把错误留给子进程（由调用方文案说明）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GIT_BIN_ENV,
  resolveGitExecutable,
  resolveTarExecutable,
  TAR_BIN_ENV,
} from '../../src/evals/externalExecutables';

const roots: string[] = [];

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const isWindows = process.platform === 'win32';
/** 造一个"看起来可执行"的文件（解析只看存在性，不执行） */
function touch(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const full = join(dir, name);
  writeFileSync(full, '', 'utf-8');
  return full;
}

describe('resolveGitExecutable：优先级', () => {
  it('显式变量优先于 PATH 与已知安装位置', () => {
    const pathDir = scratch('exec-path-');
    touch(pathDir, isWindows ? 'git.exe' : 'git');
    const override = join(scratch('exec-override-'), 'my-git');

    expect(
      resolveGitExecutable({
        [GIT_BIN_ENV]: override,
        PATH: pathDir,
      })
    ).toBe(override);
  });

  it('PATH 命中（跨平台按各自分隔符与扩展名）', () => {
    const pathDir = scratch('exec-path-hit-');
    const expected = touch(pathDir, isWindows ? 'git.exe' : 'git');
    // 前置一个不存在的目录：扫描必须跳过它而不是放弃
    const pathValue = [join(pathDir, 'missing'), pathDir].join(
      isWindows ? ';' : ':'
    );

    expect(resolveGitExecutable({ PATH: pathValue })).toBe(expected);
  });

  it('PATH 未命中 ⇒ win32 回落到 Git for Windows 默认目录', () => {
    const programFiles = scratch('exec-pf-');
    const expected = touch(join(programFiles, 'Git', 'cmd'), 'git.exe');

    expect(
      resolveGitExecutable({ PATH: '', ProgramFiles: programFiles }, 'win32')
    ).toBe(expected);
  });

  it('都找不到 ⇒ 返回命令名本身（交给子进程报 ENOENT，由调用方文案说明）', () => {
    // 固定 win32 且把已知位置全部指向空目录：避免宿主机真的装了 git 时结果不稳定
    const empty = scratch('exec-empty-');
    expect(
      resolveGitExecutable({ PATH: '', ProgramFiles: empty }, 'win32')
    ).toBe('git');
  });
});

describe('resolveTarExecutable：Windows 自带 bsdtar 在 System32', () => {
  it('PATH 未命中 ⇒ 按 SystemRoot 兜底', () => {
    const systemRoot = scratch('exec-win-');
    const expected = touch(join(systemRoot, 'System32'), 'tar.exe');

    expect(
      resolveTarExecutable({ PATH: '', SystemRoot: systemRoot }, 'win32')
    ).toBe(expected);
  });

  it('显式变量优先；都找不到 ⇒ 返回 tar', () => {
    expect(
      resolveTarExecutable({ [TAR_BIN_ENV]: '/opt/my-tar', PATH: '' }, 'linux')
    ).toBe('/opt/my-tar');
    // 同上：固定 win32 + 空 SystemRoot，避免宿主机自带的 tar 让结果依赖环境
    expect(
      resolveTarExecutable(
        { PATH: '', SystemRoot: scratch('exec-empty-sys-') },
        'win32'
      )
    ).toBe('tar');
  });
});

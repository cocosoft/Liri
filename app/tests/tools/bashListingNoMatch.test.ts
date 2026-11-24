// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-24（会话 `session_mwurduuh1b0b38db30` 复盘）：
 * `dir` 无匹配（exit 1 + `2>nul` 吞诊断）与 `&&` 短路的判定/提示。
 *
 * 真机形态：`dir /b /s "…\app\src\*SessionStateMachine*" 2>nul & dir /b /s "…" 2>nul`
 * ⇒ 目标确实没有匹配（文件在 `packages/infra`），cmd 报 `File Not Found` + exit 1，
 * 但 `2>nul` 让 stdout/stderr 双空 ⇒ 既有 searchNoMatch/pathNotFound 都不命中。
 *
 * 本文件钉住收窄边界：必须是 exit=1 + 双空 + 末段为 dir + 有 `2>nul` + 无其它重定向 +
 * 目标目录**真实存在** + 命令不含 `&&`。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAndChainHint,
  buildStderrSuppressedHint,
  isListingNoMatch,
} from '../../src/tools/bash/listingNoMatch';

const root = mkdtempSync(join(tmpdir(), 'liri-listing-'));
const emptyDir = join(root, 'empty');
const docsDir = join(root, 'docs');
mkdirSync(emptyDir);
mkdirSync(docsDir);
writeFileSync(join(docsDir, 'a.txt'), 'x');

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // @ignore-catch — 清理失败不影响断言结果
  }
});

describe('isListingNoMatch：dir 无匹配/空目录', () => {
  it('通配符无匹配（目标目录存在）⇒ true（真机形态）', () => {
    expect(
      isListingNoMatch({
        command: `dir /b /s "${join(docsDir, '*SessionStateMachine*')}" 2>nul`,
        exitCode: 1,
        stdout: '',
        stderr: '',
        cwd: root,
      })
    ).toBe(true);
  });

  it('存在的空目录 ⇒ true（dir 对空目录同样 exit 1 + File Not Found）', () => {
    expect(
      isListingNoMatch({
        command: `dir "${emptyDir}" 2>nul`,
        exitCode: 1,
        stdout: '',
        stderr: '',
        cwd: root,
      })
    ).toBe(true);
  });

  it('`&` 无条件串联（两段 dir 均无匹配）⇒ true', () => {
    expect(
      isListingNoMatch({
        command:
          `cd /d "${root}" & dir /b /s "${join(docsDir, '*nope*')}" 2>nul ` +
          `& dir /b /s "${join(docsDir, '*nope2*')}" 2>nul`,
        exitCode: 1,
        stdout: '',
        stderr: '',
        cwd: root,
      })
    ).toBe(true);
  });

  it('目标目录不存在 ⇒ false（不把"缺目录"洗成"无匹配"）', () => {
    expect(
      isListingNoMatch({
        command: `dir "${join(root, 'nope', '*a*')}" 2>nul`,
        exitCode: 1,
        stdout: '',
        stderr: '',
        cwd: root,
      })
    ).toBe(false);
  });

  it('含 `&&` ⇒ false（无法确定哪段失败，可能末段根本没执行）', () => {
    expect(
      isListingNoMatch({
        command: `dir /b "${join(docsDir, '*nope*')}" 2>nul && dir /b "${docsDir}"`,
        exitCode: 1,
        stdout: '',
        stderr: '',
        cwd: root,
      })
    ).toBe(false);
  });

  it('缺少 `2>nul` / 有 stdout / 有 stderr / 退出码非 1 / 非 dir ⇒ false', () => {
    const base = {
      exitCode: 1,
      stdout: '',
      stderr: '',
      cwd: root,
    };
    expect(isListingNoMatch({ ...base, command: `dir "${emptyDir}"` })).toBe(
      false
    );
    expect(
      isListingNoMatch({
        ...base,
        command: `dir "${emptyDir}" 2>nul`,
        stdout: 'a.txt',
      })
    ).toBe(false);
    expect(
      isListingNoMatch({
        ...base,
        command: `dir "${emptyDir}" 2>nul`,
        stderr: 'Access is denied.',
      })
    ).toBe(false);
    expect(
      isListingNoMatch({
        ...base,
        command: `dir "${emptyDir}" 2>nul`,
        exitCode: 2,
      })
    ).toBe(false);
    expect(
      isListingNoMatch({
        ...base,
        command: `type "${join(docsDir, 'a.txt')}" 2>nul`,
      })
    ).toBe(false);
  });

  it('另有输出重定向（>file）⇒ false（有写盘意图）', () => {
    expect(
      isListingNoMatch({
        command: `dir "${docsDir}" 2>nul > out.txt`,
        exitCode: 1,
        stdout: '',
        stderr: '',
        cwd: root,
      })
    ).toBe(false);
  });
});

describe('失败可观测性提示', () => {
  it('`2>nul` 吞 stderr（exit≠0 + stderr 空）⇒ 提示去掉重定向', () => {
    const hint = buildStderrSuppressedHint({
      command: 'dir /b 2>nul',
      exitCode: 1,
      stderr: '',
    });
    expect(hint).toContain('2>nul');
    expect(hint).toContain('去掉');
  });

  it('stderr 有内容 / 退出码 0 / 无 2>nul ⇒ 不给提示', () => {
    expect(
      buildStderrSuppressedHint({
        command: 'dir 2>nul',
        exitCode: 1,
        stderr: 'File Not Found',
      })
    ).toBe('');
    expect(
      buildStderrSuppressedHint({ command: 'dir 2>nul', exitCode: 0 })
    ).toBe('');
    expect(
      buildStderrSuppressedHint({ command: 'dir', exitCode: 1, stderr: '' })
    ).toBe('');
  });

  it('`&&` + 非 0 退出 ⇒ 明示后续段可能未执行', () => {
    const hint = buildAndChainHint({
      command: 'dir a && dir b',
      exitCode: 1,
    });
    expect(hint).toContain('&&');
    expect(hint).toContain('跳过');
  });

  it('无 `&&` 或退出码 0 ⇒ 不给 `&&` 提示', () => {
    expect(buildAndChainHint({ command: 'dir a & dir b', exitCode: 1 })).toBe(
      ''
    );
    expect(buildAndChainHint({ command: 'dir a && dir b', exitCode: 0 })).toBe(
      ''
    );
  });
});

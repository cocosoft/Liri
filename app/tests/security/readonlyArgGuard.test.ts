// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0（2026-11-22）：只读命令的「参数级禁区」唯一判据。
 *
 * 真机实测（五道门串联）：只读族按**命令名**放行 ⇒
 * `find . -exec node evil.js +`、`find . -delete`、`rg --pre sh TODO`、
 * `sort -o out.txt`、`uniq in.txt out.txt`、`tree -o out.txt`、`date -s …`
 * 全部落 **allow**（零审批），其中 `-exec` / `--pre` / `--compress-program` 直接执行外部程序。
 *
 * 本文件锁定：
 *  ① 判据本身（命中 / 未命中 / 非守卫面命令）；
 *  ② 三个消费方同口径（`checkBashAllowlist` / `isReadOnlyBashCommand` / auto 档）。
 */

import { describe, expect, it } from 'bun:test';
import { findReadonlyArgViolation } from '@openliri/infra/security';
import {
  checkBashAllowlist,
  isReadOnlyBashCommand,
} from '@openliri/infra/security/BashAllowlistMatcher';
import { checkReadonlyCommand } from '@openliri/infra/permission/classifiers/readonly-command-allowlist';

describe('findReadonlyArgViolation：命中写 / 执行型开关', () => {
  const blocked: ReadonlyArray<readonly [string, string]> = [
    ['find -exec', 'find . -exec node evil.js +'],
    ['find -execdir', 'find . -execdir rm -rf {} +'],
    ['find -ok', 'find . -ok node evil.js +'],
    ['find -delete', 'find . -delete'],
    ['find -fprint', 'find . -fprint out.txt'],
    ['find -fprintf', 'find . -fprintf out.txt %p'],
    ['find -fls', 'find . -fls out.txt'],
    ['rg --pre', 'rg --pre sh TODO'],
    ['rg --pre=…', 'rg --pre=./evil.py TODO src'],
    ['sort -o', 'sort -o out.txt in.txt'],
    ['sort -o（紧贴）', 'sort -oout.txt in.txt'],
    ['sort --output', 'sort --output=out.txt in.txt'],
    ['sort --compress-program', 'sort --compress-program=sh in.txt'],
    ['sort /O（Windows）', 'sort /O out.txt in.txt'],
    ['uniq 第二位置参数', 'uniq in.txt out.txt'],
    ['tree -o', 'tree -o out.txt .'],
    ['date -s', 'date -s 2020-01-01'],
    ['date --set', 'date --set=2020-01-01'],
    ['date 位置参数（Windows）', 'date 01/01/2020'],
    ['file -C', 'file -C'],
  ];

  for (const [label, command] of blocked) {
    it(`命中（${label}）：${command}`, () => {
      const violation = findReadonlyArgViolation(command);
      expect(violation).not.toBeNull();
      expect(violation?.command.length).toBeGreaterThan(0);
      expect(violation?.flags.length).toBeGreaterThan(0);
      // 报文必须自带可照抄的等价写法（F1：模型能据此改正，而不是反复重试）
      expect(violation?.message).toContain('等价');
    });
  }
});

describe('findReadonlyArgViolation：不误伤只读形态', () => {
  const allowed = [
    'find . -name "*.ts"',
    'find docs -type f',
    'find . -newer package.json',
    'rg TODO src',
    'rg -n TODO src',
    'sort in.txt',
    'sort -n -k2 in.txt',
    'uniq in.txt',
    'tree .',
    'tree docs -L 2',
    'date',
    'date +%Y-%m-%d',
    'date -u',
    'file package.json',
    // 非守卫面命令：整串里出现 `-exec` / `-o` 等字样也不得误判
    'echo find . -exec',
    'grep -rn "-exec" docs',
    'dir /b',
    '',
  ];

  for (const command of allowed) {
    it(`不命中：${command || '（空命令）'}`, () => {
      expect(findReadonlyArgViolation(command)).toBeNull();
    });
  }
});

describe('消费方同口径：checkBashAllowlist / isReadOnlyBashCommand', () => {
  it('带执行开关的 find 不再算"已知安全"', () => {
    expect(checkBashAllowlist('find . -exec node evil.js +').safe).toBe(false);
    expect(checkBashAllowlist('find . -delete').safe).toBe(false);
    expect(checkBashAllowlist('find . -name "*.ts"').safe).toBe(true);
  });

  it('isReadOnlyBashCommand 与 allowlist 同结论', () => {
    expect(isReadOnlyBashCommand('sort -o out.txt in.txt')).toBe(false);
    expect(isReadOnlyBashCommand('sort in.txt')).toBe(true);
    expect(isReadOnlyBashCommand('uniq in.txt out.txt')).toBe(false);
    expect(isReadOnlyBashCommand('uniq in.txt')).toBe(true);
  });
});

describe('消费方同口径：auto 档只读短路', () => {
  const notAllowed = [
    'sort --compress-program=sh in.txt',
    'uniq in.txt out.txt',
    'tree -o out.txt .',
    'find . -exec node evil.js +',
    'find . -delete',
    'date -s 2020-01-01',
    'file -C',
  ];

  for (const command of notAllowed) {
    it(`不放行：${command}`, () => {
      expect(checkReadonlyCommand(command).allowed).toBe(false);
    });
  }

  const allowed = [
    'sort in.txt',
    'uniq in.txt',
    'tree docs',
    'find docs -name x',
    'date',
  ];
  for (const command of allowed) {
    it(`仍放行：${command}`, () => {
      expect(checkReadonlyCommand(command).allowed).toBe(true);
    });
  }
});

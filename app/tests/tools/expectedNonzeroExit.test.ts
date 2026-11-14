// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// P1-1（2026-11-06，审批/熔断根因簇）回归锁。
//
// 真机 `session_mw458fpp3ea32a050e`：连续 3 次 `tsc --noEmit` 报类型错（退出码 1）
// 被计入 `consecutiveInvalidTurns` 并触发 `circuit_breaker` —— 模型正在按错误修代码，
// 却被当成"输出无效"。
//
// 修复：检查/测试类命令的非零退出 = **有效证据**，由 `isExpectedNonzeroExit()` 结构化判定，
// BashTool 写 `failureKind='expected_nonzero_exit'`，`classifyTurn()` 判为 progress。
// 本文件同时守护负向边界：普通命令非零退出、写文件重定向、exit=0 都不得被误判。

import { describe, expect, it } from 'bun:test';
import {
  isExpectedNonzeroExit,
  lastCommandSegment,
} from '../../src/tools/bash/exitSemantics';
import { classifyTurn } from '@modules/query/ReActLoop';

describe('isExpectedNonzeroExit：检查/测试类命令的非零退出', () => {
  const yes = (command: string, exitCode = 1): void => {
    expect(isExpectedNonzeroExit({ command, exitCode })).toBe(true);
  };
  const no = (command: string, exitCode = 1): void => {
    expect(isExpectedNonzeroExit({ command, exitCode })).toBe(false);
  };

  it('类型检查：npx / bunx / 本地 node_modules 三种形态', () => {
    yes('npx tsc --noEmit');
    yes('bunx tsc --noEmit');
    yes('.\\node_modules\\.bin\\tsc.cmd --noEmit');
    yes('./node_modules/.bin/tsc --noEmit');
    yes('bun run typecheck');
  });

  it('测试与 lint', () => {
    yes('bun test');
    yes('bun test tests/chat');
    yes('npm test');
    yes('pnpm run test:unit');
    yes('npx vitest run');
    yes('eslint src tests');
    yes('bun run lint');
  });

  it('git diff 以退出码表达"有差异"', () => {
    yes('git diff --exit-code');
    yes('git diff --quiet HEAD');
  });

  it('复合命令按段检查（真机 powershell 包裹形态）', () => {
    yes('cd /d E:\\repo && npx tsc --noEmit');
    yes(
      `powershell -NoProfile -Command "cd 'E:\\repo'; npx tsc --noEmit --pretty false 2>&1"`
    );
  });

  it('负向：普通命令 / 非检查脚本 / exit=0 / 空命令 ⇒ 不得误判', () => {
    no('rm -rf build');
    no('node app.js');
    no('bun run build');
    no('cat missing.txt');
    no('npx tsc --noEmit', 0);
    expect(isExpectedNonzeroExit({ command: '', exitCode: 1 })).toBe(false);
    expect(isExpectedNonzeroExit({ command: 'npx tsc --noEmit' })).toBe(false);
  });
});

describe('lastCommandSegment：与检索无匹配判定共用同一实现', () => {
  it('取管道/串联的最后一段', () => {
    expect(lastCommandSegment('cd X && npx tsc --noEmit')).toBe(
      'npx tsc --noEmit'
    );
    expect(lastCommandSegment('dir /b | findstr a')).toBe('findstr a');
    expect(lastCommandSegment('a || b ; c')).toBe('c');
  });
});

describe('classifyTurn：expected_nonzero_exit 不计入 invalid', () => {
  it('连续 3 轮检查未通过 ⇒ progress（不再触发 circuit_breaker）', () => {
    expect(
      classifyTurn([{ status: 'error', failureKind: 'expected_nonzero_exit' }])
    ).toBe('progress');
  });

  it('负向：未分类失败 / 工具自身失败仍判 invalid', () => {
    expect(classifyTurn([{ status: 'error', failureKind: 'tool_error' }])).toBe(
      'invalid'
    );
    expect(classifyTurn([{ status: 'error' }])).toBe('invalid');
  });

  it('混合：检查未通过 + 真实失败 ⇒ 仍按失败分型（不洗白）', () => {
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'expected_nonzero_exit' },
        { status: 'error', failureKind: 'tool_error' },
      ])
    ).toBe('invalid');
  });
});

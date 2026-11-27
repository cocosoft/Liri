// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-2（复杂度清理）：`BashTool.execute` **catch 分支**的特征化锁（外移前先测）。
 *
 * 真实 shell 的失败形态受平台/环境影响（`bashSemanticSuccess.test.ts` 的三条用例因此按
 * win32 跳过），而 `execute` 的 catch 收尾要固化的是**结果结构与日志级别**，与 shell 无关。
 * 这里把唯一执行入口 `runCommandAndBuildResult` 打桩成 reject（同 `bashGateBlockLogging`
 * 对 `resolveApprovalState` 的打桩方式），确定性地覆盖：
 *   ① 普通非零退出 ⇒ 失败 + 退出码/stdout 事实补充 + `bash: execute_error`；
 *   ② 检查/测试类命令非零退出 ⇒ `failureKind=expected_nonzero_exit` + `bash: expected_nonzero_exit`；
 *   ③ spawn ENOENT ⇒ 追加「cwd 不存在 / shell 缺失」双因提示；
 *   ④ 无退出码/无 stdout ⇒ 不补事实行（不编造）。
 *
 * 安全门四条分支（path / danger / analyzer deny / ask×autoApproved）已由
 * `bashGateBlockLogging.test.ts` 覆盖，本次外移**不改**其判定与日志。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { getLogger } from '@openliri/infra/monitoring';
import {
  BashTool,
  resetGraySwitchWarningForTest,
} from '../../src/tools/bash/BashTool.js';
import { ApprovedCommandRegistry } from '@openliri/infra/permission/ApprovedCommandRegistry';
import type { ToolUseContext } from '../../src/tools/types/Tool.js';
import type { ToolResult } from '../../src/tools/types';

function makeContext(sessionId: string): ToolUseContext {
  return {
    sessionId,
    options: {} as ToolUseContext['options'],
    abortController: new AbortController(),
    readFileState: {},
  } as unknown as ToolUseContext;
}

const bashLogger = getLogger('tools:bash:BashTool');

type LogCall = [string, Record<string, unknown>];

/** 构造带 exitCode / stdout / stderr 的 exec 形态异常（与 `exec` 抛出的错误同形） */
function makeExecError(params: {
  message: string;
  code?: number | string;
  stdout?: string;
  stderr?: string;
}): Error {
  const err = new Error(params.message) as Error & {
    code?: number | string;
    stdout?: string;
    stderr?: string;
  };
  if (params.code !== undefined) err.code = params.code;
  if (params.stdout !== undefined) err.stdout = params.stdout;
  if (params.stderr !== undefined) err.stderr = params.stderr;
  return err;
}

interface TestDouble {
  /** 桩掉私有执行入口 ⇒ 只走 execute 的 catch 收尾（不真的 spawn） */
  runCommandAndBuildResult: (params: unknown) => Promise<unknown>;
  /** 桩掉放行查询 ⇒ 钉住"已批准"，避免非信任工作区把命令转成 ask（用例环境相关） */
  resolveApprovalState: (
    command: string,
    sessionId?: string,
    approvalScope?: unknown
  ) => Promise<{
    hash: string;
    bypassAsk: boolean;
    source: 'registry' | 'rule' | 'none';
  }>;
}

let logSpies: Array<ReturnType<typeof spyOn>> = [];

function callsOf(key: string): LogCall[] {
  return logSpies
    .flatMap((spy) => (spy.mock.calls ?? []) as LogCall[])
    .filter((c) => c[0] === key);
}

afterEach(() => {
  for (const spy of logSpies) spy.mockRestore();
  logSpies = [];
  resetGraySwitchWarningForTest();
});

async function runWithExecError(
  command: string,
  error: Error,
  options?: { bypassAsk?: boolean }
): Promise<ToolResult<unknown>> {
  const reg = new ApprovedCommandRegistry(60_000, false);
  try {
    const tool = new BashTool(reg);
    const rejection = spyOn(
      tool as unknown as TestDouble,
      'runCommandAndBuildResult'
    ).mockRejectedValue(error as never);
    const approval =
      options?.bypassAsk === true
        ? spyOn(
            tool as unknown as TestDouble,
            'resolveApprovalState'
          ).mockResolvedValue({
            hash: 'test-hash',
            bypassAsk: true,
            source: 'registry',
          })
        : undefined;
    const warnSpy = spyOn(bashLogger, 'warn');
    const infoSpy = spyOn(bashLogger, 'info');
    const errorSpy = spyOn(bashLogger, 'error');
    logSpies = [warnSpy, infoSpy, errorSpy];
    try {
      return await tool.execute({ command }, makeContext('sess-fail-branch'));
    } finally {
      approval?.mockRestore();
      rejection.mockRestore();
    }
  } finally {
    reg.dispose();
  }
}

describe('BashTool.execute catch 收尾（P3-2 外移前特征化）', () => {
  it('普通非零退出 ⇒ 失败 + 退出码/stdout 事实补充 + execute_error', async () => {
    const result = await runWithExecError(
      'echo boom-fail',
      makeExecError({
        message: 'Command failed: echo boom-fail',
        code: 3,
        stdout: 'raw-out\n',
        stderr: 'raw-err',
      })
    );

    expect(result.success).toBe(false);
    expect(result.failureKind).toBeUndefined();
    // 事实补充：退出码 + stdout 摘要（stderr 已由 message 携带，不重复）
    expect(String(result.error ?? '')).toContain(
      '（退出码: 3；stdout: raw-out）'
    );
    expect(String(result.error ?? '')).not.toContain('raw-err');
    expect(result.errorOutput).toBe('raw-err');
    expect(String(result.newMessages?.[0]?.content ?? '')).toBe(
      `Error: ${String(result.error ?? '')}`
    );

    const errCalls = callsOf('bash: execute_error');
    expect(errCalls.length).toBe(1);
    expect(errCalls[0][1]).toMatchObject({
      sessionId: 'sess-fail-branch',
      exitCode: 3,
      stderr: 'raw-err',
    });
    expect(callsOf('bash: expected_nonzero_exit').length).toBe(0);
  });

  it('检查类命令非零退出 ⇒ expected_nonzero_exit 分类 + info 级日志', async () => {
    const result = await runWithExecError(
      'tsc --noEmit',
      makeExecError({ message: 'tsc failed', code: 1, stderr: 'type error' }),
      { bypassAsk: true }
    );

    expect(result.success).toBe(false);
    expect(result.failureKind).toBe('expected_nonzero_exit');
    expect(callsOf('bash: expected_nonzero_exit').length).toBe(1);
    // 分类变了，但不得同时记成环境错误
    expect(callsOf('bash: execute_error').length).toBe(0);
  });

  /**
   * P0-2（2026-11-27，真机 `session_mwz477wj251057474e`）：依赖安装失败 / 命令不存在探测失败
   * ⇒ `failureKind=env_unavailable`（环境层阻塞 2 轮即给结论），而不是按工具失败烧
   * invalid 预算（3 轮即 `circuit_breaker`，用户看到"画到一半报错中断"）。
   */
  it('依赖安装失败 / where 无此命令 ⇒ env_unavailable 分类 + warn 级日志', async () => {
    const npm = await runWithExecError(
      'cd /d E:\\repo && npm install @resvg/resvg-js --no-audit --no-fund',
      makeExecError({
        message: 'Command failed: npm install',
        code: 1,
        stderr: 'ERR_SOCKET_TIMEOUT',
      }),
      { bypassAsk: true }
    );
    expect(npm.success).toBe(false);
    expect(npm.failureKind).toBe('env_unavailable');
    expect(callsOf('bash: env_unavailable').length).toBe(1);
    // 分类变了 ⇒ 不再同时记成通用执行错误
    expect(callsOf('bash: execute_error').length).toBe(0);

    const where = await runWithExecError(
      'where magick',
      makeExecError({
        message: 'Command failed: where magick',
        code: 1,
        stderr: '信息: 用提供的模式无法找到文件。',
      }),
      { bypassAsk: true }
    );
    expect(where.success).toBe(false);
    expect(where.failureKind).toBe('env_unavailable');
  });

  it('spawn ENOENT ⇒ 追加「cwd 不存在 / shell 缺失」双因提示', async () => {
    const result = await runWithExecError(
      'echo enoent',
      makeExecError({ message: 'spawn cmd.exe ENOENT', code: 'ENOENT' })
    );

    expect(result.success).toBe(false);
    expect(String(result.error ?? '')).toContain('spawn ENOENT 可能来自');
    // 无 stdout ⇒ 不产出 stdout 摘要
    expect(String(result.error ?? '')).not.toContain('stdout:');
  });

  it('无退出码/无 stdout ⇒ 不补事实行（不编造）', async () => {
    const result = await runWithExecError(
      'echo plain',
      makeExecError({ message: 'plain failure' })
    );

    expect(result.success).toBe(false);
    expect(String(result.error ?? '')).toBe('plain failure');
  });
});

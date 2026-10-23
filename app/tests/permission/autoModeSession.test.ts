// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-3（2026-10-23）：会话级自动执行（`approvalMode='auto-local'`）回归锁。
 *
 * 口径（用户已拍板）：**仅只读 + 本地写**。本用例锁 6 条：
 *   ① 开关（`FEATURE_SESSION_AUTO_LOCAL`）关 ⇒ 即使会话声明 auto-local 也照常 ask；
 *   ② 开关开 + auto-local + 工作区内相对路径 ⇒ allow；
 *   ③ 路径越界（`../` / 绝对外部）⇒ ask；
 *   ④ 会话无工作区边界 ⇒ ask（不敢凭无界判定放行）；
 *   ⑤ `shell` 类工具 ⇒ ask（自动执行不覆盖命令）；
 *   ⑥ 无路径入参的写工具（如 `media_delete` 这类按 id 的）⇒ ask（不靠"猜"放行）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { PermissionChecker } from '../../src/permission/PermissionChecker.js';
import { RuleManager } from '../../src/permission/RuleManager.js';

const FLAG = 'FEATURE_SESSION_AUTO_LOCAL';
const workspace = resolve('.');

const fileWriteLike = { name: 'file_write', riskClass: 'write' as const };
const shellLike = { name: 'bash', riskClass: 'shell' as const };
const idOnlyWriteLike = { name: 'media_delete', riskClass: 'write' as const };

function makeChecker(): PermissionChecker {
  return new PermissionChecker(new RuleManager());
}

async function decide(
  tool: unknown,
  input: Record<string, unknown>,
  approvalMode?: 'ask' | 'auto-local',
  /** null = 显式"无工作区边界"（undefined 会命中默认参数） */
  ws: string | null = workspace
) {
  return makeChecker().checkPermission(tool as never, input, {
    sessionId: 'sess-pr3',
    toolName: (tool as { name: string }).name,
    input,
    approvalMode,
    workspacePath: ws ?? undefined,
  } as never);
}

let previousFlag: string | undefined;

beforeEach(() => {
  previousFlag = process.env[FLAG];
});

afterEach(() => {
  if (previousFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = previousFlag;
});

describe('PR-3：会话级 auto-local（仅只读 + 本地写）', () => {
  it('① 开关关 ⇒ 会话声明 auto-local 也照常 ask', async () => {
    delete process.env[FLAG];
    const d = await decide(
      fileWriteLike,
      { file_path: 'inside.txt', content: 'x' },
      'auto-local'
    );
    expect(d.type).toBe('ask');
  });

  it('② 开关开 + 工作区内相对路径 ⇒ allow', async () => {
    process.env[FLAG] = 'true';
    const d = await decide(
      fileWriteLike,
      { file_path: 'inside.txt', content: 'x' },
      'auto-local'
    );
    expect(d.type).toBe('allow');
  });

  it('③ 越界路径（../）⇒ ask', async () => {
    process.env[FLAG] = 'true';
    const d = await decide(
      fileWriteLike,
      { file_path: '../outside.txt', content: 'x' },
      'auto-local'
    );
    expect(d.type).toBe('ask');
  });

  it('④ 无工作区边界 ⇒ ask', async () => {
    process.env[FLAG] = 'true';
    const d = await decide(
      fileWriteLike,
      { file_path: 'inside.txt', content: 'x' },
      'auto-local',
      null
    );
    expect(d.type).toBe('ask');
  });

  it('⑤ shell 类工具 ⇒ ask（自动执行不覆盖命令）', async () => {
    process.env[FLAG] = 'true';
    const d = await decide(shellLike, { command: 'echo hi' }, 'auto-local');
    expect(d.type).toBe('ask');
  });

  it('⑥ 无路径入参的写工具 ⇒ ask（不凭猜测放行）', async () => {
    process.env[FLAG] = 'true';
    const d = await decide(idOnlyWriteLike, { media_id: 'abc' }, 'auto-local');
    expect(d.type).toBe('ask');
  });

  it('会话仍为 ask（未开启）⇒ 开关开也不放行写', async () => {
    process.env[FLAG] = 'true';
    const d = await decide(
      fileWriteLike,
      { file_path: 'inside.txt', content: 'x' },
      'ask'
    );
    expect(d.type).toBe('ask');
  });
});

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
import { PermissionChecker } from '@openliri/infra/permission/PermissionChecker';
import { RuleManager } from '@openliri/infra/permission/RuleManager';

const FLAG = 'FEATURE_SESSION_AUTO_LOCAL';
const MULTI_ROOT_FLAG = 'FEATURE_WORKSPACE_MULTI_ROOT';
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
let previousMultiRootFlag: string | undefined;

beforeEach(() => {
  previousFlag = process.env[FLAG];
  previousMultiRootFlag = process.env[MULTI_ROOT_FLAG];
});

afterEach(() => {
  if (previousFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = previousFlag;
  if (previousMultiRootFlag === undefined) delete process.env[MULTI_ROOT_FLAG];
  else process.env[MULTI_ROOT_FLAG] = previousMultiRootFlag;
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

/**
 * P1（2026-11-04，方案 §3.6）：`auto-local` 的写边界改用**工作区根列表**
 * （`context.workspaceRoots`，由执行入口的 `resolveRoots` 注入）。
 *
 * 口径：任一根之内即视为界内；缺省根列表 / 多根灰度关 ⇒ 回落单根 `workspacePath`
 * （与执行前严格边界同一灰度开关 `FEATURE_WORKSPACE_MULTI_ROOT`，避免两侧口径打架）。
 */
describe('P1：auto-local 的多根边界', () => {
  /** 父目录（不在主工作区内、但可作第二根） */
  const parent = resolve('..');
  /** 父目录下、主工作区之外的路径（词法上确实不在 workspace 内） */
  const sibling = resolve(parent, 'liri-multi-root-probe.txt');
  /** 两根之外的路径 */
  const faraway = resolve(parent, '..', 'liri-outside-all-roots.txt');

  function enable(autoLocal: boolean, multiRoot: boolean): void {
    if (autoLocal) process.env[FLAG] = 'true';
    else delete process.env[FLAG];
    if (multiRoot) process.env[MULTI_ROOT_FLAG] = 'true';
    else delete process.env[MULTI_ROOT_FLAG];
  }

  async function decideWithRoots(
    input: Record<string, unknown>,
    roots: string[]
  ) {
    return makeChecker().checkPermission(fileWriteLike as never, input, {
      sessionId: 'sess-pr3-roots',
      toolName: fileWriteLike.name,
      input,
      approvalMode: 'auto-local',
      workspacePath: roots[0],
      workspaceRoots: roots,
    } as never);
  }

  it('两根都开 + 写入第二根之内 ⇒ allow（此前只认单根会误判越界）', async () => {
    enable(true, true);
    const d = await decideWithRoots({ file_path: sibling, content: 'x' }, [
      workspace,
      parent,
    ]);
    expect(d.type).toBe('allow');
  });

  it('两根都开 + 写入所有根之外 ⇒ ask（多根不放宽根外判据）', async () => {
    enable(true, true);
    const d = await decideWithRoots({ file_path: faraway, content: 'x' }, [
      workspace,
      parent,
    ]);
    expect(d.type).toBe('ask');
  });

  it('多根灰度关 ⇒ 只认单根（第二根内也按越界 ⇒ ask，与执行前一致）', async () => {
    enable(true, false);
    const d = await decideWithRoots({ file_path: sibling, content: 'x' }, [
      workspace,
      parent,
    ]);
    expect(d.type).toBe('ask');
  });

  it('根列表缺省 ⇒ 回落单根 workspacePath（改造前行为不变）', async () => {
    enable(true, true);
    const inside = await decideWithRoots(
      { file_path: 'inside.txt', content: 'x' },
      [workspace]
    );
    expect(inside.type).toBe('allow');
    const outside = await decideWithRoots(
      { file_path: sibling, content: 'x' },
      [workspace]
    );
    expect(outside.type).toBe('ask');
  });
});

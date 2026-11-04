/**
 * P0-2（2026-11-04，issue #35）：AlwaysOn 会话的**工作区根预置**回归锁。
 *
 * 背景（运行态排查 P0-2）：AlwaysOn 执行阶段的 cwd 是**隔离副本**（worktree / snapshot），
 * 而模型按**真实项目目录**读写 ⇒ 不预置根时每次都被判越界、弹一张 5 分钟就过期的审批卡
 * （实测等价于"照旧拒绝"：`工具路径越界` 26 次 / 窗口）。
 *
 * 本文件锁两件事：
 *   ① 预置口径 = `mergeWorkspaceRoots(项目根, 既有追加根)`：项目根恒在首、去重、**不丢**
 *      用户已批准追加的根（合并走唯一实现，不另写一套）；
 *   ② 入口真的把项目根写进 `metadata.workspaceRoots`（创建会话 + 每轮改 cwd 两处）。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { mergeWorkspaceRoots } from '@openliri/infra/utils/toolContract/workspaceRoots';

const SRC = join(import.meta.dir, '..', '..', '..', 'src');

describe('P0-2：AlwaysOn 工作区根预置口径', () => {
  it('项目根恒在首，既有追加根保留且去重（大小写/尾斜杠无关）', () => {
    expect(
      mergeWorkspaceRoots('E:\\repo\\proj', ['C:\\approved\\extra'])
    ).toEqual(['E:\\repo\\proj', 'C:\\approved\\extra']);

    // 已批准的根里已含项目根（大小写差异 / 尾斜杠）⇒ 不重复
    expect(
      mergeWorkspaceRoots('E:\\repo\\proj', ['e:\\repo\\proj\\', 'C:\\other'])
    ).toEqual(['E:\\repo\\proj', 'C:\\other']);
  });

  it('既有根脏值不影响预置（非数组 / 非字符串一律忽略）', () => {
    expect(mergeWorkspaceRoots('E:\\repo\\proj', undefined)).toEqual([
      'E:\\repo\\proj',
    ]);
    expect(mergeWorkspaceRoots('E:\\repo\\proj', 'not-an-array')).toEqual([
      'E:\\repo\\proj',
    ]);
    expect(mergeWorkspaceRoots('E:\\repo\\proj', [null, 42, ''])).toEqual([
      'E:\\repo\\proj',
    ]);
  });
});

describe('P0-2：入口确实写入 metadata.workspaceRoots', () => {
  const source = readFileSync(
    join(SRC, 'entrypoints', 'alwaysOnEntry.ts'),
    'utf-8'
  );

  it('创建 AlwaysOn 会话时预置项目根', () => {
    expect(source).toContain(
      'workspaceRoots: mergeWorkspaceRoots(project.path'
    );
  });

  it('每轮改 cwd 时把项目根一并写进根列表（存量会话自然回填）', () => {
    // 调用点把 `project.path` 作为 targetRoot 传入
    expect(source).toContain(
      'setSessionWorkspace(sessionId, cwd, project.id, project.path)'
    );
    // 实现里用唯一合并口径生成 workspaceRoots
    expect(source).toContain('mergeWorkspaceRoots(');
    expect(source).toContain('workspaceRoots: roots');
  });
});

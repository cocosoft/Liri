/**
 * 工具 cwd 的「托管项目根缺失目录自动重建」（2026-11-03 P0）
 *
 * 现场（实时日志）：项目 `sandboxPath` 指向的目录被删后，会话每条 bash 都 `cwd_inaccessible`、
 * 相对路径读取全失败 ⇒ 模型反复 `glob` 猜路径 ⇒ 3 轮无进展被 `no_progress_loop` 熔断
 * （长程任务"自动中断"的主要成因）。
 *
 * 口径：**只重建托管项目根之内**的缺失目录（`LIRI_PROJECTS_DIR` / 用户设置 / 默认
 * `~/Documents/LiriProjects`）；用户手填的任意 `workspacePath` 不重建（写错盘符要暴露，不掩盖）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveToolCwd } from '../../src/chat/services/toolCwdScope';

let managedRoot: string;
let outsideRoot: string;
const savedEnv = process.env.LIRI_PROJECTS_DIR;

beforeEach(() => {
  managedRoot = mkdtempSync(join(tmpdir(), 'liri-projects-root-'));
  outsideRoot = mkdtempSync(join(tmpdir(), 'liri-outside-'));
  process.env.LIRI_PROJECTS_DIR = managedRoot;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.LIRI_PROJECTS_DIR;
  else process.env.LIRI_PROJECTS_DIR = savedEnv;
  for (const dir of [managedRoot, outsideRoot]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
    }
  }
});

describe('resolveToolCwd：托管项目根下的缺失目录', () => {
  it('缺失 ⇒ 自动重建为空目录，并给出一次性提示标记', () => {
    const target = join(managedRoot, 'proj_autoheal_1');
    expect(existsSync(target)).toBe(false);

    const decision = resolveToolCwd(target, undefined, {
      sessionId: 's-autoheal-1',
    });

    expect(existsSync(target)).toBe(true);
    expect(decision.cwd).toBe(target);
    expect(decision.recreatedSessionWorkspace).toBe(target);
    expect(decision.shouldNotifyRecreatedWorkspace).toBe(true);
    // 不再是「无效工作区」
    expect(decision.invalidSessionWorkspace).toBeUndefined();

    // 第二次：目录已存在 ⇒ 走正常分支（不再有任何重建/无效标记）
    const again = resolveToolCwd(target, undefined, {
      sessionId: 's-autoheal-1',
    });
    expect(again.recreatedSessionWorkspace).toBeUndefined();
    expect(again.shouldNotifyRecreatedWorkspace).toBeUndefined();
    expect(again.invalidSessionWorkspace).toBeUndefined();
  });

  it('已有目录 ⇒ 原样使用，不产生重建标记', () => {
    const target = join(managedRoot, 'proj_autoheal_2');
    // 先建好
    resolveToolCwd(target, undefined, { sessionId: 's-autoheal-2' });

    const decision = resolveToolCwd(target, undefined, {
      sessionId: 's-autoheal-3',
    });
    expect(decision.cwd).toBe(target);
    expect(decision.recreatedSessionWorkspace).toBeUndefined();
    expect(decision.invalidSessionWorkspace).toBeUndefined();
  });

  it('托管根之外的缺失路径 ⇒ 不重建，仍按无效工作区上报', () => {
    const target = join(outsideRoot, 'not-managed', 'x');
    expect(existsSync(target)).toBe(false);

    const decision = resolveToolCwd(target, undefined, {
      sessionId: 's-autoheal-4',
    });

    expect(existsSync(target)).toBe(false);
    expect(decision.invalidSessionWorkspace).toBe(target);
    expect(decision.recreatedSessionWorkspace).toBeUndefined();
  });
});

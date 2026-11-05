/**
 * 工作区根合并（父子折叠）—— 2026-11-04 P0-1 回归
 *
 * 缺陷现场：`applyWorkspaceScopeApproval` 原实现只做 `existing.includes(root)` 判重，
 * 于是同一会话里 `E:\PY\...\app`、`E:\PY\...\app\src\ai\router`、`E:\PY\...\app\src\tasks`
 * 各自弹卡、各批一次；用户以为「批一次就够了」，实际只放开了最末一级目录。
 */
import { describe, expect, it } from 'bun:test';
import { mergeWorkspaceRoot } from '@modules/runtime/inboxApproval';

const APP = 'E:\\PY\\Documents\\CODES\\PY_APP\\app';
const ROUTER = `${APP}\\src\\ai\\router`;
const TASKS = `${APP}\\src\\tasks`;

describe('mergeWorkspaceRoot：父子折叠', () => {
  it('空列表 ⇒ 追加', () => {
    expect(mergeWorkspaceRoot([], ROUTER)).toEqual({
      roots: [ROUTER],
      changed: true,
      dropped: [],
    });
  });

  it('已存在覆盖该目标的父根 ⇒ 不新增（核心：批一次够用）', () => {
    const merged = mergeWorkspaceRoot([APP], ROUTER);
    expect(merged.changed).toBe(false);
    expect(merged.roots).toEqual([APP]);
  });

  it('完全相同（仅大小写/结尾分隔符不同）⇒ 不新增', () => {
    const merged = mergeWorkspaceRoot([`${ROUTER.toUpperCase()}\\`], ROUTER);
    expect(merged.changed).toBe(false);
    expect(merged.roots).toHaveLength(1);
  });

  it('新根是父 ⇒ 折叠掉既有子根并留痕', () => {
    const merged = mergeWorkspaceRoot([ROUTER, TASKS], APP);
    expect(merged.changed).toBe(true);
    expect(merged.roots).toEqual([APP]);
    expect(merged.dropped).toEqual([ROUTER, TASKS]);
  });

  it('前缀相似但不是父子（app vs app2）⇒ 不折叠', () => {
    const app2 = `${APP}2`;
    const merged = mergeWorkspaceRoot([ROUTER], app2);
    expect(merged.changed).toBe(true);
    expect(merged.roots).toEqual([ROUTER, app2]);
    expect(merged.dropped).toEqual([]);
  });

  it('互不相关的根 ⇒ 各自保留', () => {
    const other = 'C:\\Users\\csdnc\\Documents';
    const merged = mergeWorkspaceRoot([ROUTER], other);
    expect(merged.roots).toEqual([ROUTER, other]);
  });

  it('空白 root ⇒ 原样返回且不标记改动（CS06：不臆造）', () => {
    expect(mergeWorkspaceRoot([ROUTER], '   ')).toEqual({
      roots: [ROUTER],
      changed: false,
      dropped: [],
    });
  });
});

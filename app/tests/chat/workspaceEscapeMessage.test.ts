/**
 * FIX-10（2026-10-27）：会话工作区严格边界的越界文案必须给出**允许根**。
 *
 * 真机（app.log 08:13–08:14，6 次）：`glob`/`file_read` 指向仓库根
 * `E:\PY\Documents\CODES\PY_APP`，会话工作区是 `C:\Users\...\LiriProjects\proj_*`
 * ⇒ 原文案只说"不在会话工作区内"，模型不知道能读哪里，继续猜绝对路径。
 */
import { describe, expect, it } from 'bun:test';

import { formatWorkspaceEscapeError } from '../../src/chat/services/ToolExecutionService';

describe('越界错误文案（FIX-10）', () => {
  it('必须给出可访问根与越界参数', () => {
    const text = formatWorkspaceEscapeError({
      argKey: 'path',
      argValue: 'E:\\PY\\Documents\\CODES\\PY_APP',
      workspace: 'C:\\Users\\csdnc\\Documents\\LiriProjects\\proj_x',
    });
    expect(text).toContain('路径越界');
    expect(text).toContain('path=E:\\PY\\Documents\\CODES\\PY_APP');
    expect(text).toContain(
      '本会话可访问根：C:\\Users\\csdnc\\Documents\\LiriProjects\\proj_x'
    );
    expect(text).toContain('请改用该根下的相对路径');
  });

  it('file_path 键同样适用（不硬编码 path）', () => {
    const text = formatWorkspaceEscapeError({
      argKey: 'file_path',
      argValue: 'E:\\x.ts',
      workspace: 'C:\\ws',
    });
    expect(text).toContain('file_path=E:\\x.ts');
    expect(text).toContain('C:\\ws');
  });
});

describe('越界错误文案（B1，2026-10-30，issue #35）', () => {
  const workspace = 'C:\\Users\\csdnc\\Documents\\LiriProjects\\proj_x';

  it('未传新参数 ⇒ 与改造前逐字一致（零行为变更）', () => {
    const text = formatWorkspaceEscapeError({
      argKey: 'path',
      argValue: 'E:\\out',
      workspace,
    });
    expect(text).not.toContain('另含');
    expect(text).not.toContain('审批申请');
  });

  it('多根：文案列出其余可访问根', () => {
    const text = formatWorkspaceEscapeError({
      argKey: 'path',
      argValue: 'D:\\secrets',
      workspace,
      roots: [workspace, 'E:\\PY\\Documents\\CODES\\PY_APP'],
      approvalRequested: true,
    });
    expect(text).toContain('另含：E:\\PY\\Documents\\CODES\\PY_APP');
  });

  it('已提交申请 ⇒ 告知模型批准后会重试（不要重复申请）', () => {
    const text = formatWorkspaceEscapeError({
      argKey: 'path',
      argValue: 'D:\\secrets',
      workspace,
      roots: [workspace],
      approvalRequested: true,
    });
    expect(text).toContain('审批申请');
    expect(text).toContain('自动重试');
  });

  it('申请未提交 ⇒ 明确要求向用户申请（不静默）', () => {
    const text = formatWorkspaceEscapeError({
      argKey: 'path',
      argValue: 'D:\\secrets',
      workspace,
      roots: [workspace],
      approvalRequested: false,
    });
    expect(text).toContain('向用户申请');
  });
});

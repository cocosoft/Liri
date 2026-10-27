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

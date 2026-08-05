// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * PermissionService — 统一权限门面（P1-4）
 *
 * 收敛两套真实生效的权限体系，对外提供单一入口：
 * - A. 工具执行权限：PermissionManager（规则/模式/自动分类器）→ canUseTool
 * - C. 沙箱文件权限：globalWorkspaceManager 默认工作区 → canAccessFile
 *
 * 新代码一律面向本门面编程，禁止直接 import 各子模块（防再碎片化）。
 */

import { PermissionManager } from './PermissionManager';
import { globalWorkspaceManager } from '../sandbox/WorkspaceManager';
import { SandboxPermission } from '../sandbox/SandboxTypes';
import { handleError } from '@modules/error';

export interface ToolAccessResult {
  allowed: boolean;
  reason?: string;
}

class PermissionServiceImpl {
  private permissionManager = PermissionManager.getInstance();

  /**
   * 工具执行权限（A）：走主权限模块完整决策链路
   * 规则匹配 → 权限模式 → 自动分类器；无规则时按默认行为（allow/deny 可配置）
   */
  async canUseTool(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<ToolAccessResult> {
    try {
      const result = await this.permissionManager.checkPermissionForTool(
        toolName,
        input
      );
      return { allowed: result.allowed, reason: result.reason };
    } catch (error) {
      // 权限检查异常 → fail-closed 拒绝（与 PERMISSION_DEFAULT_BEHAVIOR=deny 方向一致），
      // 错误经 handleError 统一记录到 ErrorTracker
      await handleError(error, {
        module: 'permission:service',
        action: 'check_tool_permission',
      });
      return { allowed: false, reason: 'permission check error, deny' };
    }
  }

  /**
   * 沙箱文件权限（C）：默认工作区是否拥有指定权限
   * 默认工作区不存在时拒绝（fail-closed）
   */
  canAccessFile(permission: SandboxPermission): boolean {
    try {
      const workspace = globalWorkspaceManager.get('default');
      return workspace ? workspace.hasPermission(permission) : false;
    } catch (error) {
      void handleError(error, {
        module: 'permission:service',
        action: 'check_file_permission',
      });
      return false;
    }
  }
}

export const permissionService = new PermissionServiceImpl();

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
 * 工作空间生命周期命令
 * 负责创建、重命名、删除、关闭工作空间
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { getLogger } from '@modules/monitoring';
import * as Registry from '../WorkspaceRegistry';
import * as Storage from '../WorkspaceStorage';

const logger = getLogger('Workspace');

export default {
  /**
   * 执行生命周期子命令
   * @param subcommand 子命令名: new | rename | delete | close
   * @param args 命令参数
   * @param context 命令上下文
   */
  async execute(
    subcommand: string,
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    try {
      switch (subcommand) {
        case 'new':
          return await this.handleNew(args);
        case 'close':
          return await this.handleClose();
        case 'rename':
          return await this.handleRename(args);
        case 'delete':
          return await this.handleDelete(args);
        default:
          return {
            success: false,
            type: 'error',
            error: `未知子命令: ${subcommand}`,
            message: `未知子命令: workspace ${subcommand}`,
          };
      }
    } catch (error) {
      logger.error(
        '工作空间生命周期命令执行失败',
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        success: false,
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
        message: `操作失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 新建工作空间
   * @param args 名称 或 名称 描述
   */
  async handleNew(args: string): Promise<CommandResult> {
    if (!args) {
      return {
        success: false,
        type: 'error',
        error: '请提供工作空间名称',
        message: '用法: /workspace new <名称> [描述]',
      };
    }

    const firstSpace = args.indexOf(' ');
    const name = firstSpace === -1 ? args : args.slice(0, firstSpace);
    const description = firstSpace === -1 ? '' : args.slice(firstSpace + 1);

    if (await Registry.findByName(name)) {
      return {
        success: false,
        type: 'error',
        error: `工作空间 "${name}" 已存在`,
        message: `工作空间 "${name}" 已存在。使用 /workspace open "${name}" 切换。`,
      };
    }

    const wsPath = await Storage.createWorkspace(name, description);
    await Registry.register(name, wsPath);

    logger.info(`工作空间已创建: ${name} (${wsPath})`);

    return {
      success: true,
      type: 'text',
      message: [
        `✓ 工作空间已创建: ${name}`,
        `路径: ${wsPath}`,
        `描述: ${description || '（无）'}`,
      ].join('\n'),
      data: { name, path: wsPath },
    };
  },

  /**
   * 关闭当前活动工作空间
   */
  async handleClose(): Promise<CommandResult> {
    const active = await Registry.getActive();

    if (!active) {
      return {
        success: true,
        type: 'text',
        message: '当前没有活动的工作空间。',
        data: { closed: false },
      };
    }

    await Registry.setActive(null);

    return {
      success: true,
      type: 'text',
      message: `✓ 工作空间 "${active}" 已关闭。`,
      data: { closed: true, name: active },
    };
  },

  /**
   * 重命名工作空间
   * @param args 旧名称 新名称
   */
  async handleRename(args: string): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
      return {
        success: false,
        type: 'error',
        error: '请提供旧名称和新名称',
        message: '用法: /workspace rename <旧名称> <新名称>',
      };
    }

    const oldName = parts[0];
    const newName = parts.slice(1).join(' ');

    const oldPath = await Registry.findByName(oldName);
    if (!oldPath) {
      return {
        success: false,
        type: 'error',
        error: `工作空间 "${oldName}" 不存在`,
        message: `未找到工作空间 "${oldName}"。`,
      };
    }

    if (await Registry.findByName(newName)) {
      return {
        success: false,
        type: 'error',
        error: `工作空间 "${newName}" 已存在`,
        message: `目标名称 "${newName}" 已存在，请选择其他名称。`,
      };
    }

    const root = await Registry.getDefaultRoot();
    const newPath = `${root}/${newName}`;

    await Storage.renameWorkspace(oldPath, newPath);
    await Storage.updateMeta(newPath, { name: newName });
    await Registry.rename(oldName, newName, newPath);

    logger.info(`工作空间已重命名: ${oldName} → ${newName}`);

    return {
      success: true,
      type: 'text',
      message: `✓ 工作空间已重命名: "${oldName}" → "${newName}"`,
      data: { oldName, newName, path: newPath },
    };
  },

  /**
   * 删除工作空间
   * @param name 工作空间名称
   */
  async handleDelete(name: string): Promise<CommandResult> {
    if (!name) {
      return {
        success: false,
        type: 'error',
        error: '请指定要删除的工作空间名称',
        message: '用法: /workspace delete <名称>',
      };
    }

    const wsPath = await Registry.findByName(name);

    if (!wsPath) {
      return {
        success: false,
        type: 'error',
        error: `工作空间 "${name}" 不存在`,
        message: `未找到工作空间 "${name}"。`,
      };
    }

    await Storage.deleteWorkspace(wsPath);
    await Registry.unregister(name);

    logger.info(`工作空间已删除: ${name} (${wsPath})`);

    return {
      success: true,
      type: 'text',
      message: `✓ 工作空间 "${name}" 已删除（路径: ${wsPath}）`,
      data: { name, path: wsPath },
    };
  },
};

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
 * 工作空间查询命令
 * 负责列出、查看详情、显示帮助
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import * as Registry from '../WorkspaceRegistry';
import * as Storage from '../WorkspaceStorage';

/**
 * 格式化日期为中文短格式
 */
function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return isoString;
  }
}

export default {
  /**
   * 执行查询子命令
   * @param subcommand 子命令名: list | info | help
   * @param args 命令参数
   * @param context 命令上下文
   */
  async execute(
    subcommand: string,
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    switch (subcommand) {
      case 'list':
        return await this.handleList();
      case 'info':
        return await this.handleInfo(args);
      case 'help':
        return this.handleHelp();
      default:
        return {
          success: false,
          type: 'error',
          error: `未知子命令: ${subcommand}`,
          message: `未知子命令: workspace ${subcommand}`,
        };
    }
  },

  /**
   * 列出所有工作空间
   */
  async handleList(): Promise<CommandResult> {
    const entries = await Storage.buildEntries();

    if (entries.length === 0) {
      const defaultRoot = await Registry.getDefaultRoot();
      return {
        success: true,
        type: 'text',
        message: [
          '暂无工作空间。',
          '',
          `工作空间根目录: ${defaultRoot}`,
          '使用 /workspace new <名称> 创建新工作空间。',
        ].join('\n'),
        data: { entries: [] },
      };
    }

    const lines: string[] = [
      `工作空间列表 (${entries.length} 个):`,
      '',
      '名称'.padEnd(16) + '文件'.padEnd(6) + '状态'.padEnd(6) + '更新时间',
      '-'.repeat(60),
    ];

    for (const entry of entries) {
      const name =
        entry.name.length > 14 ? entry.name.slice(0, 13) + '…' : entry.name;
      const status = entry.isActive ? '✓ 活动' : '';
      const date = formatDate(entry.meta.updatedAt);
      lines.push(
        `${name.padEnd(16)}${String(entry.fileCount).padEnd(6)}${status.padEnd(8)}${date}`
      );
    }

    return {
      success: true,
      type: 'text',
      message: lines.join('\n'),
      data: { entries },
    };
  },

  /**
   * 查看工作空间详情
   * @param name 工作空间名称，留空显示当前活动空间
   */
  async handleInfo(name: string): Promise<CommandResult> {
    let targetName: string | null = name || null;
    let wsPath: string | null;

    if (!targetName) {
      targetName = await Registry.getActive();
      if (!targetName) {
        return {
          success: true,
          type: 'text',
          message:
            '当前没有活动的工作空间。使用 /workspace info <名称> 查看指定工作空间。',
        };
      }
      wsPath = await Registry.findByName(targetName);
    } else {
      wsPath = await Registry.findByName(targetName);
    }

    if (!wsPath) {
      return {
        success: false,
        type: 'error',
        error: `工作空间 "${targetName}" 不存在`,
        message: `未找到工作空间 "${targetName}"。`,
      };
    }

    const meta = await Storage.readMeta(wsPath);
    if (!meta) {
      return {
        success: false,
        type: 'error',
        error: `工作空间 "${targetName}" 元数据损坏`,
        message: `工作空间 "${targetName}" 的元数据文件缺失或损坏。`,
      };
    }

    const fileCount = await Storage.countFiles(wsPath);
    const activeName = await Registry.getActive();
    const isActive = targetName === activeName;

    const lines = [
      `工作空间详情: ${meta.name}`,
      '─'.repeat(40),
      `ID:       ${meta.id}`,
      `路径:     ${wsPath}`,
      `状态:     ${isActive ? '✓ 活动' : '非活动'}`,
      `创建时间: ${formatDate(meta.createdAt)}`,
      `更新时间: ${formatDate(meta.updatedAt)}`,
      `文件数:   ${fileCount}`,
      `描述:     ${meta.description || '（无）'}`,
    ];

    return {
      success: true,
      type: 'text',
      message: lines.join('\n'),
      data: { name: meta.name, path: wsPath, meta, fileCount, isActive },
    };
  },

  /**
   * 显示帮助信息
   */
  handleHelp(): CommandResult {
    const help = [
      '工作空间命令用法',
      '================',
      '',
      '管理用户工作空间，每个工作空间对应 ~/workspace/ 下的一个物理文件夹。',
      '',
      '命令:',
      '  /workspace list              - 列出所有工作空间',
      '  /workspace new <名称> [描述]  - 创建新工作空间',
      '  /workspace open <名称>        - 切换活动工作空间',
      '  /workspace close             - 关闭当前活动空间',
      '  /workspace rename <旧> <新>   - 重命名工作空间',
      '  /workspace delete <名称>      - 删除工作空间',
      '  /workspace info [名称]        - 查看工作空间详情',
      '  /workspace help              - 显示此帮助',
      '',
      '示例:',
      '  /workspace list',
      '  /workspace new 重构认证模块 重构OAuth流程',
      '  /workspace open 重构认证模块',
      '  /workspace delete 旧项目',
    ].join('\n');

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};

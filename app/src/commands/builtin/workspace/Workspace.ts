/**
 * 工作区命令实现
 * 管理工作空间：创建、列出、切换、重命名、删除、查看详情
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { getLogger } from '@modules/monitoring';
import * as Registry from './WorkspaceRegistry';
import * as Storage from './WorkspaceStorage';

const logger = getLogger('Workspace');

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
   * 执行工作区命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const subcommand = (parts[0] || 'list').toLowerCase();
    const rest = parts.slice(1).join(' ');

    try {
      switch (subcommand) {
        case 'list':
          return await this.handleList();
        case 'open':
          return await this.handleOpen(rest);
        case 'new':
          return await this.handleNew(rest);
        case 'close':
          return await this.handleClose();
        case 'rename':
          return await this.handleRename(rest);
        case 'delete':
          return await this.handleDelete(rest);
        case 'info':
          return await this.handleInfo(rest);
        case 'help':
        default:
          return this.handleHelp();
      }
    } catch (error) {
      logger.error(
        '工作空间命令执行失败',
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
   * 打开/切换到指定工作空间
   * @param target 工作空间名称
   */
  async handleOpen(target: string): Promise<CommandResult> {
    if (!target) {
      return {
        success: false,
        type: 'error',
        error: '请指定工作空间名称',
        message: '用法: /workspace open <名称>',
      };
    }

    const wsPath = await Registry.findByName(target);

    if (!wsPath) {
      return {
        success: false,
        type: 'error',
        error: `工作空间 "${target}" 不存在`,
        message: `未找到工作空间 "${target}"。使用 /workspace list 查看所有工作空间。`,
      };
    }

    await Registry.setActive(target);

    logger.info(`工作空间已切换: ${target} (${wsPath})`);

    return {
      success: true,
      type: 'text',
      message: [`✓ 已切换到工作空间: ${target}`, `路径: ${wsPath}`].join('\n'),
      data: { name: target, path: wsPath },
    };
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

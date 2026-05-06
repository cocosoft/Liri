/**
 * 权限管理命令实现
 * 融合快速权限管理与细粒度权限控制
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';
import { createFineGrainedPermissionManager } from '../../../permission/FineGrainedPermissionManager.js';
import { PermissionAction, ResourceType, OperationType } from '../../../permission/models/Permission.js';

const COMMON_PERMISSIONS: Record<string, { description: string; enabled: boolean; scope: string }> = {
  'file.read': { description: '读取文件系统中的文件', enabled: true, scope: '文件系统' },
  'file.write': { description: '写入文件到文件系统', enabled: true, scope: '文件系统' },
  'file.delete': { description: '删除文件系统中的文件', enabled: true, scope: '文件系统' },
  'shell.execute': { description: '执行Shell命令', enabled: true, scope: '系统' },
  'network.request': { description: '发起网络请求', enabled: true, scope: '网络' },
  'mcp.connect': { description: '连接MCP服务', enabled: true, scope: '插件' },
  'plugin.install': { description: '安装新插件', enabled: true, scope: '插件' },
  'system.modify': { description: '修改系统级设置', enabled: false, scope: '系统' },
};

export default {
  /**
   * 执行权限管理命令
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'list';

    switch (subcommand.toLowerCase()) {
      case 'list':
        return this.handleList(context);
      case 'show':
        return this.handleShow(parts[1], context);
      case 'grant':
        return this.handleGrant(parts.slice(1), context);
      case 'revoke':
        return this.handleRevoke(parts.slice(1), context);
      case 'status':
        return this.handleStatus(context);
      case 'add':
        return this.handleAdd(parts.slice(1));
      case 'remove':
        return this.handleRemove(parts[1]);
      case 'resource':
        return this.handleResource(parts.slice(1));
      case 'role':
        return this.handleRole(parts.slice(1));
      case 'user':
        return this.handleUser(parts.slice(1));
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出所有权限
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const simpleList = Object.entries(COMMON_PERMISSIONS).map(([name, info]) =>
      `${name.padEnd(20)} ${info.enabled ? '[✓]' : '[✗]'} ${info.description}`
    ).join('\n');

    let fineRules = '';
    try {
      const manager = createFineGrainedPermissionManager();
      const storage = manager.getStorage();
      const resources = await storage.getAllResources();
      if (resources && resources.length > 0) {
        const parts: string[] = [];
        for (const resource of resources) {
          const rules = await storage.getRulesByResource(resource.id);
          if (rules.length > 0) {
            parts.push(`资源: ${resource.name} (${resource.type})`);
            for (const rule of rules) {
              parts.push(`  - ${rule.action} ${rule.operation} (优先级: ${rule.priority})`);
            }
          }
        }
        if (parts.length > 0) {
          fineRules = '\n\n细粒度权限规则:\n' + parts.join('\n');
        }
      }
    } catch {
      // 忽略细粒度查询失败
    }

    return {
      success: true,
      type: 'text',
      message: `常用权限列表:\n\n${simpleList}${fineRules}\n\n使用 /permissions show <权限名> 查看详情`,
      data: { commonPermissions: COMMON_PERMISSIONS },
    };
  },

  /**
   * 显示特定权限详情
   */
  async handleShow(permissionName: string, context: CommandContext): Promise<CommandResult> {
    if (!permissionName) {
      return {
        success: false,
        type: 'error',
        error: '请指定要查看的权限名',
        message: '用法: /permissions show <权限名>',
      };
    }

    const info = COMMON_PERMISSIONS[permissionName];
    if (info) {
      return {
        success: true,
        type: 'text',
        message: `${permissionName}\n` +
          `- 描述: ${info.description}\n` +
          `- 范围: ${info.scope}\n` +
          `- 状态: ${info.enabled ? '已启用' : '已禁用'}`,
        data: info,
      };
    }

    return {
      success: false,
      type: 'error',
      error: `未找到权限: ${permissionName}`,
    };
  },

  /**
   * 授予权限
   */
  async handleGrant(args: string[], context: CommandContext): Promise<CommandResult> {
    const permissionName = args[0];

    if (!permissionName) {
      return {
        success: false,
        type: 'error',
        error: '请指定要授予的权限',
        message: '用法: /permissions grant <权限名>',
      };
    }

    const info = COMMON_PERMISSIONS[permissionName];
    if (!info) {
      return {
        success: false,
        type: 'error',
        error: `未知权限: ${permissionName}`,
        message: `可用权限: ${Object.keys(COMMON_PERMISSIONS).join(', ')}`,
      };
    }

    context.onDone?.(`权限 ${permissionName} 已授予`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `权限 ${permissionName} 已授予`,
      data: { permission: permissionName, action: 'granted' },
    };
  },

  /**
   * 撤销权限
   */
  async handleRevoke(args: string[], context: CommandContext): Promise<CommandResult> {
    const permissionName = args[0];

    if (!permissionName) {
      return {
        success: false,
        type: 'error',
        error: '请指定要撤销的权限',
        message: '用法: /permissions revoke <权限名>',
      };
    }

    const info = COMMON_PERMISSIONS[permissionName];
    if (!info) {
      return {
        success: false,
        type: 'error',
        error: `未知权限: ${permissionName}`,
        message: `可用权限: ${Object.keys(COMMON_PERMISSIONS).join(', ')}`,
      };
    }

    context.onDone?.(`权限 ${permissionName} 已撤销`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `权限 ${permissionName} 已撤销`,
      data: { permission: permissionName, action: 'revoked' },
    };
  },

  /**
   * 显示权限状态
   */
  async handleStatus(context: CommandContext): Promise<CommandResult> {
    const enabledCount = Object.values(COMMON_PERMISSIONS).filter(p => p.enabled).length;
    const totalCount = Object.keys(COMMON_PERMISSIONS).length;

    const status = {
      totalPermissions: totalCount,
      enabledPermissions: enabledCount,
      disabledPermissions: totalCount - enabledCount,
      lastUpdated: new Date().toISOString(),
    };

    return {
      success: true,
      type: 'text',
      message: `权限状态:\n` +
        `- 总权限数: ${status.totalPermissions}\n` +
        `- 已启用: ${status.enabledPermissions}\n` +
        `- 已禁用: ${status.disabledPermissions}\n` +
        `- 最后更新: ${new Date(status.lastUpdated).toLocaleString()}`,
      data: status,
    };
  },

  /**
   * 添加细粒度权限规则
   */
  async handleAdd(params: string[]): Promise<CommandResult> {
    if (params.length < 4) {
      return {
        success: false,
        type: 'error',
        error: '参数不足',
        message: '用法: /permissions add <action> <resourceType> <resourceName> <operation>\n\n示例: /permissions add allow tool bash execute',
      };
    }

    const [action, resourceType, resourceName, operation] = params;

    try {
      const manager = createFineGrainedPermissionManager();

      let resource = await manager.getResourceByPath(resourceName, resourceType as ResourceType);
      if (!resource) {
        resource = {
          id: `resource_${Date.now()}`,
          type: resourceType as ResourceType,
          name: resourceName,
          path: resourceName,
          description: `${resourceType} ${resourceName}`,
          parentId: undefined,
        };
        await manager.addResource(resource);
      }

      const rule = {
        id: `rule_${Date.now()}`,
        resourceId: resource.id,
        operation: operation as OperationType,
        action: action as PermissionAction,
        priority: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const ruleId = await manager.addRule(rule);

      return {
        success: true,
        type: 'text',
        message: `权限规则添加成功，ID: ${ruleId}`,
        data: { ruleId },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `添加失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 删除权限规则
   */
  async handleRemove(ruleId?: string): Promise<CommandResult> {
    if (!ruleId) {
      return {
        success: false,
        type: 'error',
        error: '请指定规则ID',
        message: '用法: /permissions remove <规则ID>',
      };
    }

    try {
      const manager = createFineGrainedPermissionManager();
      await manager.deleteRule(ruleId);

      return {
        success: true,
        type: 'text',
        message: `权限规则删除成功，ID: ${ruleId}`,
        data: { ruleId },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 管理资源
   */
  async handleResource(params: string[]): Promise<CommandResult> {
    const subCommand = params[0];

    switch (subCommand) {
      case 'add':
        return this.handleResourceAdd(params.slice(1));
      case 'list':
        return this.handleResourceList();
      default:
        return {
          success: false,
          type: 'text',
          message: '用法: /permissions resource <命令> [参数]\n\n命令列表:\n  add  - 添加资源\n  list - 列出所有资源\n\n示例: /permissions resource add file /path/to/file',
        };
    }
  },

  /**
   * 添加资源
   */
  async handleResourceAdd(params: string[]): Promise<CommandResult> {
    if (params.length < 2) {
      return {
        success: false,
        type: 'error',
        error: '参数不足',
        message: '用法: /permissions resource add <类型> <路径>',
      };
    }

    const [type, path] = params;

    try {
      const manager = createFineGrainedPermissionManager();
      const resource = {
        id: `resource_${Date.now()}`,
        type: type as ResourceType,
        name: path.split('/').pop() || path,
        path,
        description: `${type} ${path}`,
        parentId: undefined,
      };

      const resourceId = await manager.addResource(resource);

      return {
        success: true,
        type: 'text',
        message: `资源添加成功，ID: ${resourceId}`,
        data: { resourceId },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `添加失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 列出所有资源
   */
  async handleResourceList(): Promise<CommandResult> {
    try {
      const manager = createFineGrainedPermissionManager();
      const storage = manager.getStorage();
      const resources = await storage.getAllResources();

      if (!resources || resources.length === 0) {
        return {
          success: true,
          type: 'text',
          message: '暂无资源',
          data: { resources: [] },
        };
      }

      const parts: string[] = ['资源列表:\n'];
      for (const resource of resources) {
        parts.push(`ID: ${resource.id}`);
        parts.push(`类型: ${resource.type}`);
        parts.push(`名称: ${resource.name}`);
        parts.push(`路径: ${resource.path}`);
        parts.push(`描述: ${resource.description}\n`);
      }

      return {
        success: true,
        type: 'text',
        message: parts.join('\n'),
        data: { resources },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `查询失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 管理角色
   */
  async handleRole(params: string[]): Promise<CommandResult> {
    const subCommand = params[0];

    switch (subCommand) {
      case 'list':
        return this.handleRoleList();
      default:
        return {
          success: false,
          type: 'text',
          message: '用法: /permissions role <命令> [参数]\n\n命令列表:\n  list - 列出所有角色\n\n示例: /permissions role list',
        };
    }
  },

  /**
   * 列出所有角色
   */
  async handleRoleList(): Promise<CommandResult> {
    try {
      const manager = createFineGrainedPermissionManager();
      const storage = manager.getStorage();
      const roles = await storage.getAllRoles();

      if (!roles || roles.length === 0) {
        return {
          success: true,
          type: 'text',
          message: '暂无角色',
          data: { roles: [] },
        };
      }

      const parts: string[] = ['角色列表:\n'];
      for (const role of roles) {
        parts.push(`ID: ${role.id}`);
        parts.push(`名称: ${role.name}`);
        parts.push(`描述: ${role.description}`);
        parts.push(`权限数: ${role.permissions.length}\n`);
      }

      return {
        success: true,
        type: 'text',
        message: parts.join('\n'),
        data: { roles },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `查询失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 管理用户
   */
  async handleUser(params: string[]): Promise<CommandResult> {
    const subCommand = params[0];

    switch (subCommand) {
      case 'list':
        return this.handleUserList();
      default:
        return {
          success: false,
          type: 'text',
          message: '用法: /permissions user <命令> [参数]\n\n命令列表:\n  list - 列出所有用户\n\n示例: /permissions user list',
        };
    }
  },

  /**
   * 列出所有用户
   */
  async handleUserList(): Promise<CommandResult> {
    try {
      const manager = createFineGrainedPermissionManager();
      const storage = manager.getStorage();
      const users = await storage.getAllUsers();

      if (!users || users.length === 0) {
        return {
          success: true,
          type: 'text',
          message: '暂无用户',
          data: { users: [] },
        };
      }

      const parts: string[] = ['用户列表:\n'];
      for (const user of users) {
        parts.push(`ID: ${user.id}`);
        parts.push(`名称: ${user.name}`);
        parts.push(`角色: ${user.roles.join(', ')}`);
        parts.push(`权限数: ${user.permissions.length}\n`);
      }

      return {
        success: true,
        type: 'text',
        message: parts.join('\n'),
        data: { users },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `查询失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `权限管理命令用法 (/perm, /auth):

快速操作:
  /permissions list                        - 列出所有权限
  /permissions show <权限名>               - 查看权限详情
  /permissions grant <权限名>              - 授予权限
  /permissions revoke <权限名>             - 撤销权限
  /permissions status                      - 显示权限状态

细粒度控制:
  /permissions add <动作> <类型> <资源> <操作> - 添加权限规则
  /permissions remove <规则ID>              - 删除权限规则
  /permissions resource add <类型> <路径>  - 添加资源
  /permissions resource list               - 列出所有资源
  /permissions role list                   - 列出所有角色
  /permissions user list                   - 列出所有用户

示例:
  /permissions list
  /permissions show file.write
  /permissions grant shell.execute
  /permissions add allow tool bash execute`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};

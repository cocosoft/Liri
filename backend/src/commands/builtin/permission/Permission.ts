import type { CommandContext } from '../../types/index.js';
import { createFineGrainedPermissionManager } from '../../../permission/FineGrainedPermissionManager.js';
import {
  PermissionAction,
  ResourceType,
  OperationType,
  RoleType,
} from '../../../permission/models/Permission.js';

/**
 * Permission命令
 * 管理细粒度权限控制
 */
const permissionCommand = {
  async call(args: string, context: CommandContext) {
    // 解析参数
    const params = args.trim().split(' ');
    const command = params[0];

    switch (command) {
      case 'add':
        return this.addRule(params.slice(1));
      case 'remove':
        return this.removeRule(params[1]);
      case 'list':
        return this.listRules();
      case 'resource':
        return this.manageResource(params.slice(1));
      case 'role':
        return this.manageRole(params.slice(1));
      case 'user':
        return this.manageUser(params.slice(1));
      default:
        return {
          type: 'text' as const,
          value:
            '用法: /permission <命令> [参数]\n\n命令列表:\n  add - 添加权限规则\n  remove - 删除权限规则\n  list - 列出所有权限规则\n  resource - 管理资源\n  role - 管理角色\n  user - 管理用户\n\n示例: /permission add allow tool bash execute',
        };
    }
  },

  async addRule(params: string[]) {
    if (params.length < 4) {
      return {
        type: 'text' as const,
        value:
          '用法: /permission add <action> <resourceType> <resourceName> <operation>\n\n示例: /permission add allow tool bash execute',
      };
    }

    const [action, resourceType, resourceName, operation] = params;

    try {
      const manager = createFineGrainedPermissionManager();

      // 检查资源是否存在
      let resource = await manager.getResourceByPath(
        resourceName,
        resourceType as ResourceType
      );
      if (!resource) {
        // 创建资源
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

      // 创建规则
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
        type: 'text' as const,
        value: `权限规则添加成功，ID: ${ruleId}`,
      };
    } catch (error) {
      return {
        type: 'text' as const,
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  async removeRule(ruleId?: string) {
    if (!ruleId) {
      return {
        type: 'text' as const,
        value: '用法: /permission remove <规则ID>',
      };
    }

    try {
      const manager = createFineGrainedPermissionManager();
      await manager.deleteRule(ruleId);

      return {
        type: 'text' as const,
        value: `权限规则删除成功，ID: ${ruleId}`,
      };
    } catch (error) {
      return {
        type: 'text' as const,
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  async listRules() {
    try {
      const manager = createFineGrainedPermissionManager();
      const storage = manager.getStorage();

      const resources = await storage.getAllResources();

      let rulesText = `权限规则列表:\n\n`;

      if (resources && resources.length > 0) {
        for (const resource of resources) {
          const rules = await storage.getRulesByResource(resource.id);
          if (rules.length > 0) {
            rulesText += `资源: ${resource.name} (${resource.type})\n`;
            for (const rule of rules) {
              rulesText += `  - ${rule.action} ${rule.operation} (优先级: ${rule.priority})\n`;
            }
            rulesText += `\n`;
          }
        }
      }

      return {
        type: 'text' as const,
        value: rulesText,
      };
    } catch (error) {
      return {
        type: 'text' as const,
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  async manageResource(params: string[]) {
    const subCommand = params[0];

    switch (subCommand) {
      case 'add':
        return this.addResource(params.slice(1));
      case 'list':
        return this.listResources();
      default:
        return {
          type: 'text' as const,
          value:
            '用法: /permission resource <命令> [参数]\n\n命令列表:\n  add - 添加资源\n  list - 列出所有资源\n\n示例: /permission resource add file /path/to/file',
        };
    }
  },

  async addResource(params: string[]) {
    if (params.length < 2) {
      return {
        type: 'text' as const,
        value: '用法: /permission resource add <类型> <路径>',
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
        type: 'text' as const,
        value: `资源添加成功，ID: ${resourceId}`,
      };
    } catch (error) {
      return {
        type: 'text' as const,
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  async listResources() {
    try {
      const manager = createFineGrainedPermissionManager();
      const storage = manager.getStorage();

      const resources = await storage.getAllResources();

      let resourcesText = `资源列表:\n\n`;

      if (resources && resources.length > 0) {
        for (const resource of resources) {
          resourcesText += `ID: ${resource.id}\n`;
          resourcesText += `类型: ${resource.type}\n`;
          resourcesText += `名称: ${resource.name}\n`;
          resourcesText += `路径: ${resource.path}\n`;
          resourcesText += `描述: ${resource.description}\n\n`;
        }
      }

      return {
        type: 'text' as const,
        value: resourcesText,
      };
    } catch (error) {
      return {
        type: 'text' as const,
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  async manageRole(params: string[]) {
    const subCommand = params[0];

    switch (subCommand) {
      case 'list':
        return this.listRoles();
      default:
        return {
          type: 'text' as const,
          value:
            '用法: /permission role <命令> [参数]\n\n命令列表:\n  list - 列出所有角色\n\n示例: /permission role list',
        };
    }
  },

  async listRoles() {
    try {
      const manager = createFineGrainedPermissionManager();
      const storage = manager.getStorage();

      const roles = await storage.getAllRoles();

      let rolesText = `角色列表:\n\n`;

      if (roles && roles.length > 0) {
        for (const role of roles) {
          rolesText += `ID: ${role.id}\n`;
          rolesText += `名称: ${role.name}\n`;
          rolesText += `描述: ${role.description}\n`;
          rolesText += `权限数: ${role.permissions.length}\n\n`;
        }
      }

      return {
        type: 'text' as const,
        value: rolesText,
      };
    } catch (error) {
      return {
        type: 'text' as const,
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  async manageUser(params: string[]) {
    const subCommand = params[0];

    switch (subCommand) {
      case 'list':
        return this.listUsers();
      default:
        return {
          type: 'text' as const,
          value:
            '用法: /permission user <命令> [参数]\n\n命令列表:\n  list - 列出所有用户\n\n示例: /permission user list',
        };
    }
  },

  async listUsers() {
    try {
      const manager = createFineGrainedPermissionManager();
      const storage = manager.getStorage();

      const users = await storage.getAllUsers();

      let usersText = `用户列表:\n\n`;

      if (users && users.length > 0) {
        for (const user of users) {
          usersText += `ID: ${user.id}\n`;
          usersText += `名称: ${user.name}\n`;
          usersText += `角色: ${user.roles.join(', ')}\n`;
          usersText += `权限数: ${user.permissions.length}\n\n`;
        }
      }

      return {
        type: 'text' as const,
        value: usersText,
      };
    } catch (error) {
      return {
        type: 'text' as const,
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },
};

export default permissionCommand;

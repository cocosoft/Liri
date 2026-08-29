/**
 * 权限管理命令实现
 * 融合快速权限管理与细粒度权限控制
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { createFineGrainedPermissionManager } from '@modules/permission/FineGrainedPermissionManager.js';
import {
  PermissionAction,
  ResourceType,
  OperationType,
} from '@modules/permission/Permission.js';
import { PERMISSION_MODES, PERMISSION_MODE_NAMES } from '@modules/permission';
import { permissionModeIntegrationService } from '@modules/chat/services/PermissionModeIntegrationService.js';
import { completeSecuritySystem } from '@modules/security';

import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:builtin:permissions:Permissions');

const COMMON_PERMISSIONS: Record<
  string,
  { description: string; enabled: boolean; scope: string }
> = {
  'file.read': {
    description: '读取文件系统中的文件',
    enabled: true,
    scope: '文件系统',
  },
  'file.write': {
    description: '写入文件到文件系统',
    enabled: true,
    scope: '文件系统',
  },
  'file.delete': {
    description: '删除文件系统中的文件',
    enabled: true,
    scope: '文件系统',
  },
  'shell.execute': {
    description: '执行Shell命令',
    enabled: true,
    scope: '系统',
  },
  'network.request': {
    description: '发起网络请求',
    enabled: true,
    scope: '网络',
  },
  'mcp.connect': { description: '连接MCP服务', enabled: true, scope: '插件' },
  'plugin.install': { description: '安装新插件', enabled: true, scope: '插件' },
  'system.modify': {
    description: '修改系统级设置',
    enabled: false,
    scope: '系统',
  },
};

const permissionsCommand = {
  /**
   * 执行权限管理命令
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const trimmed = args.trim();

    if (trimmed === '-h' || trimmed === '--help' || trimmed === 'help') {
      return showHelp();
    }

    const parts = trimmed.split(' ');
    const subcommand = parts[0] || 'list';
    const rest = parts.slice(1);
    const useJson = rest.includes('--json');

    if (useJson) {
      const idx = rest.indexOf('--json');
      rest.splice(idx, 1);
    }

    switch (subcommand.toLowerCase()) {
      case 'list':
        return handleList(context);
      case 'show':
        return handleShow(rest[0], context);
      case 'grant':
        return handleGrant(rest, context);
      case 'revoke':
        return handleRevoke(rest, context);
      case 'status':
        return handleStatus(context, useJson);
      case 'mode':
        return handleMode(rest, useJson);
      case 'rules':
        return handleRules(useJson);
      case 'add':
        return handleAdd(rest);
      case 'remove':
        return handleRemove(rest[0]);
      case 'resource':
        return handleResource(rest);
      case 'role':
        return handleRole(rest);
      case 'user':
        return handleUser(rest);
      case 'help':
        return showHelp();
      default:
        return showHelp();
    }
  },
};

/**
 * 显示帮助信息
 */
function showHelp(): CommandResult {
  const help = `Permissions 命令使用帮助

用法:
  /permissions list                    - 列出所有权限
  /permissions show <权限名>           - 查看权限详情
  /permissions grant <权限名>          - 授予权限
  /permissions revoke <权限名>         - 撤销权限
  /permissions status [--json]         - 显示权限状态
  /permissions mode [show|set <模式>]  - 权限模式管理
  /permissions rules [--json]          - 查看会话权限规则
  /permissions add <动作> <类型> <资源> <操作> - 添加细粒度权限规则
  /permissions remove <规则ID>          - 删除细粒度权限规则
  /permissions resource add <类型> <路径> - 添加资源
  /permissions resource list            - 列出所有资源
  /permissions role list                - 列出所有角色
  /permissions user list                - 列出所有用户
  /permissions help                     - 显示此帮助

权限模式 (信任光谱):
  plan         - 计划模式，拒绝所有执行操作，仅允许只读
  default      - 默认模式，AI先评估，危险操作询问用户
  acceptEdits  - 接受编辑，自动允许编辑类工具
  bypass       - 绕过模式，跳过所有权限检查

别名: /perm, /auth, /permission

  `;

  return { success: true, message: help };
}

/**
 * 列出所有权限
 */
async function handleList(context: CommandContext): Promise<CommandResult> {
  try {
    const { logEvent } = await import('@modules/services/analytics/index.js');
    logEvent('tengu_permissions_list');
  } catch (err) {
    // analytics 非关键

    handleError(err, {
      module: 'commands:builtin:permissions:Permissions',
      action: 'analyticsNonCritical',
    });
  }

  const simpleList = Object.entries(COMMON_PERMISSIONS)
    .map(
      ([name, info]) =>
        `${name.padEnd(20)} ${info.enabled ? '[✓]' : '[✗]'} ${info.description}`
    )
    .join('\n');

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
            parts.push(
              `  - ${rule.action} ${rule.operation} (优先级: ${rule.priority})`
            );
          }
        }
      }
      if (parts.length > 0) {
        fineRules = '\n\n细粒度权限规则:\n' + parts.join('\n');
      }
    }
  } catch (err) {
    // 忽略细粒度查询失败

    handleError(err, {
      module: 'commands:builtin:permissions:Permissions',
      action: 'ignoreFineGrainedQueryFailed',
    });
  }

  const mode = permissionModeIntegrationService.getPermissionMode();
  const modeInfo = mode
    ? `\n当前权限模式: ${(PERMISSION_MODE_NAMES as Record<string, string>)[mode] || mode}`
    : '';

  return {
    success: true,
    message: `常用权限列表:${modeInfo}\n\n${simpleList}${fineRules}\n\n使用 /permissions show <权限名> 查看详情\n使用 /permissions mode 查看或切换权限模式`,
  };
}

/**
 * 显示特定权限详情
 */
async function handleShow(
  permissionName?: string,
  _context?: CommandContext
): Promise<CommandResult> {
  if (!permissionName) {
    return { success: false, message: '用法: /permissions show <权限名>' };
  }

  const info = COMMON_PERMISSIONS[permissionName];
  if (info) {
    return {
      success: true,
      message:
        `${permissionName}\n` +
        `- 描述: ${info.description}\n` +
        `- 范围: ${info.scope}\n` +
        `- 状态: ${info.enabled ? '已启用' : '已禁用'}`,
    };
  }

  return {
    success: false,
    message: `未找到权限: ${permissionName}\n可用权限: ${Object.keys(COMMON_PERMISSIONS).join(', ')}`,
  };
}

/**
 * 授予权限
 */
async function handleGrant(
  args: string[],
  context: CommandContext
): Promise<CommandResult> {
  const permissionName = args[0];

  if (!permissionName) {
    return { success: false, message: '用法: /permissions grant <权限名>' };
  }

  const info = COMMON_PERMISSIONS[permissionName];
  if (!info) {
    return {
      success: false,
      message: `未知权限: ${permissionName}\n可用权限: ${Object.keys(COMMON_PERMISSIONS).join(', ')}`,
    };
  }

  try {
    const permissionManager =
      completeSecuritySystem.getPermissionManager() as unknown as {
        addRule: (action: string, name: string) => void;
      };
    permissionManager.addRule('allow', permissionName);
  } catch (err) {
    // 忽略管理器调用失败

    handleError(err, {
      module: 'commands:builtin:permissions:Permissions',
      action: 'ignoreManagerCallFailed',
    });
  }

  context.onDone?.(`权限 ${permissionName} 已授予`, { display: 'system' });

  return { success: true, message: `权限 ${permissionName} 已授予` };
}

/**
 * 撤销权限
 */
async function handleRevoke(
  args: string[],
  context: CommandContext
): Promise<CommandResult> {
  const permissionName = args[0];

  if (!permissionName) {
    return { success: false, message: '用法: /permissions revoke <权限名>' };
  }

  const info = COMMON_PERMISSIONS[permissionName];
  if (!info) {
    return {
      success: false,
      message: `未知权限: ${permissionName}\n可用权限: ${Object.keys(COMMON_PERMISSIONS).join(', ')}`,
    };
  }

  try {
    const permissionManager =
      completeSecuritySystem.getPermissionManager() as unknown as Record<
        string,
        unknown
      >;
    const rules = (permissionManager.getRules as Function)() as unknown[];
    for (const r of rules) {
      const rule = r as Record<string, unknown>;
      if (rule.toolName === permissionName || rule.name === permissionName) {
        (permissionManager.removeRule as Function)(rule.id);
      }
    }
  } catch (err) {
    // 忽略

    handleError(err, {
      module: 'commands:builtin:permissions:Permissions',
      action: 'ignoreError',
    });
  }

  context.onDone?.(`权限 ${permissionName} 已撤销`, { display: 'system' });

  return { success: true, message: `权限 ${permissionName} 已撤销` };
}

/**
 * 显示权限状态
 */
async function handleStatus(
  _context: CommandContext,
  useJson: boolean = false
): Promise<CommandResult> {
  const enabledCount = Object.values(COMMON_PERMISSIONS).filter(
    (p) => p.enabled
  ).length;
  const totalCount = Object.keys(COMMON_PERMISSIONS).length;
  const currentMode = permissionModeIntegrationService.getPermissionMode();
  const status = {
    totalPermissions: totalCount,
    enabledPermissions: enabledCount,
    disabledPermissions: totalCount - enabledCount,
    currentMode: currentMode || 'default',
    lastUpdated: new Date().toISOString(),
  };

  try {
    const { logEvent } = await import('@modules/services/analytics/index.js');
    logEvent('tengu_permissions_status', {
      total: totalCount,
      enabled: enabledCount,
    });
  } catch (err) {
    // analytics 非关键

    handleError(err, {
      module: 'commands:builtin:permissions:Permissions',
      action: 'analyticsNonCritical',
    });
  }

  if (useJson) {
    return { success: true, message: JSON.stringify(status, null, 2) };
  }

  return {
    success: true,
    message:
      `权限状态:\n` +
      `- 总权限数: ${status.totalPermissions}\n` +
      `- 已启用: ${status.enabledPermissions}\n` +
      `- 已禁用: ${status.disabledPermissions}\n` +
      `- 权限模式: ${status.currentMode} (${PERMISSION_MODE_NAMES[status.currentMode as keyof typeof PERMISSION_MODE_NAMES] || '未知'})\n` +
      `- 最后更新: ${new Date(status.lastUpdated).toLocaleString()}`,
  };
}

/**
 * 管理权限模式
 */
async function handleMode(
  args: string[],
  useJson: boolean = false
): Promise<CommandResult> {
  const currentMode = permissionModeIntegrationService.getPermissionMode();

  if (args.length === 0 || args[0] === 'show') {
    const validModes = PERMISSION_MODES.map((m) =>
      m === currentMode ? `  * ${m} (当前)` : `    ${m}`
    ).join('\n');

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          { currentMode, availableModes: PERMISSION_MODES },
          null,
          2
        ),
      };
    }

    return {
      success: true,
      message: `权限模式:\n\n当前模式: ${currentMode || 'default'}\n\n可用模式:\n${validModes}\n\n使用 /permissions mode set <模式名> 切换模式`,
    };
  }

  if (args[0] === 'set' && args[1]) {
    const targetMode = args[1];
    const targetModeTyped = targetMode as (typeof PERMISSION_MODES)[number];
    if (!PERMISSION_MODES.includes(targetModeTyped)) {
      return {
        success: false,
        message: `无效的权限模式: ${targetMode}\n可用模式: ${PERMISSION_MODES.join(', ')}`,
      };
    }

    try {
      permissionModeIntegrationService.setPermissionMode(targetModeTyped);
      completeSecuritySystem.setPermissionMode(targetModeTyped);

      return {
        success: true,
        message: `权限模式已切换为: ${targetMode} (${PERMISSION_MODE_NAMES[targetMode as keyof typeof PERMISSION_MODE_NAMES] || targetMode})`,
      };
    } catch (error) {
      return {
        success: false,
        message: `切换失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  return {
    success: false,
    message:
      '用法: /permissions mode [show|set <模式>]\n\n示例:\n  /permissions mode          显示当前模式\n  /permissions mode show     显示当前模式\n  /permissions mode set plan 切换到计划模式',
  };
}

/**
 * 查看会话权限规则
 */
async function handleRules(useJson: boolean = false): Promise<CommandResult> {
  try {
    const permissionManager =
      completeSecuritySystem.getPermissionManager() as unknown as Record<
        string,
        unknown
      >;
    const mode = (permissionManager.getMode as Function)() as string;
    const rules = (permissionManager.getRules as Function)() as unknown[];

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          { mode, rules, ruleCount: rules.length },
          null,
          2
        ),
      };
    }

    const sorted = rules.reduce(
      (acc: Record<string, string[]>, rule: unknown) => {
        const r = rule as Record<string, unknown>;
        const behavior = (r.behavior || r.action || 'unknown') as string;
        const name = (r.toolName || r.name || r.id) as string;
        if (!acc[behavior]) acc[behavior] = [];
        const detail = r.contentPattern
          ? `${name}(${r.contentPattern as string})`
          : name;
        acc[behavior].push(`  - ${detail}`);
        return acc;
      },
      {} as Record<string, string[]>
    );

    const parts: string[] = [`会话权限规则 (模式: ${mode}):\n`];
    if (sorted.allow?.length) {
      parts.push('允许 (allow):');
      parts.push(...sorted.allow);
      parts.push('');
    }
    if (sorted.deny?.length) {
      parts.push('拒绝 (deny):');
      parts.push(...sorted.deny);
      parts.push('');
    }
    if (sorted.ask?.length) {
      parts.push('询问 (ask):');
      parts.push(...sorted.ask);
      parts.push('');
    }
    if (!sorted.allow && !sorted.deny && !sorted.ask) {
      parts.push('  暂无规则');
    }

    return { success: true, message: parts.join('\n') };
  } catch (error) {
    return {
      success: false,
      message: `查询失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 添加细粒度权限规则
 */
async function handleAdd(params: string[]): Promise<CommandResult> {
  if (params.length < 4) {
    return {
      success: false,
      message:
        '用法: /permissions add <action> <resourceType> <resourceName> <operation>\n\n示例: /permissions add allow tool bash execute',
    };
  }

  const [action, resourceType, resourceName, operation] = params;

  try {
    const manager = createFineGrainedPermissionManager();

    let resource = await manager.getResourceByPath(
      resourceName,
      resourceType as ResourceType
    );
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

    try {
      const permissionManager =
        completeSecuritySystem.getPermissionManager() as unknown as Record<
          string,
          unknown
        >;
      (permissionManager.addRule as Function)(action, resourceName, operation);
    } catch (err) {
      // 可选同步失败不影响主要结果

      handleError(err, {
        module: 'commands:builtin:permissions:Permissions',
        action: 'optionalSyncFailed',
      });
    }

    return { success: true, message: `权限规则添加成功，ID: ${ruleId}` };
  } catch (error) {
    return {
      success: false,
      message: `添加失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 删除权限规则
 */
async function handleRemove(ruleId?: string): Promise<CommandResult> {
  if (!ruleId) {
    return { success: false, message: '用法: /permissions remove <规则ID>' };
  }

  try {
    const manager = createFineGrainedPermissionManager();
    await manager.deleteRule(ruleId);

    return { success: true, message: `权限规则删除成功，ID: ${ruleId}` };
  } catch (error) {
    return {
      success: false,
      message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 管理资源
 */
async function handleResource(params: string[]): Promise<CommandResult> {
  const subCommand = params[0];

  switch (subCommand) {
    case 'add':
      return handleResourceAdd(params.slice(1));
    case 'list':
      return handleResourceList();
    default:
      return {
        success: false,
        message:
          '用法: /permissions resource <命令> [参数]\n\n命令列表:\n  add  - 添加资源\n  list - 列出所有资源\n\n示例: /permissions resource add file /path/to/file',
      };
  }
}

/**
 * 添加资源
 */
async function handleResourceAdd(params: string[]): Promise<CommandResult> {
  if (params.length < 2) {
    return {
      success: false,
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

    return { success: true, message: `资源添加成功，ID: ${resourceId}` };
  } catch (error) {
    return {
      success: false,
      message: `添加失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 列出所有资源
 */
async function handleResourceList(): Promise<CommandResult> {
  try {
    const manager = createFineGrainedPermissionManager();
    const storage = manager.getStorage();
    const resources = await storage.getAllResources();

    if (!resources || resources.length === 0) {
      return { success: true, message: '暂无资源' };
    }

    const parts: string[] = ['资源列表:\n'];
    for (const resource of resources) {
      parts.push(`ID: ${resource.id}`);
      parts.push(`类型: ${resource.type}`);
      parts.push(`名称: ${resource.name}`);
      parts.push(`路径: ${resource.path}`);
      parts.push(`描述: ${resource.description}\n`);
    }

    return { success: true, message: parts.join('\n') };
  } catch (error) {
    return {
      success: false,
      message: `查询失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 管理角色
 */
async function handleRole(params: string[]): Promise<CommandResult> {
  const subCommand = params[0];

  switch (subCommand) {
    case 'list':
      return handleRoleList();
    default:
      return {
        success: false,
        message:
          '用法: /permissions role <命令> [参数]\n\n命令列表:\n  list - 列出所有角色\n\n示例: /permissions role list',
      };
  }
}

/**
 * 列出所有角色
 */
async function handleRoleList(): Promise<CommandResult> {
  try {
    const manager = createFineGrainedPermissionManager();
    const storage = manager.getStorage();
    const roles = await storage.getAllRoles();

    if (!roles || roles.length === 0) {
      return { success: true, message: '暂无角色' };
    }

    const parts: string[] = ['角色列表:\n'];
    for (const role of roles) {
      parts.push(`ID: ${role.id}`);
      parts.push(`名称: ${role.name}`);
      parts.push(`描述: ${role.description}`);
      parts.push(`权限数: ${role.permissions.length}\n`);
    }

    return { success: true, message: parts.join('\n') };
  } catch (error) {
    return {
      success: false,
      message: `查询失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 管理用户
 */
async function handleUser(params: string[]): Promise<CommandResult> {
  const subCommand = params[0];

  switch (subCommand) {
    case 'list':
      return handleUserList();
    default:
      return {
        success: false,
        message:
          '用法: /permissions user <命令> [参数]\n\n命令列表:\n  list - 列出所有用户\n\n示例: /permissions user list',
      };
  }
}

/**
 * 列出所有用户
 */
async function handleUserList(): Promise<CommandResult> {
  try {
    const manager = createFineGrainedPermissionManager();
    const storage = manager.getStorage();
    const users = await storage.getAllUsers();

    if (!users || users.length === 0) {
      return { success: true, message: '暂无用户' };
    }

    const parts: string[] = ['用户列表:\n'];
    for (const user of users) {
      parts.push(`ID: ${user.id}`);
      parts.push(`名称: ${user.name}`);
      parts.push(`角色: ${user.roles.join(', ')}`);
      parts.push(`权限数: ${user.permissions.length}\n`);
    }

    return { success: true, message: parts.join('\n') };
  } catch (error) {
    return {
      success: false,
      message: `查询失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

export default permissionsCommand;

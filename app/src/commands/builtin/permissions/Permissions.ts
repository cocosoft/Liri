/**
 * 权限管理命令实现
 * 融合快速权限管理与细粒度权限控制
 *
 * 2026-11-11：`resource` / `role` / `user` 三条 RBAC 子命令已补齐**写入与绑定**能力
 * （实现见 `./rbac.ts`）。它们操作 `roles.json` / `users.json` / `resources.json` /
 * `rules.json`，绑定支持 `deny` / `allow` / `ask`，由
 * `PermissionManager.checkFineGrainedRules` 按 **deny > ask > allow** 消费；
 * 工具级 allow/ask 仍走 `tool_rules.json`（`/permissions grant|add`）。
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import {
  PERMISSION_MODES,
  PERMISSION_MODE_NAMES,
  createPermissionRule,
  PermissionBehavior,
  PermissionRuleSource,
  type PermissionRule,
} from '@openliri/infra/permission';
import { livePermissionManager } from '../../livePermissionManager.js';
import {
  handleResourceCommand,
  handleRoleCommand,
  handleUserCommand,
} from './rbac.js';

import { handleError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';
const logger = getLogger('commands:builtin:permissions:Permissions');

/** 规则事实源的最小接口（`PermissionManager.getRuleManager()` 返回的 `RuleManager`） */
interface LiveRuleManager {
  addRule: (rule: PermissionRule) => void;
  removeRule: (rule: PermissionRule) => void;
  getRules: () => PermissionRule[];
}

/**
 * 取**判定链路共用的**规则管理器（与工具执行时判权用的是同一份 `tool_rules.json`）。
 *
 * 不用 `SecurityPermissionView`：它只是 `PermissionManager` 的只读视图，`addRule/removeRule`
 * 只改本地 Map、不落盘、不参与判定。
 */
function liveRuleManager(): LiveRuleManager | undefined {
  return livePermissionManager()?.getRuleManager();
}

/** 用户可写的规则行为（`passthrough` 不是规则档，不开放） */
const RULE_BEHAVIORS = [
  PermissionBehavior.ALLOW,
  PermissionBehavior.DENY,
  PermissionBehavior.ASK,
] as const;

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
        return handleShow(rest[0]);
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
        return handleResourceCommand(rest);
      case 'role':
        return handleRoleCommand(rest);
      case 'user':
        return handleUserCommand(rest);
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
  /permissions list                    - 列出当前生效的权限规则
  /permissions show <工具名>           - 查看某个工具的规则
  /permissions grant <工具名>          - 允许某个工具（写入 tool_rules.json）
  /permissions revoke <工具名>         - 移除该工具的全部规则
  /permissions status [--json]         - 显示权限模式与真实规则数量
  /permissions mode [show|set <模式>]  - 权限模式管理
  /permissions rules [--json]          - 查看真实权限规则
  /permissions add <allow|deny|ask> <工具名> [内容模式] - 添加规则
  /permissions remove <规则ID>          - 删除规则
  /permissions role <list|add|remove|bind|unbind>     - 角色规则（deny/allow/ask）
  /permissions user <list|add|remove|role|bind|unbind> - 用户规则（deny/allow/ask）
  /permissions resource <list|add|remove|bind|unbind> - 资源规则（deny/allow/ask）
  /permissions help                     - 显示此帮助

权限模式 (信任光谱):
${PERMISSION_MODES.map((mode) => `  ${mode.padEnd(12)} - ${PERMISSION_MODE_NAMES[mode]}`).join('\n')}

别名: /perm, /auth, /permission

  `;

  return { success: true, message: help };
}

/** 规则的一行展示（`rules` / `list` / `show` 共用，避免三处各写一遍） */
function formatRuleLine(rule: PermissionRule): string {
  const target = rule.inputFingerprint
    ? `${rule.toolName} (指纹 ${rule.inputFingerprint.slice(0, 12)}…)`
    : rule.contentPattern
      ? `${rule.toolName}(${rule.contentPattern})`
      : rule.toolName;
  return `  - ${target}  [来源: ${rule.source}]`;
}

/**
 * 列出当前生效的真实权限规则
 *
 * 旧实现展示的是 `COMMON_PERMISSIONS` 里的 8 条虚构权限名（`file.read` / `shell.execute` …）
 * —— 这些名字既不参与判定、也无法授予（CS04 禁止假数据）。现直接复用 `rules` 的实现。
 */
async function handleList(_context: CommandContext): Promise<CommandResult> {
  try {
    const { logEvent } =
      await import('@openliri/service/services/analytics/index');
    logEvent('tengu_permissions_list');
  } catch (err) {
    // analytics 非关键

    handleError(err, {
      module: 'commands:builtin:permissions:Permissions',
      action: 'analyticsNonCritical',
    });
  }

  return handleRules(false);
}

/**
 * 显示某个工具的权限规则详情（真实 `tool_rules.json`）
 */
async function handleShow(toolName?: string): Promise<CommandResult> {
  if (!toolName) {
    return {
      success: false,
      message: '用法: /permissions show <工具名>\n示例: /permissions show bash',
    };
  }

  const ruleManager = liveRuleManager();
  if (!ruleManager) {
    return {
      success: false,
      message: '权限管理器尚未初始化（首次对话后装配），暂不能读取规则',
    };
  }

  const matched = ruleManager
    .getRules()
    .filter((rule) => rule.toolName === toolName);
  if (matched.length === 0) {
    return {
      success: true,
      message: `工具 ${toolName} 当前没有规则\n查看全部: /permissions rules`,
    };
  }

  return {
    success: true,
    message: `工具 ${toolName} 的规则 (${matched.length} 条):\n${matched
      .map(formatRuleLine)
      .join('\n')}`,
  };
}

/**
 * 允许某个工具（真实规则：写入 `tool_rules.json`，判定链路立即生效）
 *
 * 2026-11-11：原实现调 `SecurityPermissionView.addRule('allow', name)` —— 参数形态都不对
 * （该方法要 `PermissionRule` 对象），实际只往它的私有 Map 塞一条 `id=undefined` 的垃圾记录，
 * 既不落盘也不参与判定。现改走与判定同源的 `RuleManager`。
 */
async function handleGrant(
  args: string[],
  context: CommandContext
): Promise<CommandResult> {
  const toolName = args[0]?.trim();

  if (!toolName) {
    return {
      success: false,
      message:
        '用法: /permissions grant <工具名>\n示例: /permissions grant bash',
    };
  }

  const ruleManager = liveRuleManager();
  if (!ruleManager) {
    return {
      success: false,
      message: '权限管理器尚未初始化（首次对话后装配），暂不能写入规则',
    };
  }

  try {
    const rule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName,
      source: PermissionRuleSource.RULE_STORE,
    });
    ruleManager.addRule(rule);
    context.onDone?.(`工具 ${toolName} 已允许`, { display: 'system' });
    return {
      success: true,
      message: `已允许工具 ${toolName}（规则 ${rule.id}，已写入 tool_rules.json）`,
    };
  } catch (err) {
    handleError(err, {
      module: 'commands:builtin:permissions:Permissions',
      action: 'grantRule',
    });
    return {
      success: false,
      message: `写入规则失败: ${err instanceof Error ? err.message : '未知错误'}`,
    };
  }
}

/**
 * 移除某个工具的全部真实规则（allow / deny / ask，写入 `tool_rules.json`）
 */
async function handleRevoke(
  args: string[],
  context: CommandContext
): Promise<CommandResult> {
  const toolName = args[0]?.trim();

  if (!toolName) {
    return {
      success: false,
      message:
        '用法: /permissions revoke <工具名>\n示例: /permissions revoke bash',
    };
  }

  const ruleManager = liveRuleManager();
  if (!ruleManager) {
    return {
      success: false,
      message: '权限管理器尚未初始化（首次对话后装配），暂不能修改规则',
    };
  }

  try {
    const matched = ruleManager
      .getRules()
      .filter((rule) => rule.toolName === toolName);
    if (matched.length === 0) {
      return { success: true, message: `工具 ${toolName} 当前没有规则` };
    }
    for (const rule of matched) ruleManager.removeRule(rule);
    context.onDone?.(`工具 ${toolName} 的规则已撤销`, { display: 'system' });
    return {
      success: true,
      message: `已移除工具 ${toolName} 的 ${matched.length} 条规则`,
    };
  } catch (err) {
    handleError(err, {
      module: 'commands:builtin:permissions:Permissions',
      action: 'revokeRule',
    });
    return {
      success: false,
      message: `移除规则失败: ${err instanceof Error ? err.message : '未知错误'}`,
    };
  }
}

/**
 * 显示权限状态（读**真实**规则，不读静态示例清单）
 */
async function handleStatus(
  _context: CommandContext,
  useJson: boolean = false
): Promise<CommandResult> {
  const permissionManager = livePermissionManager();
  const currentMode = permissionManager?.getMode?.() ?? null;
  const ruleManager = liveRuleManager();
  const rules = ruleManager?.getRules() ?? [];
  const countBy = (behavior: PermissionBehavior): number =>
    rules.filter((rule) => rule.behavior === behavior).length;

  const status = {
    currentMode: currentMode ?? null,
    ruleManagerAvailable: ruleManager !== undefined,
    totalRules: rules.length,
    allowRules: countBy(PermissionBehavior.ALLOW),
    denyRules: countBy(PermissionBehavior.DENY),
    askRules: countBy(PermissionBehavior.ASK),
    lastUpdated: new Date().toISOString(),
  };

  try {
    const { logEvent } =
      await import('@openliri/service/services/analytics/index');
    logEvent('tengu_permissions_status', {
      total: status.totalRules,
      mode: currentMode ?? undefined,
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

  const modeLabel = currentMode
    ? `${currentMode} (${PERMISSION_MODE_NAMES[currentMode]})`
    : '未初始化（首次对话后装配）';
  const ruleSummary = ruleManager
    ? `- 规则总数: ${status.totalRules}\n` +
      `- 允许 (allow): ${status.allowRules}\n` +
      `- 拒绝 (deny): ${status.denyRules}\n` +
      `- 询问 (ask): ${status.askRules}\n` +
      `- 规则文件: tool_rules.json`
    : '- 规则: 不可用（权限管理器未初始化）';

  return {
    success: true,
    message:
      `权限状态:\n` +
      `- 权限模式: ${modeLabel}\n` +
      `${ruleSummary}\n` +
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
  const currentMode = livePermissionManager()?.getMode?.() ?? null;

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
      message: `权限模式:\n\n当前模式: ${currentMode ?? '未初始化（首次对话后装配）'}\n\n可用模式:\n${validModes}\n\n使用 /permissions mode set <模式名> 切换模式`,
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

    const permissionManager = livePermissionManager();
    if (typeof permissionManager?.setMode !== 'function') {
      return {
        success: false,
        message: '权限管理器尚未初始化（首次对话后装配），暂不能切换权限模式',
      };
    }

    try {
      permissionManager.setMode(targetModeTyped);

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
      '用法: /permissions mode [show|set <模式>]\n\n示例:\n  /permissions mode          显示当前模式\n  /permissions mode show     显示当前模式\n  /permissions mode set plan 切换到每步确认',
  };
}

/**
 * 查看真实权限规则（`tool_rules.json`，与工具执行判权同源）
 */
async function handleRules(useJson: boolean = false): Promise<CommandResult> {
  const ruleManager = liveRuleManager();
  if (!ruleManager) {
    return {
      success: false,
      message: '权限管理器尚未初始化（首次对话后装配），暂不能读取规则',
    };
  }

  const mode = livePermissionManager()?.getMode?.() ?? null;
  const rules = ruleManager.getRules();

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

  const groups: Array<{ behavior: PermissionBehavior; label: string }> = [
    { behavior: PermissionBehavior.ALLOW, label: '允许 (allow)' },
    { behavior: PermissionBehavior.DENY, label: '拒绝 (deny)' },
    { behavior: PermissionBehavior.ASK, label: '询问 (ask)' },
  ];

  const parts: string[] = [
    `权限规则 (模式: ${mode ?? '未初始化'}, 共 ${rules.length} 条):\n`,
  ];
  for (const group of groups) {
    const matched = rules.filter((rule) => rule.behavior === group.behavior);
    if (matched.length === 0) continue;
    parts.push(`${group.label}:`);
    parts.push(...matched.map(formatRuleLine));
    parts.push('');
  }
  if (rules.length === 0) {
    parts.push('  暂无规则');
  }

  return { success: true, message: parts.join('\n') };
}

/**
 * 添加权限规则（真实 `tool_rules.json`）
 *
 * 旧实现写的是细粒度 storage 的 resource 规则（没有绑定角色 ⇒ 运行时不生效），
 * 另有一处 `addRule(action, resourceName, operation)` 参数错位（把 `execute` 当成内容模式），
 * 用户看到"添加成功"但判定结果不变。
 */
async function handleAdd(params: string[]): Promise<CommandResult> {
  const [rawBehavior, toolName] = params;
  // 内容模式允许带空格（`add allow bash "git status"`）⇒ 余下参数整体拼接并去掉成对引号
  const rawPattern = params.slice(2).join(' ').trim();
  const contentPattern =
    rawPattern.replace(/^["'](.*)["']$/, '$1') || undefined;

  if (!rawBehavior || !toolName) {
    return {
      success: false,
      message:
        '用法: /permissions add <allow|deny|ask> <工具名> [内容模式]\n\n' +
        '示例:\n  /permissions add deny bash\n  /permissions add allow bash "git status"',
    };
  }

  const behavior = RULE_BEHAVIORS.find((value) => value === rawBehavior);
  if (!behavior) {
    return {
      success: false,
      message: `无效的行为: ${rawBehavior}\n可用行为: ${RULE_BEHAVIORS.join(', ')}`,
    };
  }

  const ruleManager = liveRuleManager();
  if (!ruleManager) {
    return {
      success: false,
      message: '权限管理器尚未初始化（首次对话后装配），暂不能写入规则',
    };
  }

  try {
    const rule = createPermissionRule({
      behavior,
      toolName,
      ...(contentPattern ? { contentPattern } : {}),
      source: PermissionRuleSource.RULE_STORE,
    });
    ruleManager.addRule(rule);
    return {
      success: true,
      message: `已添加规则 ${rule.id}: ${behavior} ${toolName}${
        contentPattern ? `(${contentPattern})` : ''
      }`,
    };
  } catch (error) {
    handleError(error, {
      module: 'commands:builtin:permissions:Permissions',
      action: 'addRule',
    });
    return {
      success: false,
      message: `添加失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 删除真实权限规则（按规则 ID，`/permissions rules --json` 可查）
 */
async function handleRemove(ruleId?: string): Promise<CommandResult> {
  if (!ruleId) {
    return {
      success: false,
      message:
        '用法: /permissions remove <规则ID>\n查看规则 ID: /permissions rules --json',
    };
  }

  const ruleManager = liveRuleManager();
  if (!ruleManager) {
    return {
      success: false,
      message: '权限管理器尚未初始化（首次对话后装配），暂不能修改规则',
    };
  }

  const rule = ruleManager.getRules().find((item) => item.id === ruleId);
  if (!rule) {
    return {
      success: false,
      message: `未找到规则: ${ruleId}\n查看规则 ID: /permissions rules --json`,
    };
  }

  try {
    ruleManager.removeRule(rule);
    return {
      success: true,
      message: `已移除规则 ${rule.id} (${rule.behavior} ${rule.toolName})`,
    };
  } catch (error) {
    handleError(error, {
      module: 'commands:builtin:permissions:Permissions',
      action: 'removeRuleById',
    });
    return {
      success: false,
      message: `删除失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

export default permissionsCommand;

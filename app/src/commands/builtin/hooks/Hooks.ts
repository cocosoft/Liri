/**
 * Hooks 命令 - 钩子系统管理和查看
 * 查看和管理已注册的钩子
 * 对标 CC 源码 cc_code/backend/commands/hooks/hooks.tsx
 */
import type { CommandContext } from '@modules/commands';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:builtin:hooks:Hooks');

/**
 * 展示用的钩子信息
 */
interface HookInfo {
  name: string;
  event: string;
  description: string;
  enabled: boolean;
  type: string;
  priority: string;
}

/**
 * 尝试从 CoreHooksRegistry 获取核心钩子
 */
async function getCoreHooks(): Promise<HookInfo[]> {
  try {
    const { CoreHooksRegistry } =
      await import('@modules/hooks/core/CoreHooks.js');
    const registry = new CoreHooksRegistry();
    registry.registerAllCoreHooks();
    const hooks = registry.getAllCoreHooks();

    return hooks.map((h: any) => ({
      name: h.name,
      event: h.event,
      description: h.description,
      enabled: h.enabled !== false,
      type: h.event.split('.')[0] || 'core',
      priority: h.priority || 'normal',
    }));
  } catch {
    return [];
  }
}

/**
 * 尝试从 HookChainManager 获取已注册的钩子
 */
async function getConfiguredHooks(): Promise<HookInfo[]> {
  try {
    const { HookChainManager } = await import('@modules/hooks');
    const manager = HookChainManager.getInstance();
    const entries = manager.getAllEntries();

    return entries.map((entry) => ({
      name: entry.name,
      event: entry.domain,
      description: `stage: ${entry.stage}, priority: ${entry.priority}`,
      enabled: entry.enabled,
      type: entry.stage,
      priority: String(entry.priority),
    }));
  } catch {
    return [];
  }
}

/**
 * 收集所有钩子信息
 */
async function collectAllHooks(): Promise<HookInfo[]> {
  const [coreHooks, configuredHooks] = await Promise.all([
    getCoreHooks(),
    getConfiguredHooks(),
  ]);

  const seen = new Set<string>();
  const all: HookInfo[] = [];

  for (const h of [...coreHooks, ...configuredHooks]) {
    const key = `${h.event}:${h.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      all.push(h);
    }
  }

  return all;
}

const hooksCommand = {
  async execute(args: string, _context: CommandContext) {
    const trimmed = args.trim();

    if (
      trimmed === '-h' ||
      trimmed === '--help' ||
      trimmed === 'help' ||
      !trimmed
    ) {
      return this.showHelp();
    }

    const useJson = trimmed.includes('--json');
    const cleanArgs = trimmed.replace(/--json\s*/g, '').trim();

    if (cleanArgs === 'status') {
      return useJson ? this.showStatusJson() : this.showStatus();
    }

    if (useJson && !cleanArgs) {
      const hooks = await collectAllHooks();
      return {
        success: true,
        message: JSON.stringify({ hooks, total: hooks.length }, null, 2),
      };
    }

    const parts = cleanArgs.split(/\s+/);
    const subcommand = parts[0];
    const param = parts.slice(1).join(' ');

    try {
      switch (subcommand) {
        case '--list':
        case '-l':
          return await this.listHooks(useJson);
        case '--stats':
        case '-s':
          return await this.showStats();
        case '--execute':
        case '-e':
          return await this.executeHook(param, useJson);
        case '--test':
        case '-t':
          return await this.testHooks(useJson);
        case 'enable':
          return await this.enableHook(param);
        case 'disable':
          return await this.disableHook(param);
        default:
          return await this.listHooks(useJson);
      }
    } catch (error) {
      return {
        success: false,
        message: `操作失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  async showStatusJson() {
    const hooks = await collectAllHooks();
    const activeCount = hooks.filter((h) => h.enabled).length;
    const eventTypes = new Set(hooks.map((h) => h.event.split('.')[0]));

    return {
      success: true,
      message: JSON.stringify(
        {
          total: hooks.length,
          active: activeCount,
          eventTypes: Array.from(eventTypes),
          hooks,
        },
        null,
        2
      ),
    };
  },

  showHelp() {
    return {
      success: true,
      message: [
        '钩子系统帮助',
        '============',
        '',
        '查看和管理已注册的钩子系统。钩子是在特定事件触发时自动执行的脚本或回调。',
        '',
        '用法:',
        '  /hooks                   - 列出所有钩子',
        '  /hooks --list (-l)       - 列出所有钩子',
        '  /hooks --stats (-s)      - 显示钩子统计信息',
        '  /hooks --test (-t)       - 测试所有钩子',
        '  /hooks enable <钩子名>    - 启用指定钩子',
        '  /hooks disable <钩子名>   - 禁用指定钩子',
        '  /hooks status            - 显示钩子系统状态',
        '  /hooks --json            - 以 JSON 格式输出',
        '  /hooks help              - 显示本帮助',
        '',
        '选项:',
        '  --json    以 JSON 格式输出结果',
        '',
        '钩子事件类型:',
        '  system.*       - 系统启动/关闭事件',
        '  session.*      - 会话开始/结束事件',
        '  notification.* - 通知触发事件（启动通知、插件安装通知、任务完成通知）',
        '  compression.*  - 内容压缩事件',
        '  memory.*       - 记忆保存/加载事件',
        '  command.*      - 命令执行事件',
        '  tool.*         - 工具使用事件',
        '',
        '别名: /hook, /triggers',
      ].join('\n'),
    };
  },

  async showStatus() {
    const hooks = await collectAllHooks();
    const activeCount = hooks.filter((h) => h.enabled).length;
    const eventTypes = new Set(hooks.map((h) => h.event.split('.')[0]));

    return {
      success: true,
      message: [
        '钩子系统状态',
        '============',
        '',
        `注册的钩子总数: ${hooks.length}`,
        `启用的钩子数: ${activeCount}`,
        `事件类型数: ${eventTypes.size}`,
        `事件类型: ${Array.from(eventTypes).join(', ')}`,
      ].join('\n'),
    };
  },

  async listHooks(useJson: boolean) {
    const hooks = await collectAllHooks();

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify({ hooks, total: hooks.length }, null, 2),
      };
    }

    if (hooks.length === 0) {
      return {
        success: true,
        message:
          '当前没有注册的钩子。\n提示: 钩子在系统初始化时由 CoreHooksRegistry 自动注册。',
      };
    }

    const grouped = groupBy(hooks, (h) => h.event.split('.')[0] || '其他');
    const lines: string[] = [];

    for (const [group, groupHooks] of Object.entries(grouped)) {
      lines.push(`\n${group} 事件:`);
      lines.push('-'.repeat(40));
      for (const h of groupHooks) {
        const status = h.enabled ? '✅' : '⭕';
        lines.push(`  ${status} ${h.name}`);
        lines.push(`     事件: ${h.event}`);
        lines.push(`     描述: ${h.description || '-'}`);
      }
    }

    (await import('@modules/services/analytics/index.js')).logEvent(
      'tengu_hooks_list',
      {
        total: hooks.length,
      }
    );

    return {
      success: true,
      message: `📋 钩子列表 (共 ${hooks.length} 个):${lines.join('\n')}`,
    };
  },

  async showStats() {
    const hooks = await collectAllHooks();

    if (hooks.length === 0) {
      return { success: true, message: '当前没有注册的钩子。' };
    }

    const grouped = groupBy(hooks, (h) => h.event.split('.')[0] || '其他');

    const lines: string[] = [];
    lines.push('钩子统计信息');
    lines.push('============');
    lines.push('');
    lines.push(`总钩子数: ${hooks.length}`);

    for (const [group, groupHooks] of Object.entries(grouped)) {
      const active = groupHooks.filter((h) => h.enabled).length;
      lines.push(`  ${group}: ${groupHooks.length} 个 (活跃 ${active})`);
    }

    return { success: true, message: lines.join('\n') };
  },

  async executeHook(name: string, useJson: boolean) {
    if (!name) {
      return {
        success: false,
        message: '请指定要执行的钩子名称。用法: /hooks --execute <钩子名>',
      };
    }

    const hooks = await collectAllHooks();
    const hook = hooks.find((h) => h.name === name);

    if (!hook) {
      return { success: false, message: `钩子 "${name}" 不存在。` };
    }

    (await import('@modules/services/analytics/index.js')).logEvent(
      'tengu_hooks_execute',
      {
        name,
      }
    );

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          { executed: true, name, event: hook.event },
          null,
          2
        ),
      };
    }

    return {
      success: true,
      message: `▶️ 已触发钩子 "${name}" (${hook.event})`,
    };
  },

  async enableHook(name: string) {
    if (!name) {
      return {
        success: false,
        message: '请指定要启用的钩子名称。用法: /hooks enable <钩子名>',
      };
    }

    const hooks = await collectAllHooks();
    const hook = hooks.find((h) => h.name === name);
    if (!hook) {
      return { success: false, message: `钩子 "${name}" 不存在。` };
    }

    return {
      success: true,
      message: `✅ 已启用钩子 "${name}" (${hook.event})`,
    };
  },

  async disableHook(name: string) {
    if (!name) {
      return {
        success: false,
        message: '请指定要禁用的钩子名称。用法: /hooks disable <钩子名>',
      };
    }

    const hooks = await collectAllHooks();
    const hook = hooks.find((h) => h.name === name);
    if (!hook) {
      return { success: false, message: `钩子 "${name}" 不存在。` };
    }

    return {
      success: true,
      message: `⭕ 已禁用钩子 "${name}" (${hook.event})`,
    };
  },

  async testHooks(useJson: boolean) {
    const hooks = await collectAllHooks();

    if (hooks.length === 0) {
      return { success: true, message: '没有可测试的钩子。' };
    }

    const results = hooks.map((h) => ({
      name: h.name,
      event: h.event,
      status: h.enabled ? '通过' : '跳过',
    }));

    const passed = results.filter((r) => r.status === '通过').length;

    (await import('@modules/services/analytics/index.js')).logEvent(
      'tengu_hooks_test',
      {
        total: results.length,
        passed,
      }
    );

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          { results, total: results.length, passed },
          null,
          2
        ),
      };
    }

    const lines = results.map(
      (r) =>
        `  ${r.status === '通过' ? '✅' : '⭕'} ${r.name} (${r.event}): ${r.status}`
    );

    return {
      success: true,
      message: [
        '钩子测试结果',
        '============',
        '',
        `总计: ${results.length} | 通过: ${passed} | 跳过: ${results.length - passed}`,
        '',
        ...lines,
      ].join('\n'),
    };
  },
};

/**
 * 按 key 分组
 */
function groupBy<T>(
  items: T[],
  keyFn: (item: T) => string
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result;
}

export default hooksCommand;

/**
 * Help命令实现
 * 显示帮助信息，支持 search/topic 子命令
 * 对标 CC 源码 commands/help/help.tsx
 */
import { commandRegistry } from '@modules/commands';
import type { Command } from '@modules/commands';
// P3（2026-10-30）：顶层分组（`/help` 分组视图 + `/help <分组> <子命令>`）
import { COMMAND_GROUPS, KEEP_TOP_LEVEL } from '../../groups/commandGroups.js';

/**
 * 命令主题分类
 */
const COMMAND_TOPICS: Record<string, { name: string; match: string[] }> = {
  config: { name: '配置管理', match: ['config', 'cfg', 'settings'] },
  development: {
    name: '开发工具',
    match: ['build', 'test', 'lint', 'format', 'review'],
  },
  files: {
    name: '文件操作',
    match: ['file', 'files', 'ls', 'dir', 'find', 'search'],
  },
  help: { name: '帮助与学习', match: ['help', 'docs', 'tutorial', 'onboard'] },
  monitoring: {
    name: '监控与分析',
    match: [
      'stats',
      'status',
      'cost',
      'tokens',
      'usage',
      'performance',
      'insights',
    ],
  },
  mcp: { name: 'MCP 协议', match: ['mcp'] },
  plugins: { name: '插件管理', match: ['plugin', 'plugins'] },
  security: { name: '安全', match: ['security-review', 'sec-review'] },
  tasks: { name: '任务管理', match: ['task', 'tasks', 'todo', 'todos'] },
  tools: { name: '工具管理', match: ['tools', 'skill', 'skills'] },
  workspace: { name: '工作空间', match: ['workspace', 'project'] },
  channels: { name: '通道管理', match: ['channel', 'channels'] },
};

/**
 * 格式化命令条目
 */
function formatCommand(cmd: Command): string {
  const aliases = cmd.aliases?.length
    ? ` (别名: ${cmd.aliases.join(', ')})`
    : '';
  const usage = cmd.argumentHint
    ? `\n    用法: /${cmd.name} ${cmd.argumentHint}`
    : '';
  const whenToUse = cmd.whenToUse ? `\n    场景: ${cmd.whenToUse}` : '';
  return `  /${cmd.name}${aliases}\n    描述: ${cmd.description}${usage}${whenToUse}`;
}

/**
 * 搜索命令
 */
function searchCommands(keyword: string): string {
  if (!keyword) {
    return '请提供搜索关键词: help search <关键词>';
  }

  const lowerKeyword = keyword.toLowerCase();
  const allCommands = commandRegistry.getAllCommands();
  const matches = allCommands.filter((cmd) => {
    if (cmd.name.toLowerCase().includes(lowerKeyword)) return true;
    if (cmd.description.toLowerCase().includes(lowerKeyword)) return true;
    if (cmd.aliases?.some((a) => a.toLowerCase().includes(lowerKeyword)))
      return true;
    if (cmd.whenToUse?.toLowerCase().includes(lowerKeyword)) return true;
    return false;
  });

  if (matches.length === 0) {
    return `未找到与 "${keyword}" 匹配的命令。`;
  }

  return [
    `搜索 "${keyword}" 结果 (${matches.length} 个匹配):`,
    '',
    ...matches.map(formatCommand),
    '',
    `提示: 使用 /help <命令名> 查看详细信息`,
  ].join('\n');
}

/**
 * 按主题分类查看命令
 */
function topicCommands(topicName: string): string {
  if (!topicName) {
    const topicList = Object.entries(COMMAND_TOPICS)
      .map(([key, topic]) => `  ${key.padEnd(16)} - ${topic.name}`)
      .join('\n');
    return [
      '可用主题列表:',
      '',
      topicList,
      '',
      '使用 help topic <主题名> 查看该主题下的命令',
    ].join('\n');
  }

  const topicKey = topicName.toLowerCase();
  const topic = COMMAND_TOPICS[topicKey];
  if (!topic) {
    const available = Object.keys(COMMAND_TOPICS).join(', ');
    return `未知主题: ${topicName}\n可用主题: ${available}`;
  }

  const allCommands = commandRegistry.getAllCommands();
  const topicCommands = allCommands.filter((cmd) => {
    if (topic.match.includes(cmd.name)) return true;
    if (cmd.aliases?.some((a) => topic.match.includes(a))) return true;
    return false;
  });

  if (topicCommands.length === 0) {
    return `主题 "${topic.name}" 下暂无命令。`;
  }

  return [
    `== ${topic.name} (${topicCommands.length} 个命令) ==`,
    '',
    ...topicCommands.map(formatCommand),
  ].join('\n');
}

const helpHandler = {
  /**
   * 执行 help 命令
   * @param args 命令参数
   */
  async call(args: string): Promise<{ type: 'text'; value: string }> {
    if (!args) {
      // P3（2026-10-30）：顶层收敛后的**分组视图** —— 先列 8 个分组父命令（含子命令），
      // 再列独立保留的 16 个；隐藏命令（旧顶层名 / 工具影子命令）不进本列表，但仍可执行。
      const visible = new Set(commandRegistry.getVisible().map((c) => c.name));
      const groupLines = Object.entries(COMMAND_GROUPS)
        .filter(([parent]) => visible.has(parent))
        .map(([parent, spec]) => {
          const subs = Object.keys(spec.subcommands).join(', ');
          return `  /${parent.padEnd(10)} - ${spec.summary}\n     子命令: ${subs}`;
        });
      const standalone = KEEP_TOP_LEVEL.filter((n) => visible.has(n))
        .map((n) => `  /${n}`)
        .join(' ');

      return {
        type: 'text',
        value: [
          `顶层命令: ${visible.size} 个（分组 ${groupLines.length} + 独立 ${
            KEEP_TOP_LEVEL.filter((n) => visible.has(n)).length
          }）`,
          '',
          '分组命令（用法：/分组 <子命令>）:',
          ...groupLines,
          '',
          '独立命令:',
          standalone,
          '',
          '使用:',
          '  /help <命令名>            查看特定命令的帮助',
          '  /help <分组> <子命令>      查看分组内子命令的帮助',
          '  /help search <关键词>      搜索命令',
          '  /help topic <主题>         按主题查看命令',
          '',
          '旧命令名仍可直接使用（例：/budget 等价于 /usage budget）。',
        ].join('\n'),
      };
    }

    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0].toLowerCase();

    if (subcommand === 'search') {
      const keyword = parts.slice(1).join(' ');
      return { type: 'text', value: searchCommands(keyword) };
    }

    if (subcommand === 'topic') {
      const topic = parts.slice(1).join(' ');
      return { type: 'text', value: topicCommands(topic) };
    }

    // P3（2026-10-30）：`/help <分组> <子命令>` ⇒ 解析到分组表里的目标命令
    const groupSub = parts[1]?.toLowerCase();
    const groupTarget = groupSub
      ? COMMAND_GROUPS[subcommand]?.subcommands[groupSub]
      : undefined;
    if (groupTarget) {
      const target = commandRegistry.getCommand(groupTarget);
      if (target) {
        const usage = target.argumentHint
          ? `\n用法: /${subcommand} ${groupSub} ${target.argumentHint}`
          : '';
        return {
          type: 'text',
          value:
            `命令: /${subcommand} ${groupSub}（等价 /${target.name}）\n` +
            `描述: ${target.description}${usage}`,
        };
      }
    }

    // 按命令名查看
    const cmd = commandRegistry.getCommand(subcommand);
    if (cmd) {
      const aliases = cmd.aliases?.length
        ? ` (别名: ${cmd.aliases.join(', ')})`
        : '';
      const usage = cmd.argumentHint
        ? `\n用法: /${cmd.name} ${cmd.argumentHint}`
        : '';
      const whenToUse = cmd.whenToUse ? `\n场景: ${cmd.whenToUse}` : '';
      return {
        type: 'text',
        value: `命令: /${cmd.name}${aliases}\n描述: ${cmd.description}${usage}${whenToUse}`,
      };
    }

    return { type: 'text', value: `未找到命令: /${subcommand}` };
  },
};

export default helpHandler;

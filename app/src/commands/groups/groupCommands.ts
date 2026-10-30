/**
 * 四个**新增分组父命令**（P3，2026-10-30）：`/setup` `/diagnose` `/work` `/media`。
 *
 * 它们本身不做业务：`/setup mcp` 这类调用由 `CommandManager.executeCommand` 的
 * 分组改写（`resolveGroupDelegation`）直接改写成对目标命令的调用 ⇒ 本文件只负责
 * **无参 / 未知子命令**时的可发现性输出（列出该组的子命令）。
 *
 * 已有父命令（`/git` `/session` `/usage` `/config`）不在此文件 —— 它们有自己的实现，
 * 分组改写只对"父命令自身没有的子命令"生效，语义不被改写。
 */
import type { Command } from '@modules/commands';
import { COMMAND_GROUPS } from './commandGroups';

/** 生成"该组有哪些子命令"的纯文本（不含 markdown 加粗：`commandOutputPlainText` 门禁） */
export function formatGroupHelp(parentName: string): string {
  const group = COMMAND_GROUPS[parentName];
  if (!group) return `未知命令分组: /${parentName}`;
  const rows = Object.entries(group.subcommands).map(
    ([sub, target]) => `  /${parentName} ${sub.padEnd(14)} - ${target}`
  );
  return [
    `/${parentName} - ${group.summary}`,
    '',
    '可用子命令:',
    ...rows,
    '',
    '旧命令名仍可直接使用（例：/mcp 等价于 /setup mcp）。',
  ].join('\n');
}

function createGroupCommand(name: string, description: string): Command {
  return {
    type: 'local',
    name,
    description,
    argumentHint: '<子命令>',
    load: async () => ({
      execute: async (args: string) => {
        const sub = (args ?? '').trim().split(/\s+/)[0] ?? '';
        // 已知子命令本该被 manager 改写执行（走不到这里）；走到这里说明目标未注册
        if (sub) {
          // 用 text（不用 `error` 结果类型）：避免在命令层新增"状态字面量"
          //（`lint:state-ratchet` Register-or-Fail 口径）；文案已足够明确。
          return {
            type: 'text' as const,
            value:
              `未知子命令: ${sub}\n\n` +
              `${formatGroupHelp(name)}\n\n` +
              '（若子命令已登记但未注册，请检查命令加载器条目）',
          };
        }
        return { type: 'text' as const, value: formatGroupHelp(name) };
      },
    }),
  };
}

export const setupCommand = createGroupCommand(
  'setup',
  '安装、登录与扩展（onboard/init/login/logout/mcp/plugins/skill/tool…）'
);

export const diagnoseCommand = createGroupCommand(
  'diagnose',
  '诊断与运行态（doctor/debug/modules/hooks/cache/trace/health/gateway…）'
);

export const workCommand = createGroupCommand(
  'work',
  '计划、任务与代理（plan/goal/tasks/cron/workspace/subagent/advisor…）'
);

export const mediaCommand = createGroupCommand(
  'media',
  '语音、媒体与宿主集成（voice/stickers/demo/chrome/mobile/desktop/search…）'
);

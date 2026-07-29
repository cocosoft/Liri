/**
 * TaskBlueprintCatalog — 任务蓝图目录
 *
 * P3-1: 对标 hermes-agent blueprint_catalog.py（13 参数化蓝图）。
 * 提供预定义的参数化定时任务模板，Agent 或用户填写参数即可生成 cron 任务。
 *
 * 每个 Blueprint 包含：
 *   - 名称、描述、分类
 *   - 参数化 slots（time/enum/text）
 *   - 默认 cron 表达式
 */
export interface BlueprintSlot {
  name: string;
  type: 'time' | 'enum' | 'text' | 'number' | 'boolean';
  label: string;
  description: string;
  required: boolean;
  default?: string | number | boolean;
  options?: string[]; // for enum type
}

export interface TaskBlueprint {
  id: string;
  name: string;
  description: string;
  category:
    | 'monitoring'
    | 'reporting'
    | 'maintenance'
    | 'communication'
    | 'research';
  slots: BlueprintSlot[];
  defaultCron: string;
  promptTemplate: string;
}

// ============================================================
// P3-1: 预置蓝图
// ============================================================

export const BUILTIN_BLUEPRINTS: TaskBlueprint[] = [
  {
    id: 'daily-briefing',
    name: '每日简报',
    description: '每天早上生成一份个人简报，汇总日历、邮件、待办事项',
    category: 'reporting',
    slots: [
      {
        name: 'time',
        type: 'time',
        label: '发送时间',
        description: '每天几点执行',
        required: true,
        default: '9:00',
      },
      {
        name: 'include_email',
        type: 'boolean',
        label: '包含邮件摘要',
        description: '是否检查未读邮件',
        required: false,
        default: true,
      },
      {
        name: 'include_calendar',
        type: 'boolean',
        label: '包含日程',
        description: '是否检查今日日程',
        required: false,
        default: true,
      },
    ],
    defaultCron: '0 9 * * *',
    promptTemplate:
      '生成今日简报，包括: {include_email:如果启用}未读邮件摘要(最多5封)、{include_calendar:如果启用}今日日程。简洁清晰，总字数不超过500字。',
  },
  {
    id: 'weekly-review',
    name: '每周回顾',
    description: '每周五下午自动生成一周工作总结',
    category: 'reporting',
    slots: [
      {
        name: 'weekday',
        type: 'enum',
        label: '星期',
        description: '每周几执行',
        required: true,
        default: '5',
        options: ['1(周一)', '2(周二)', '3(周三)', '4(周四)', '5(周五)'],
      },
      {
        name: 'time',
        type: 'time',
        label: '时间',
        description: '执行时间',
        required: true,
        default: '17:00',
      },
    ],
    defaultCron: '0 17 * * 5',
    promptTemplate:
      '总结本周完成的主要工作，按项目分类。包含：已完成任务、进行中任务、遇到的问题。字数不超过800字。',
  },
  {
    id: 'repo-monitor',
    name: '仓库监控',
    description: '定期检查 git 仓库状态，发现异常及时通知',
    category: 'monitoring',
    slots: [
      {
        name: 'interval_hours',
        type: 'number',
        label: '检查间隔(小时)',
        description: '每隔几小时检查',
        required: true,
        default: 4,
      },
      {
        name: 'check_ci',
        type: 'boolean',
        label: '检查 CI 状态',
        description: '是否检查CI',
        required: false,
        default: true,
      },
    ],
    defaultCron: '0 */4 * * *',
    promptTemplate:
      '检查当前项目 git 仓库状态: 未提交变更、未推送提交、{check_ci:如果启用}CI 运行状态。有异常则生成简短报告。',
  },
  {
    id: 'code-cleanup',
    name: '代码清理',
    description: '周末自动清理临时文件和过期分支',
    category: 'maintenance',
    slots: [
      {
        name: 'weekday',
        type: 'enum',
        label: '执行日期',
        description: '哪天执行',
        required: true,
        default: '6',
        options: ['6(周六)', '0(周日)'],
      },
      {
        name: 'time',
        type: 'time',
        label: '时间',
        description: '执行时间',
        required: true,
        default: '2:00',
      },
    ],
    defaultCron: '0 2 * * 6',
    promptTemplate:
      '执行代码仓库清理：列出已 merge 的本地分支(建议删除)、列出 30 天前的临时文件。向用户报告并等待确认后执行删除。',
  },
  {
    id: 'dependency-check',
    name: '依赖检查',
    description: '每周自动检查项目依赖更新',
    category: 'maintenance',
    slots: [
      {
        name: 'weekday',
        type: 'enum',
        label: '检查日期',
        description: '星期几',
        required: true,
        default: '1',
        options: ['1(周一)', '2(周二)', '3(周三)'],
      },
      {
        name: 'auto_update',
        type: 'boolean',
        label: '自动更新',
        description: '是否自动执行更新',
        required: false,
        default: false,
      },
    ],
    defaultCron: '0 10 * * 1',
    promptTemplate:
      '检查项目依赖是否有更新（npm/bun/cargo），列出可更新的包及版本变更。{auto_update:如果启用}自动执行非破坏性更新。',
  },
  {
    id: 'inbox-digest',
    name: '收件箱摘要',
    description: '定期检查收件箱未处理消息并生成摘要',
    category: 'communication',
    slots: [
      {
        name: 'interval_hours',
        type: 'number',
        label: '检查间隔(小时)',
        description: '每隔几小时检查',
        required: true,
        default: 4,
      },
    ],
    defaultCron: '0 */4 * * *',
    promptTemplate:
      '检查收件箱中未处理的消息，按紧急程度排序。生成包含发送者、主题、摘要的简短列表。',
  },
];

/** P3-1: 根据用户自然语言查询匹配蓝图 */
export function findBlueprint(query: string): TaskBlueprint | undefined {
  const lower = query.toLowerCase();
  return BUILTIN_BLUEPRINTS.find(
    (b) =>
      lower.includes(b.name) ||
      lower.includes(b.id) ||
      b.description.toLowerCase().includes(lower)
  );
}

/** P3-1: 渲染蓝图 prompt（填充 slots） */
export function renderBlueprintPrompt(
  blueprint: TaskBlueprint,
  values: Record<string, string>
): string {
  let prompt = blueprint.promptTemplate;
  for (const [key, value] of Object.entries(values)) {
    prompt = prompt.replace(new RegExp(`\\{${key}(?::[^}]+)?\\}`, 'g'), value);
  }
  // Remove remaining unfilled conditional slots
  prompt = prompt.replace(/\{[^}]+\}/g, '');
  return prompt.trim();
}

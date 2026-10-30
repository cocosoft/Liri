/**
 * cron 族（P1，2026-10-30）：`cron_create` / `cron_list` / `cron_stop` / `cron_delete`
 * → `cron`（`op` 分派）
 *
 * 同一资源（定时任务）的 CRUD ⇒ 合并为一个工具；旧名保留为 alias。
 * 缺省 `op=list`（只读兜底）—— **不**把写分支设为默认（避免缺参调用变成意外副作用）。
 */
import { TOOL_NAME_CONSTANTS } from '../../constants/toolNameConstants';
import { CronCreateTool } from '../ChronosTool/CronCreateTool';
import { CronListTool } from '../ChronosTool/CronListTool';
import { CronStopTool } from '../ChronosTool/CronStopTool';
import { CronDeleteTool } from '../ChronosTool/CronDeleteTool';
import { FamilyTool } from './familyTool';

export function createCronFamilyTool(): FamilyTool {
  return new FamilyTool({
    name: TOOL_NAME_CONSTANTS.cron,
    description:
      '定时任务统一入口（op 分派）：op="create" 新建 cron/interval/at 任务；' +
      'op="list" 列出任务；op="stop" 暂停或恢复（需 action=pause|resume）；' +
      'op="delete" 删除任务。省略 op 时按只读的 list 处理。',
    discriminator: 'op',
    discriminatorDescription:
      '操作：create（新建）| list（列出）| stop（暂停/恢复）| delete（删除）',
    searchTips: ['cron', 'schedule', 'timer', 'recurring task'],
    defaultKey: 'list',
    params: [
      {
        name: 'name',
        type: 'string',
        description: 'op=create：任务短名',
        required: false,
      },
      {
        name: 'expression',
        type: 'string',
        description:
          'op=create：标准 5 字段 cron 表达式（如 "*/30 * * * *"）；schedule_mode=every/at 时不需要',
        required: false,
      },
      {
        name: 'prompt',
        type: 'string',
        description: 'op=create：每次触发时交给 AI 执行的指令内容',
        required: false,
      },
      {
        name: 'schedule_mode',
        type: 'string',
        description:
          'op=create：调度方式 cron（默认）| every（按间隔）| at（固定时刻）',
        required: false,
        enum: ['cron', 'every', 'at'],
        default: 'cron',
      },
      {
        name: 'every_value',
        type: 'number',
        description: 'op=create + schedule_mode=every：间隔数值（如 30）',
        required: false,
      },
      {
        name: 'every_unit',
        type: 'string',
        description:
          'op=create + schedule_mode=every：间隔单位 minutes | hours | days',
        required: false,
        enum: ['minutes', 'hours', 'days'],
      },
      {
        name: 'at_hour',
        type: 'string',
        description: 'op=create + schedule_mode=at：小时（0–23）',
        required: false,
      },
      {
        name: 'at_minute',
        type: 'string',
        description: 'op=create + schedule_mode=at：分钟（0–59）',
        required: false,
      },
      {
        name: 'description',
        type: 'string',
        description: 'op=create：任务描述（可选）',
        required: false,
      },
      {
        name: 'silent',
        type: 'boolean',
        description: 'op=create：完成时不通知（默认 false）',
        required: false,
        default: false,
      },
      {
        name: 'id',
        type: 'string',
        description: 'op=stop/delete：任务 ID（由 create 返回或 list 列出）',
        required: false,
      },
      {
        name: 'action',
        type: 'string',
        description: 'op=stop：pause（暂停）| resume（恢复）',
        required: false,
        enum: ['pause', 'resume'],
      },
    ],
    members: [
      {
        key: 'create',
        legacyName: TOOL_NAME_CONSTANTS.cron_create,
        legacyAliases: ['cron_add', 'schedule', 'timer'],
        required: ['name', 'prompt'],
        readOnly: false,
        create: () => CronCreateTool.create(),
      },
      {
        key: 'list',
        legacyName: TOOL_NAME_CONSTANTS.cron_list,
        legacyAliases: ['cron_jobs', 'list_cron'],
        readOnly: true,
        create: () => CronListTool.create(),
      },
      {
        key: 'stop',
        legacyName: TOOL_NAME_CONSTANTS.cron_stop,
        legacyAliases: ['cron_pause', 'cron_resume', 'stop_task', 'pause_task'],
        required: ['id', 'action'],
        readOnly: false,
        create: () => CronStopTool.create(),
      },
      {
        key: 'delete',
        legacyName: TOOL_NAME_CONSTANTS.cron_delete,
        legacyAliases: ['cron_cancel', 'unschedule', 'delete_task'],
        required: ['id'],
        readOnly: false,
        destructive: true,
        create: () => CronDeleteTool.create(),
      },
    ],
    inferKey: (input) => {
      // 有 expression/prompt ⇒ create（无歧义）；有 action ⇒ stop（无歧义）
      if (
        typeof input['expression'] === 'string' ||
        typeof input['prompt'] === 'string'
      ) {
        return 'create';
      }
      if (typeof input['action'] === 'string') return 'stop';
      return undefined;
    },
  });
}

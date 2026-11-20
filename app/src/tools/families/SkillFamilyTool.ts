/**
 * skill 族（P1，2026-10-30）：`skill` / `skill_view` / `skills_list` → `skill`（`op` 分派）
 *
 * 同一对象（技能）的三个操作（run / view / list）⇒ 合并为一个工具；旧名保留为 alias。
 *
 * 兼容口径：旧调用 `skill{name,arguments}` **不带 op** ⇒ 缺省 `op=run`（`defaultKey`），
 * 与合并前逐字一致；`skill_view` / `skills_list` 经 alias 归一化补 `op`。
 */
import { TOOL_NAME_CONSTANTS } from '@openliri/infra/constants/toolNameConstants';
import { SkillTool } from '../SkillTool/SkillTool';
import { SkillViewTool } from '../SkillTool/SkillViewTool';
import { SkillListTool } from '../SkillTool/SkillListTool';
import { SKILL_VIEW_OUTPUT_JSON_SCHEMA } from '../SkillTool/SkillViewTool';
import { FamilyTool } from './familyTool';

/**
 * 2026-11-20（U-03 补齐）：run 分支的 `data` 是**纯文本**（`executeSkill()` 恒返回 string，
 * 四个文案分支结构一致）⇒ 标量声明；不臆造字段。
 */
const SKILL_RUN_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'string',
  description: '技能执行结果文本（不同分支仅文案不同，结构一致）',
};

/** 2026-11-20（U-03 补齐）：list 分支的 `data` 为 `{skills:[{name,description}], total}` */
const SKILL_LIST_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    skills: {
      type: 'array',
      description: '可用技能列表',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能名称' },
          description: {
            type: 'string',
            description: '技能描述（缺失补空串）',
          },
        },
        required: ['name', 'description'],
      },
    },
    total: { type: 'number', description: '技能总数（= skills.length）' },
  },
  required: ['skills', 'total'],
};

export function createSkillFamilyTool(): FamilyTool {
  return new FamilyTool({
    name: TOOL_NAME_CONSTANTS.skill,
    description:
      '技能统一入口（op 分派）：op="run" 执行指定技能（可传 arguments）；' +
      'op="view" 查看技能内容（SKILL.md / prompt 原文）；op="list" 列出可用技能。' +
      '省略 op 时按旧的 `skill{name,arguments}` 语义执行（run）。',
    discriminator: 'op',
    discriminatorDescription:
      '操作：run（执行）| view（查看）| list（列出）；缺省 run',
    searchTips: ['skill', 'skills', 'run skill', 'skill list'],
    defaultKey: 'run',
    params: [
      {
        name: 'name',
        type: 'string',
        description: '技能名（op=run/view 需要）',
        required: false,
      },
      {
        name: 'arguments',
        type: 'object',
        description: 'op=run：传给技能的参数对象（可选）',
        required: false,
      },
    ],
    members: [
      {
        key: 'run',
        legacyName: TOOL_NAME_CONSTANTS.skill,
        required: ['name'],
        readOnly: false,
        outputJsonSchema: SKILL_RUN_OUTPUT_JSON_SCHEMA,
        create: () => new SkillTool(),
      },
      {
        key: 'view',
        legacyName: TOOL_NAME_CONSTANTS.skill_view,
        required: ['name'],
        readOnly: true,
        outputJsonSchema: SKILL_VIEW_OUTPUT_JSON_SCHEMA,
        create: () => new SkillViewTool(),
      },
      {
        key: 'list',
        legacyName: TOOL_NAME_CONSTANTS.skills_list,
        readOnly: true,
        outputJsonSchema: SKILL_LIST_OUTPUT_JSON_SCHEMA,
        create: () => new SkillListTool(),
      },
    ],
  });
}

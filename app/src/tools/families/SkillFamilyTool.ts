/**
 * skill 族（P1，2026-10-30）：`skill` / `skill_view` / `skills_list` → `skill`（`op` 分派）
 *
 * 同一对象（技能）的三个操作（run / view / list）⇒ 合并为一个工具；旧名保留为 alias。
 *
 * 兼容口径：旧调用 `skill{name,arguments}` **不带 op** ⇒ 缺省 `op=run`（`defaultKey`），
 * 与合并前逐字一致；`skill_view` / `skills_list` 经 alias 归一化补 `op`。
 */
import { TOOL_NAME_CONSTANTS } from '../../constants/toolNameConstants';
import { SkillTool } from '../SkillTool/SkillTool';
import { SkillViewTool } from '../SkillTool/SkillViewTool';
import { SkillListTool } from '../SkillTool/SkillListTool';
import { FamilyTool } from './familyTool';

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
        create: () => new SkillTool(),
      },
      {
        key: 'view',
        legacyName: TOOL_NAME_CONSTANTS.skill_view,
        required: ['name'],
        readOnly: true,
        create: () => new SkillViewTool(),
      },
      {
        key: 'list',
        legacyName: TOOL_NAME_CONSTANTS.skills_list,
        readOnly: true,
        create: () => new SkillListTool(),
      },
    ],
  });
}

/**
 * worktree 族（P1，2026-10-30）：`enter_worktree` / `exit_worktree` → `worktree`（`op` 分派）
 *
 * 同一状态机（进入/退出工作树）⇒ 合并为一个工具，旧名保留为 alias。
 * 沿用旧行为：`shouldDefer = true`，且**仅在 git 仓库内**启用（`isInsideGitRepo()`）。
 */
import { TOOL_NAME_CONSTANTS } from '../../constants/toolNameConstants';
import { isInsideGitRepo } from '@modules/workspaces';
import { EnterWorktreeTool } from '../EnterWorktreeTool/EnterWorktreeTool';
import { ExitWorktreeTool } from '../ExitWorktreeTool/ExitWorktreeTool';
import { FamilyTool } from './familyTool';

export function createWorktreeFamilyTool(): FamilyTool {
  return new FamilyTool({
    name: TOOL_NAME_CONSTANTS.worktree,
    description:
      '工作树（git worktree）进出统一入口（op 分派）：' +
      'op="enter" 以 slug 创建并进入隔离工作树（可指定基线 branch）；' +
      'op="exit" 退出指定工作树（remove=true 时一并删除目录）。',
    discriminator: 'op',
    discriminatorDescription: '操作：enter（进入/创建）| exit（退出）',
    searchTips: ['worktree', 'git', 'branch', 'isolate'],
    shouldDefer: true,
    isEnabled: () => isInsideGitRepo(),
    params: [
      {
        name: 'slug',
        type: 'string',
        description: 'worktree 标识（仅字母/数字/连字符/下划线）',
        required: false,
      },
      {
        name: 'branch',
        type: 'string',
        description: 'op=enter：基于的分支（可选，默认新建 worktree/<slug>）',
        required: false,
      },
      {
        name: 'remove',
        type: 'boolean',
        description: 'op=exit：是否同时删除 worktree 目录（默认 false）',
        required: false,
        default: false,
      },
    ],
    members: [
      {
        key: 'enter',
        legacyName: TOOL_NAME_CONSTANTS.enter_worktree,
        required: ['slug'],
        readOnly: false,
        create: () => new EnterWorktreeTool(),
      },
      {
        key: 'exit',
        legacyName: TOOL_NAME_CONSTANTS.exit_worktree,
        required: ['slug'],
        readOnly: false,
        destructive: true,
        create: () => new ExitWorktreeTool(),
      },
    ],
    inferKey: (input) => {
      if (typeof input['branch'] === 'string') return 'enter';
      if (typeof input['remove'] === 'boolean') return 'exit';
      return undefined;
    },
  });
}

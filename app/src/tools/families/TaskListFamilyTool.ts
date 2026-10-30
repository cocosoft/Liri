/**
 * task_list 族（P1，2026-10-30）：`create_task_list` / `get_task_list` / `update_task_status`
 * → `task_list`（`op` 分派）
 *
 * 三者是"同一对象（长任务清单）的三种操作" ⇒ 合并；`task_output` / `task_stop`
 * **保持独立**（不同生命周期，见治理方案 §4.1）。
 *
 * 兼容口径：三个旧工具的 `params` 里都带一个**从未被读取**的 `action` 占位字段
 * （行为由工具名决定）⇒ 合并后由 `op` 正式承接该语义；缺省 `op=get`（只读兜底）。
 */
import { TOOL_NAME_CONSTANTS } from '../../constants/toolNameConstants';
import {
  TaskCreateListTool,
  TaskGetListTool,
  TaskUpdateStatusTool,
} from '../TaskOrchestratorTools/TaskOrchestratorTools';
import { FamilyTool } from './familyTool';

export function createTaskListFamilyTool(): FamilyTool {
  return new FamilyTool({
    name: TOOL_NAME_CONSTANTS.task_list,
    description:
      '长任务清单统一入口（op 分派）：op="create" 建清单（tasks 为任务描述数组）；' +
      'op="get" 查询清单与统计；op="update" 更新某个任务状态（task_id + status）。' +
      '省略 op 时按只读的 get 处理；后台任务输出/停止用 task_output / task_stop。',
    discriminator: 'op',
    discriminatorDescription:
      '操作：create（建清单）| get（查询）| update（改状态）',
    searchTips: ['task list', 'tasks', 'checklist', 'task status'],
    defaultKey: 'get',
    params: [
      {
        name: 'tasks',
        type: 'array',
        description: 'op=create：任务项数组（字符串或 {description} 对象）',
        required: false,
        items: { type: 'string' },
      },
      {
        name: 'task_id',
        type: 'string',
        description: 'op=update：要更新的任务 ID',
        required: false,
      },
      {
        name: 'status',
        type: 'string',
        // 不在此重复任务状态词汇（唯一事实源 = 原 `update_task_status` 的校验；避免第二套枚举，
        // 也避免在工具层新增"状态字面量"——`lint:state-ratchet` 口径）。
        description:
          'op=update：新状态（合法取值沿用原 update_task_status 的校验；非法值会被明确拒绝）',
        required: false,
      },
    ],
    members: [
      {
        key: 'create',
        legacyName: TOOL_NAME_CONSTANTS.create_task_list,
        required: ['tasks'],
        readOnly: false,
        create: () => new TaskCreateListTool(),
      },
      {
        key: 'get',
        legacyName: TOOL_NAME_CONSTANTS.get_task_list,
        readOnly: true,
        create: () => new TaskGetListTool(),
      },
      {
        key: 'update',
        legacyName: TOOL_NAME_CONSTANTS.update_task_status,
        required: ['task_id', 'status'],
        readOnly: false,
        create: () => new TaskUpdateStatusTool(),
      },
    ],
    inferKey: (input) => {
      if (Array.isArray(input['tasks'])) return 'create';
      if (typeof input['task_id'] === 'string') return 'update';
      return undefined;
    },
  });
}

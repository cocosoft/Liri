/**
 * sleep 族（P1，2026-10-30）：`sleep` / `sleep_for` / `sleep_until` → `sleep`（`mode` 分派）
 *
 * 三者是"同一意图的三种参数形态"（治理方案 §4.1）：
 * - `duration`：本地阻塞 `durationMs`（原 `sleep`，实测 0 调用）；
 * - `wake`：登记"N 秒后自唤醒"（原 `sleep_for`，走 `SelfWakeService` + 会话续跑）；
 * - `until`：登记"到某 ISO 时刻自唤醒"（原 `sleep_until`）。
 *
 * ⚠️ `wake` / `until` **不是**本地阻塞：它们依赖 `context.sessionId` 与 CG3 自唤醒服务，
 * 语义差异在参数描述与错误文案里显式写明（不合并成一个"看起来一样"的参数）。
 */
import { TOOL_NAME_CONSTANTS } from '../../constants/toolNameConstants';
import { SleepTool } from '../SleepTool/SleepTool';
import {
  createSleepForTool,
  createSleepUntilTool,
} from '../SelfWakeTool/SelfWakeTool';
import { FamilyTool } from './familyTool';

export function createSleepFamilyTool(): FamilyTool {
  return new FamilyTool({
    name: TOOL_NAME_CONSTANTS.sleep,
    description:
      '等待/定时唤醒的统一入口（mode 分派）：' +
      'mode="duration" 本地阻塞等待 durationMs 毫秒（100–300000）；' +
      'mode="wake" 登记 seconds 秒后自唤醒并续跑本会话（非阻塞，需会话上下文）；' +
      'mode="until" 登记在指定 ISO 时间自唤醒（非阻塞，需会话上下文）。',
    discriminator: 'mode',
    discriminatorDescription:
      '等待方式：duration（本地阻塞）/ wake（N 秒后自唤醒）/ until（到指定时间自唤醒）',
    searchTips: ['sleep', 'wait', 'delay', 'pause', 'wake', 'timer'],
    params: [
      {
        name: 'durationMs',
        type: 'number',
        description: 'mode=duration：阻塞时长（毫秒，100–300000）',
        required: false,
        minimum: 100,
        maximum: 300000,
      },
      {
        name: 'reason',
        type: 'string',
        description: 'mode=duration：可选的等待原因',
        required: false,
      },
      {
        name: 'seconds',
        type: 'number',
        description: 'mode=wake：多少秒后自唤醒（最大 86400）',
        required: false,
      },
      {
        name: 'when',
        type: 'string',
        description:
          'mode=until：自唤醒的绝对时间（ISO 8601，如 2026-10-30T12:00:00Z）',
        required: false,
      },
    ],
    members: [
      {
        key: 'duration',
        legacyName: TOOL_NAME_CONSTANTS.sleep,
        legacyAliases: ['wait', 'delay', 'pause'],
        required: ['durationMs'],
        readOnly: true,
        create: () => new SleepTool(),
      },
      {
        key: 'wake',
        legacyName: TOOL_NAME_CONSTANTS.sleep_for,
        required: ['seconds'],
        readOnly: true,
        create: () => createSleepForTool(),
      },
      {
        key: 'until',
        legacyName: TOOL_NAME_CONSTANTS.sleep_until,
        required: ['when'],
        readOnly: true,
        create: () => createSleepUntilTool(),
      },
    ],
    // 形态推断：旧名调用若未带 mode（未经 alias 归一化的入口），按入参形态猜无歧义分支
    inferKey: (input) => {
      if (typeof input['seconds'] === 'number') return 'wake';
      if (typeof input['when'] === 'string') return 'until';
      if (typeof input['durationMs'] === 'number') return 'duration';
      return undefined;
    },
  });
}

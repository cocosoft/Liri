/**
 * 前后端状态词汇契约（治理方案 P1-2，2026-11-24）。
 *
 * 定位：**纯数据 + 零依赖**的跨端词汇登记表。前端（`@shared/*`）与门禁测试共用同一份，
 * 避免"前端自己一套词、后端目录一套词"漂移。
 *
 * 口径：
 * - `machineId` 必须存在于 `stateMachineCatalog.ts` 的 `STATE_MACHINES`；
 * - `values` 是该前端实现实际使用的取值；
 * - `aliases` 声明"前端取值 → 后端取值"的改名映射（未声明 ⇒ 视为同名）；
 * - `uiOnly` 声明前端独有取值，**必须带理由**（否则跨端一致性测试会红）。
 */

export interface ClientStateVocabularyEntry {
  /** 对应后端定义目录的机器 id */
  machineId: string;
  /** 前端实现文件（仓库相对路径；测试校验其存在） */
  clientFile: string;
  /** 前端使用的取值集合 */
  values: readonly string[];
  /** 前端取值 → 后端取值（未列出的按同名处理） */
  aliases?: Readonly<Record<string, string>>;
  /** 前端独有取值 → 理由（后端无对应状态） */
  uiOnly?: Readonly<Record<string, string>>;
}

/**
 * 已登记的前端状态词汇。
 *
 * 2026-11-24（P1-2）首批登记 2 项（均为本轮/近期统一过的派生面）：
 * - `toolCall`：`deriveToolOutcome` 的 6 态（`pending_approval` / `interrupted` 为投影）
 * - `task`：任务卡状态表（`in_progress` 改名；`cancelled` / `skipped` 为 UI 独有）
 */
export const CLIENT_STATE_VOCABULARY: readonly ClientStateVocabularyEntry[] = [
  {
    machineId: 'toolCall',
    clientFile: 'client/src/stores/chat/toolOutcome.ts',
    values: [
      'pending_approval',
      'running',
      'completed',
      'failed',
      'interrupted',
      'unknown',
    ],
    aliases: {
      // 待审批在数据层仍是 running（另有 pendingApproval 标记）
      pending_approval: 'running',
      // 无终态/无结果：与后端"副作用不可知"的 unknown 同义
      interrupted: 'unknown',
    },
  },
  {
    machineId: 'task',
    clientFile: 'client/src/constants/taskStatus.ts',
    values: [
      'pending',
      'in_progress',
      'completed',
      'failed',
      'cancelled',
      'blocked',
      'skipped',
    ],
    aliases: {
      in_progress: 'running',
    },
    uiOnly: {
      cancelled: '后端 TaskStatus 用 killed/lost 表达终止；cancelled 是 LRO/计划轴的词汇',
      skipped: 'UI 词汇表（BOUNDARY uiTaskStatus），后端 TaskStatus 无 skipped',
    },
  },
];

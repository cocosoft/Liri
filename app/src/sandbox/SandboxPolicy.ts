/**
 * 沙箱策略 —— **现只保留"输出上限"这一件事**（B1 唯一来源）。
 *
 * 沿革（2026-09-29，台账 **D-42**）：本文件原有**另一半** —— **工具白/黑名单门禁**
 * （`SandboxToolPolicy` / `SandboxMode` / `SandboxGlobalPolicy` / `createSandboxPolicy` /
 * `isToolAllowed` / `getAllowedTools` / `getDeniedTools` / `restrictToolSet` / `validateToolAccess` /
 * `PRODUCTION_SANDBOX_POLICY`）。经核实该门禁**全仓零生产消费者**（外部同名
 * `PermissionSyncManager.isToolAllowed` 当时是**另一个符号** —— 它**同样零消费者**，
 * 已于 **2026-10-06 删除**，见台账 **N-82**；`evals/cli.ts` 的 `SandboxMode`
 * 亦为**本地独立类型**）⇒ 属**死门禁**；且其默认集**大面积漂移**
 * （`DEFAULT_ALLOWED_BASE_TOOLS` 12 项里 **9 项**是 CC 名，真名仅 `bash`/`grep`/`glob`）
 * ⇒ 与 **N-27 / D-25** 同族，**整段删除**（连同其唯一"消费者"—— 仅断言自身字段的测试用例）。
 *
 * 保留部分（**活**）：`MAX_OUTPUT_BYTES_SOFT` / `MAX_OUTPUT_BYTES_HARD` / `resolveOutputLimit` /
 * `appendWithinLimit` —— 消费者：`PTYSandbox` / `SSHSandbox` / `tools/bash/bashLandlockExec`。
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('sandbox:policy');

/**
 * 输出上限的**唯一来源**（B1，2026-09-26，《Liri 优化方案》）。
 *
 * **双层语义**（对齐 `tools/bash/BashTool.ts` 的成熟分法）：
 * - `MAX_OUTPUT_BYTES_SOFT`：**软截断**（保上下文）—— 命中也只是丢弃后续输出；
 * - `MAX_OUTPUT_BYTES_HARD`：**硬上限**（防 OOM）—— 任何一层都不得超出。
 *
 * **改前状况（实测）**：策略层 `maxOutputBytes` **零消费者**（仅 `sandbox/index.ts` 桶导出），
 * 而后端 `PTYSandbox` / `SSHSandbox` **各写一份 1MB 默认值** ⇒ 名义契约 ≠ 实际契约。
 * 现在两侧都从**本文件**取数：后端 `resolveOutputLimit({ soft: 配置值 })`，不再自设默认。
 * （**注**：该"策略层"对象本身已于 2026-09-29 随死门禁一并删除，见文件头沿革 —— 本条留作历史记录。）
 *
 * ⚠️ **不同层不要混**：`DockerSandbox.ts` 的 `exec` `maxBuffer`（10MB）属**子进程缓冲**层，
 * 与"输出上限"不是一回事，**不由此派生**（方案 §1.1 #14 的更正）。同理 `tools/bash/BashTool.ts`
 * 的 16MB/2MB 是**工具层**软硬双限，语义自成一档，其实现是本双层语义的**参照**而非消费者。
 */
export const MAX_OUTPUT_BYTES_SOFT = 1024 * 1024;
export const MAX_OUTPUT_BYTES_HARD = 16 * 1024 * 1024;

/**
 * 把 `block` 追加进 `acc`，但**不越过** `limitChars`；返回新值与**被丢弃的真实字节数**。
 *
 * **为什么需要**（B1，2026-09-26）：两个后端原来的写法是"累计长度未超限就**整块**追加"
 * （`if (acc.length < limit) acc += chunk`）⇒ 单块输出可以直接突破上限、且**无法确定性判定**
 * 是否真的截断（命中与否取决于 OS 分块时机）⇒ 边界单测不可写。本助手逐块**按剩余量切片**。
 *
 * **单位说明（如实）**：`limitChars` 按**字符数**比较 —— 与既有实现一致（`maxOutputBytes`
 * 名义为字节，实际按 `String.length` 比较，属既有口径）；但**丢弃量按真实字节**统计，
 * 使 `truncatedBytes` 可作准。严格字节口径需改造累积结构，留待后续批次。
 */
export function appendWithinLimit(
  acc: string,
  block: string,
  limitChars: number
): { text: string; droppedBytes: number } {
  const remaining = limitChars - acc.length;
  if (remaining <= 0) {
    return { text: acc, droppedBytes: Buffer.byteLength(block, 'utf-8') };
  }
  if (block.length <= remaining) {
    return { text: acc + block, droppedBytes: 0 };
  }
  return {
    text: acc + block.slice(0, remaining),
    droppedBytes: Buffer.byteLength(block.slice(remaining), 'utf-8'),
  };
}

/**
 * 解析实际生效的输出上限 —— **后端统一经此取数**（不各自写默认值）。
 *
 * 边界：软上限不得大于硬上限；非法组合（如误配反了）回落为硬上限并告警，而不是静默采用。
 */
export function resolveOutputLimit(
  overrides: { soft?: number; hard?: number } = {}
): { soft: number; hard: number } {
  const hard = overrides.hard ?? MAX_OUTPUT_BYTES_HARD;
  const soft = overrides.soft ?? MAX_OUTPUT_BYTES_SOFT;
  if (soft > hard) {
    logger.warning('输出上限配置异常：软上限 > 硬上限，已回落为硬上限', {
      soft,
      hard,
    });
    return { soft: hard, hard };
  }
  return { soft, hard };
}

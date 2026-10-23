/**
 * deprecationNotice.ts — 内核「C 档待观察模块」的**加载期告警**（2026-10-23）
 *
 * 背景：`dev_docs/20261023/core-减重盘点清单.md` 的 C 档有 5 个目录是**三重零引用**
 * （深路径 0 / 导出符号 0 / 路径字符串 0），但按 `.trae/rules/code-deletion.md` CD07
 * **不得**凭"静态零引用"删除（v0.4.69 沙箱误删事故的教训）。
 *
 * 观测手段：模块**被真实加载时**打一条 warn ——
 *   · 没人加载 ⇒ 零噪音（不会污染每次启动）；
 *   · 有人加载 ⇒ 日志里立刻出现「它仍在被用」，据此决定"恢复使用"还是"补入口取证后删除"。
 *
 * 约束：只用 `loggerFacade`（core 内**零三方依赖**），进程内每模块只告警一次
 * （ESM 模块缓存天然保证 —— 本函数在模块顶层调用，重复 import 不会重复执行）。
 */

import { getLogger } from './loggerFacade.js';

const logger = getLogger('core:deprecation');

/**
 * 记录一次「已标记 @deprecated 的内核模块被加载」。
 *
 * @param moduleId 形如 `storage/SecureStorage`（相对 `app/src/core`）
 * @param evidence 该模块为何进入观察期（例：三重零引用）
 */
export function warnDeprecatedCoreModule(
  moduleId: string,
  evidence: string
): void {
  logger.warning(
    `[deprecated] 内核模块被加载：core/${moduleId} —— ${evidence}；` +
      '处于 C 档观察期（见 dev_docs/20261023/core-减重盘点清单.md §3）。' +
      '如确为在役依赖：请移除该模块的 @deprecated 标记并补测试；否则按 CD01–CD07 取证后下线'
  );
}

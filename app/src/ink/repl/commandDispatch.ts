/**
 * Ink REPL 的斜杠命令派发（方案①，2026-10-16）
 *
 * 与客户端 Terminal 页（`POST /v1/commands/execute`）、非流式 HTTP（`CoreAPI.chat` →
 * `ChatOrchestrator._handleCommand`）走**同一个**全局 `commandExecutor` ⇒ 命令实现唯一，
 * 本模块**不**另立命令表（CS01）。
 *
 * 为什么独立成模块：ink 渲染层在本仓无可用的测试夹具（无伪终端 / 无 ink 测试库），
 * 把"执行 + 结果整形"这唯一有分支的逻辑抽成不依赖 ink 的模块后可直接单测
 * （见 `app/tests/ink/commandDispatch.test.ts`）。
 */
import { getLogger } from '@modules/monitoring';
// 仅类型（编译期擦除 ⇒ 不引入运行时耦合；命令执行仍走下面的动态 import）
import type { CommandDisplay } from '@modules/commands';

const logger = getLogger('ink:repl:commandDispatch');

/**
 * 执行一条斜杠命令并整形为可展示文本。
 *
 * @param command 形如 `/budget status` 的完整命令行
 * @param sessionId 当前会话 id（命令可据此读写会话上下文，如 `/compact`）
 */
export async function dispatchSlashCommand(
  command: string,
  sessionId?: string
): Promise<CommandDisplay> {
  try {
    const { commandExecutor, formatCommandResult } =
      await import('@modules/commands');
    const { resolveProjectRoot } = await import('@modules/environment');
    const result = await commandExecutor.execute(command, {
      sessionId: sessionId ?? 'ink-session',
      cwd: resolveProjectRoot(),
    });

    // 取值口径由 `formatCommandResult` **单一实现**（③ 2026-10-16 收敛）：未注册命令
    //（`{success:false, error:'Command not found: …'}`，不抛）也如实回报，不再是空消息。
    // 不做错误码字符串匹配（CS02）。
    return formatCommandResult(result);
  } catch (error) {
    // 命令实现可由 skill / 插件提供（外部边界）⇒ 抛错不得让 REPL 崩：如实回一条失败文案
    logger.warning('斜杠命令执行抛错', {
      command,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      text: `❌ 命令执行失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

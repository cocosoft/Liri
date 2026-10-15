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

const logger = getLogger('ink:repl:commandDispatch');

export interface SlashCommandOutcome {
  /** 命令是否执行成功（对应 `CommandResult.success`） */
  ok: boolean;
  /** 供 REPL 展示的文本（故障已整形为可读文案，调用方直接渲染即可） */
  text: string;
}

/**
 * 执行一条斜杠命令并整形为可展示文本。
 *
 * @param command 形如 `/budget status` 的完整命令行
 * @param sessionId 当前会话 id（命令可据此读写会话上下文，如 `/compact`）
 */
export async function dispatchSlashCommand(
  command: string,
  sessionId?: string
): Promise<SlashCommandOutcome> {
  try {
    const { commandExecutor } = await import('@modules/commands');
    const { resolveProjectRoot } = await import('@modules/core/paths');
    const result = await commandExecutor.execute(command, {
      sessionId: sessionId ?? 'ink-session',
      cwd: resolveProjectRoot(),
    });

    if (!result.success) {
      // 未知名/未启用/环境不满足均由 `CommandManager.executeCommand` 以 `success:false`
      // + `error` 返回（不抛）⇒ 原样呈现，不做错误码字符串匹配（CS02）
      return { ok: false, text: `❌ ${result.error || '命令执行失败'}` };
    }

    // 展示口径与 `entrypoints/repl.ts`（legacy REPL / 一次性执行）一致：message → value → data
    const text =
      result.message ||
      result.value ||
      (result.data !== undefined ? JSON.stringify(result.data, null, 2) : '');

    return { ok: true, text: text || '（命令无输出）' };
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

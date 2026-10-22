// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * promptCommand — 斜杠命令里 **`type: 'prompt'`** 的展开（2026-10-22）
 *
 * **缺陷现场**：`ChatOrchestrator._handleCommand` 对所有 `/xxx` 一律走
 * `commandExecutor.execute()` 并**短路**本轮模型调用。对 `type:'prompt'` 的命令
 * （`security-review` / `plan` / `review` …）而言，真正的执行体是 `getPromptForCommand()`：
 * 它产出"要给模型的提示词"，而 `execute()` 只回一段"本命令需要在对话中由 AI 执行"的用法文案
 * ⇒ GUI/渠道里打 `/security-review` 永远不会真的开始审查。
 *
 * **本模块的边界（只做三件纯事，不碰消息落库/模型调用）**：
 *  ① `parseSlashCommand`：拆出命令名与参数；
 *  ② `expandPromptCommand`：命中 prompt 型命令时返回展开后的提示词，其余一律 `null`
 *     （调用方继续走原来的 `_handleCommand` 短路，行为不变）；
 *  ③ `mergeRuntimeNote`：把展开的提示词并入本轮 `runtimeSystemNote`（原有内容保留在前）。
 *
 * **为什么不替换用户消息**：用户消息仍是用户敲的那条 `/security-review`（落库与回显不变），
 * 展开后的长提示词只作为本轮运行时补充进入模型 —— 否则会话列表/导出里会出现几十行提示词。
 */

/** 命令定义中本模块需要的**最小**形状（避免引入 commands 全量类型） */
export interface PromptCommandLike {
  type?: string;
  getPromptForCommand?: (
    args: string
  ) => string | Promise<Array<{ type: string; text: string }>>;
  /**
   * 懒加载命令（`LazyCommand`）：真实实现挂在 `load()` 返回的对象上，
   * 命令定义本身**没有** `getPromptForCommand`（`security-review` 就属这种）。
   */
  load?: () => Promise<
    | {
        getPromptForCommand?: (
          args: string
        ) => string | Promise<Array<{ type: string; text: string }>>;
      }
    | undefined
  >;
}

/** 按名/别名取命令的**最小**端口（生产实现 = `getCommandManager()`） */
export interface PromptCommandSource {
  getCommand(name: string): PromptCommandLike | undefined;
}

/** 拆 `/name args…` ⇒ `{ name, args }`；不是斜杠命令 ⇒ `null` */
export function parseSlashCommand(
  content: string
): { name: string; args: string } | null {
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(content.trim());
  if (!match) return null;
  return { name: match[1]!, args: (match[2] ?? '').trim() };
}

/**
 * 斜杠命令 → 展开后的提示词。
 * - 非斜杠 / 未注册 / 非 `prompt` 型 / 无 `getPromptForCommand` ⇒ `null`（调用方保持旧行为）
 * - 展开结果为空串 ⇒ `null`（不注入空补充）
 * - 展开抛错 ⇒ `null` 并交给调用方记日志（失败不阻断本轮对话）
 */
export async function expandPromptCommand(
  content: string,
  source: PromptCommandSource
): Promise<
  | { ok: true; prompt: string; name: string }
  | { ok: false; name?: string; error?: string }
> {
  const parsed = parseSlashCommand(content);
  if (!parsed) return { ok: false };

  const command = source.getCommand(parsed.name);
  if (!command || command.type !== 'prompt') return { ok: false };

  try {
    // 定义上直接实现（registry 里的内联命令）优先；否则取懒加载实现上的（LazyCommand 形态）
    let build = command.getPromptForCommand;
    if (typeof build !== 'function' && typeof command.load === 'function') {
      const impl = await command.load();
      build = impl?.getPromptForCommand;
    }
    if (typeof build !== 'function') return { ok: false, name: parsed.name };

    const blocks = await build(parsed.args);
    const prompt = Array.isArray(blocks)
      ? blocks.map((block) => block.text).join('\n\n')
      : String(blocks ?? '');
    if (!prompt.trim()) return { ok: false, name: parsed.name };
    return { ok: true, prompt, name: parsed.name };
  } catch (error) {
    return {
      ok: false,
      name: parsed.name,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 合并运行时补充：已有内容在前、命令提示词在后（两者都保留） */
export function mergeRuntimeNote(
  existing: string | undefined,
  extra: string
): string {
  return existing && existing.trim() ? `${existing}\n\n${extra}` : extra;
}

/**
 * P39（2026-11-06）：`sessionTitling` 对 **app 侧 Agent 能力**（标题生成器）的注入端口。
 *
 * **为什么需要**：`getTitleGenerator()` 由 `@modules/agent` 提供（app 层），
 * 包内直连会被 `lint:infra` R8 判倒挂，并可能把 agent 整图拉进包程序。
 *
 * **注入方式**：实现由 entry 层在启动期推送注册
 * （`app/src/entrypoints/spiWiring.ts#registerAllSpis`）。未注册时返回 `undefined`，
 * 调用方按「标题生成不可用」降级（保留占位标题）。
 */

/** 标题生成器的最小契约（`generateTitle` 的第三个参数是「把消息发给模型」的回调） */
export interface RuntimeTitleGenerator {
  generateTitle(
    userMessage: string,
    assistantResponse: string,
    send: (messages: unknown[]) => Promise<string | null>
  ): Promise<string | null>;
}

type RuntimeTitleGeneratorFactory = () => RuntimeTitleGenerator;

let factory: RuntimeTitleGeneratorFactory | undefined;

/** 组合根注册（app 启动期一次性调用；传 `undefined` 可清除，供测试） */
export function registerRuntimeTitleGeneratorFactory(
  next: RuntimeTitleGeneratorFactory | undefined
): void {
  factory = next;
}

/** 取标题生成器；未注册 ⇒ `undefined`（调用方必须自行降级） */
export function getRuntimeTitleGenerator(): RuntimeTitleGenerator | undefined {
  return factory?.();
}

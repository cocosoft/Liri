/**
 * constants 模块的环境变量读取（2026-11-01 P1 解环）
 *
 * 背景：`constants` 曾直接 `import { configManager } from '@modules/config'`，而 `config` 又依赖
 * `constants` ⇒ infra 层内成环（R7 的 SCC 成员之一）。解环做法与 `error` 一致：
 * **constants 只保留读取入口，具体实现由 app 层启动期注入**（`bootstrap/preflight.wireConstantsDeps`）。
 *
 * 未注入时按"变量不存在"处理 —— 与变量未设置时的原有行为一致（所有调用点都在函数体内，属调用期读取，
 * 因此启动期接线一定先于使用）。
 */
let envReader: (name: string) => string | undefined = () => undefined;

/** 注入环境变量读取器（返回 disposer） */
export function setConstantsEnvReader(
  reader: (name: string) => string | undefined
): () => void {
  const previous = envReader;
  envReader = reader;
  return () => {
    envReader = previous;
  };
}

/** 读取环境变量（未注入 ⇒ undefined） */
export function readConstantEnv(name: string): string | undefined {
  return envReader(name);
}

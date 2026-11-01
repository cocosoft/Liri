/**
 * utils 模块的环境变量读取（2026-11-01 B4 解环）
 *
 * 背景：utils 有 8 个文件曾直接 `import { configManager } from '@modules/config'` 只为读 env，
 * 而 `config` 又（经 monitoring / error 等）间接依赖 `utils` ⇒ 二者同处 infra 的强连通分量
 * （R7 环成员）。解环做法：utils 不再持有 `config` 依赖，env 读取收敛到本文件。
 *
 * **为什么可以直接读 `process.env`**：`ConfigManager.env(name)` 的实现就是
 * `process.env[name] ?? defaultValue`（`config/ConfigManager.ts` 的 `env()`），**没有任何
 * 文件层 / 分层叠加**。因此本函数与它**逐字等价**，且不依赖调用时机 —— 少数调用点在模块顶层
 * 求值（如 `GitignoreParser` 的全局 gitignore 路径），启动期注入式的端口在这里反而会读到
 * 未注入的默认值。
 *
 * 等价性由 `tests/utils/envAccess.test.ts` 守护：若 `configManager.env` 的语义将来发生变化
 * （例如加入 `.env` 分层），该测试会立即变红，提示把本文件改为启动期注入。
 */
export function readUtilEnv(name: string): string | undefined {
  return process.env[name];
}

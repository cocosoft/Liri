/**
 * 可注入的 `child_process.spawn` 端口（P0-8，2026-10-04）。
 *
 * **为什么需要**：相关测试曾用 `mock.module('child_process', …)` 注入假 spawn —— bun 的模块 mock
 * 是**进程级全局且不可撤销**（`mock.restore()` 无效）⇒ 会泄漏给同进程**后续加载的所有测试文件**
 * （典型表现：后续文件拿到 stub ⇒ 莫名 `xxx is not a function`）。
 *
 * 改为**端口注入**：生产代码经 `getSpawnImpl()` 取实现 —— 默认 = 真实 `child_process.spawn`
 * （**零行为变化**）；测试用 `setSpawnImpl(fake)` 注入、用后 `setSpawnImpl(真实 spawn)` 还原
 * （对象/函数成员级、不外溢）。
 */
import { spawn as nodeSpawn } from 'child_process';

/** spawn 端口签名（= 真实 `child_process.spawn`） */
export type SpawnFn = typeof nodeSpawn;

let spawnImpl: SpawnFn = nodeSpawn;

/** 取当前 spawn 实现（生产路径 = 真实 `child_process.spawn`） */
export function getSpawnImpl(): SpawnFn {
  return spawnImpl;
}

/**
 * 注入 spawn 实现（DI）。
 *
 * ⚠️ 用后须还原：`setSpawnImpl(realSpawn)`（测试里 `import { spawn } from 'child_process'` 取真身）。
 * 只影响**本进程内**对 `getSpawnImpl()` 的读取 —— 不触碰模块注册表，故不会跨文件泄漏。
 */
export function setSpawnImpl(fn: SpawnFn): void {
  spawnImpl = fn;
}

/**
 * native/loaderPaths.js — Rust 原生库的**候选路径解析**（纯函数，无 IO）· T25-09（2026-10-25）
 *
 * 背景：原实现只看 `__dirname/target/release/<lib>`。但发布包的入口是**打包后的**
 * `dist/pkg/liri.js`（`__dirname` = 包根），原生库若不随包分发则**永远加载不到**，
 * 而加载失败只是 `console.warn` + 返回 `null` ⇒ Rust 加速在发布包里静默失效。
 *
 * 本模块只负责"去哪找"（可单测）；真正的 `dlopen` 与告警在 `index.js`。
 */
const path = require('path');

/** 当前平台的库文件名（Windows 为 `liri_native.dll`，其余 `libliri_native.<suffix>`） */
function nativeLibName(platform, suffix) {
  return platform === 'win32'
    ? 'liri_native.dll'
    : `libliri_native.${suffix}`;
}

/**
 * 平台默认库后缀（与 `bun:ffi` 的 `suffix` 同义）。
 *
 * 独立导出是为了让**构建脚本**不依赖 `bun:ffi` 的类型（`tsconfig.scripts` 无 bun 类型）。
 */
function nativeSuffix(platform) {
  if (platform === 'darwin') return 'dylib';
  if (platform === 'win32') return 'dll';
  return 'so';
}

/**
 * 候选绝对路径（按优先级）。
 *
 * 顺序（先命中先用）：
 *  ① `LIRI_NATIVE_LIB` 显式覆盖（完整文件路径，便于排障/自编译替换）；
 *  ② `<dirname>/target/release/<lib>` —— 开发态（`app/native/`）与**打包态**（包根）同一相对位置；
 *  ③ `<dirname>/native/target/release/<lib>` —— 打包时把库放在 `native/` 子目录的形态；
 *  ④ `<cwd>/native/target/release/<lib>` —— 从仓库根直接运行的形态。
 *
 * @param {{platform: string, suffix: string, dirname: string, cwd: string, env?: Record<string, string|undefined>}} input
 * @returns {string[]} 去重后的路径列表（空串/未定义项被剔除）
 */
function nativeLibCandidates(input) {
  const { platform, suffix, dirname, cwd, env } = input;
  const name = nativeLibName(platform, suffix);
  const list = [
    env && env.LIRI_NATIVE_LIB,
    path.join(dirname, 'target', 'release', name),
    path.join(dirname, 'native', 'target', 'release', name),
    path.join(cwd, 'native', 'target', 'release', name),
  ];
  return Array.from(
    new Set(
      list.filter((p) => typeof p === 'string' && p.trim().length > 0)
    )
  );
}

module.exports = { nativeLibName, nativeSuffix, nativeLibCandidates };

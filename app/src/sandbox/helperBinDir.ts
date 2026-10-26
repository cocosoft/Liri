/**
 * 沙箱 helper 的**随包目录**（`<PROJECT_DIR>/bin/`）—— 2026-10-26
 *
 * 单一来源：`landlock-run` 与 `win-sandbox-run.exe` 都从这里分发，避免两处各写一份
 * `SHIPPED_SUBDIR = 'bin'`（`lint:consts` 的「同名常量」门禁会拦重复定义）。
 */
export const SANDBOX_HELPER_BIN_DIR = 'bin';

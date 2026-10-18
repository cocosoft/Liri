/**
 * 工具输出类型 —— 原址**转发**（同 `Tool.ts` 的方案甲）。
 *
 * 2026-10-19（CI 循环依赖断环）：实现已下沉至契约层 `utils/toolContract/ToolOutputs`；
 * 本文件只做转发（G8 守卫：`tools/types/*` 不得就地声明）。
 */
export * from '@modules/utils/toolContract/ToolOutputs';

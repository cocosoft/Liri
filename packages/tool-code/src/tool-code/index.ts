// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `@openliri/tool-code` 公共出口 —— 代码理解域。
 *
 * - `lsp/`：LSP 客户端/服务器、符号检索、引用查找、悬停、调用层级、上下文；
 * - `repl/`：REPL 会话与实现；
 * - `notebook/`：Notebook 管理与单元执行（格式模型复用 `@openliri/tool-office`）；
 * - `adapters/`：`lsp` / `repl` / `notebook` 三个工具适配器；
 * - `CodeRunner/`：`code_run`（多语言沙箱执行；注册受 `CODE_MODE` 门控，默认关）。
 *
 * 注册动作（`builtinToolRegistry`）仍在 app：本包只提供工具实现与适配器。
 */

export * from './lsp';
export * from './repl';
export * from './notebook';
export { LSPToolAdapter } from './adapters/LSPToolAdapter';
export { REPLToolAdapter } from './adapters/REPLToolAdapter';
export { NotebookToolAdapter } from './adapters/NotebookToolAdapter';
export {
  LSP_OUTPUT_JSON_SCHEMA,
  REPL_OUTPUT_JSON_SCHEMA,
} from './adapters/schemas';
export {
  CodeRunnerTool,
  createCodeRunnerTool,
  configureCodeRunner,
  resolveCodeRunnerToolWhitelist,
  buildCodeRunnerToolManifest,
} from './CodeRunner/CodeRunnerTool';
export {
  runCodeRunnerSafely,
  decideCodeRunnerLandlock,
} from './CodeRunner/LinuxSandboxRunner';
export {
  setNativeJsAstLoader,
  type NativeJsAstModule,
} from './CodeRunner/staticValidation';

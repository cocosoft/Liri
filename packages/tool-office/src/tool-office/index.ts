// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `@openliri/tool-office` 公共出口 —— 办公文档域。
 *
 * 内容：文档生成（`DocGenerateTool`，走 officecli）、PDF 生成/提取（`PDFTool`）、
 * 文件转换引擎（`converter/`）与 Jupyter nbformat 数据模型 + 转换器（`notebook/`）。
 *
 * **不承载**注册动作与模块生命周期：`builtinToolRegistry` 仍由 app 负责构造与登记；
 * 保留在 app 的 `NotebookManager` / `NotebookToolImpl`（依赖 REPL 工具面）从本包导入格式模型。
 */

export * from './DocGenerateTool';
export * from './PDFTool';
export * from './converter';
export * from './notebook/types';
export * from './notebook/JupyterNotebookConverter';

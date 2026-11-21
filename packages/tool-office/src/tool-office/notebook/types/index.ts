// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * Notebook工具类型定义 - 整合所有类型到单一文件避免循环导入问题
 */

// 基础类型定义
export enum CellExecutionState {
  IDLE = 'idle',
  RUNNING = 'running',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  ABORTED = 'aborted',
}

export interface CellOutput {
  type: 'text' | 'html' | 'image' | 'error';
  content: string | Buffer;
  metadata?: Record<string, unknown>;
}

export interface CellExecutionResult {
  cellId: string;
  success: boolean;
  output?: CellOutput[];
  error?: string;
  executionTime: number;
}

export interface Cell {
  id: string;
  type: 'code' | 'markdown';
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
  executionState: CellExecutionState;
  executionTime?: number;
}

export interface CodeCell extends Cell {
  code: string;
  language: string;
  output?: CellOutput[];
}

export interface MarkdownCell extends Cell {
  content: string;
  renderedContent?: string;
}

export interface Notebook {
  id: string;
  name: string;
  path?: string;
  createdAt: Date;
  updatedAt: Date;
  cells: Cell[];
  metadata: Record<string, unknown>;
  version: string;
}

export interface NotebookTool {
  createNotebook(name: string): Promise<Notebook>;
  openNotebook(path: string): Promise<Notebook>;
  saveNotebook(notebook: Notebook): Promise<void>;
  saveNotebookAs(notebook: Notebook, path: string): Promise<void>;
  addCodeCell(
    notebook: Notebook,
    code: string,
    language: string
  ): Promise<CodeCell>;
  addMarkdownCell(notebook: Notebook, content: string): Promise<MarkdownCell>;
  executeCell(cell: CodeCell): Promise<CellExecutionResult>;
  executeAllCells(notebook: Notebook): Promise<CellExecutionResult[]>;
  exportNotebook(
    notebook: Notebook,
    format: 'html' | 'pdf' | 'markdown'
  ): Promise<Buffer>;
  getNotebooks(): Promise<Notebook[]>;
  deleteNotebook(notebook: Notebook): Promise<void>;
}

// 实现类导出
export { NotebookImpl } from './Notebook.js';
export { CodeCellImpl, MarkdownCellImpl } from './Cell.js';

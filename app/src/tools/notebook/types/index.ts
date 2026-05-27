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

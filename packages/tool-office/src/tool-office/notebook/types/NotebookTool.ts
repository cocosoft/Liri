/**
 * Notebook工具接口
 */

export interface NotebookTool {
  /**
   * 创建Notebook
   */
  createNotebook(name: string): Promise<Notebook>;

  /**
   * 打开Notebook
   */
  openNotebook(path: string): Promise<Notebook>;

  /**
   * 保存Notebook
   */
  saveNotebook(notebook: Notebook): Promise<void>;

  /**
   * 保存Notebook到指定路径
   */
  saveNotebookAs(notebook: Notebook, path: string): Promise<void>;

  /**
   * 添加代码单元格
   */
  addCodeCell(
    notebook: Notebook,
    code: string,
    language: string
  ): Promise<CodeCell>;

  /**
   * 添加Markdown单元格
   */
  addMarkdownCell(notebook: Notebook, content: string): Promise<MarkdownCell>;

  /**
   * 执行单元格
   */
  executeCell(cell: CodeCell): Promise<CellExecutionResult>;

  /**
   * 执行所有单元格
   */
  executeAllCells(notebook: Notebook): Promise<CellExecutionResult[]>;

  /**
   * 导出Notebook
   */
  exportNotebook(
    notebook: Notebook,
    format: 'html' | 'pdf' | 'markdown'
  ): Promise<Buffer>;

  /**
   * 获取所有Notebook
   */
  getNotebooks(): Promise<Notebook[]>;

  /**
   * 删除Notebook
   */
  deleteNotebook(notebook: Notebook): Promise<void>;
}

/**
 * Notebook
 */
export interface Notebook {
  /**
   * Notebook ID
   */
  id: string;

  /**
   * 名称
   */
  name: string;

  /**
   * 路径
   */
  path?: string;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 更新时间
   */
  updatedAt: Date;

  /**
   * 单元格列表
   */
  cells: Cell[];

  /**
   * 元数据
   */
  metadata: Record<string, unknown>;

  /**
   * 版本
   */
  version: string;
}

/**
 * 单元格
 */
export interface Cell {
  /**
   * 单元格ID
   */
  id: string;

  /**
   * 单元格类型
   */
  type: 'code' | 'markdown';

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 更新时间
   */
  updatedAt: Date;

  /**
   * 元数据
   */
  metadata: Record<string, unknown>;

  /**
   * 执行状态
   */
  executionState: CellExecutionState;

  /**
   * 执行时间
   */
  executionTime?: number;
}

/**
 * 代码单元格
 */
export interface CodeCell extends Cell {
  /**
   * 代码内容
   */
  code: string;

  /**
   * 语言
   */
  language: string;

  /**
   * 输出
   */
  output?: CellOutput[];
}

/**
 * Markdown单元格
 */
export interface MarkdownCell extends Cell {
  /**
   * Markdown内容
   */
  content: string;

  /**
   * 渲染后的HTML
   */
  renderedContent?: string;
}

/**
 * 单元格执行状态
 */
export enum CellExecutionState {
  IDLE = 'idle',
  RUNNING = 'running',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  ABORTED = 'aborted',
}

/**
 * 单元格输出
 */
export interface CellOutput {
  /**
   * 输出类型
   */
  type: 'text' | 'html' | 'image' | 'error';

  /**
   * 输出内容
   */
  content: string | Buffer;

  /**
   * 元数据
   */
  metadata?: Record<string, unknown>;
}

/**
 * 单元格执行结果
 */
export interface CellExecutionResult {
  /**
   * 单元格ID
   */
  cellId: string;

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 输出
   */
  output?: CellOutput[];

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 执行时间（毫秒）
   */
  executionTime: number;
}

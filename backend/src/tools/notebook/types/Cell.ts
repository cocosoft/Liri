/**
 * 单元格类型定义
 */

import {
  CellExecutionState,
  CellOutput,
  CodeCell,
  MarkdownCell,
} from './NotebookTool.js';

/**
 * 代码单元格实现
 */
export class CodeCellImpl implements CodeCell {
  /**
   * 单元格ID
   */
  id: string;

  /**
   * 单元格类型
   */
  type: 'code' = 'code';

  /**
   * 代码内容
   */
  code: string;

  /**
   * 语言
   */
  language: string;

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
  metadata: Record<string, any>;

  /**
   * 执行状态
   */
  executionState: CellExecutionState;

  /**
   * 执行时间
   */
  executionTime?: number;

  /**
   * 输出
   */
  output?: CellOutput[];

  /**
   * 构造函数
   */
  constructor(id: string, code: string, language: string) {
    this.id = id;
    this.code = code;
    this.language = language;
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.metadata = {};
    this.executionState = CellExecutionState.IDLE;
    this.output = [];
  }

  /**
   * 更新代码
   */
  updateCode(code: string): void {
    this.code = code;
    this.updatedAt = new Date();
  }

  /**
   * 更新执行状态
   */
  updateExecutionState(state: CellExecutionState): void {
    this.executionState = state;
  }

  /**
   * 添加输出
   */
  addOutput(output: CellOutput): void {
    if (!this.output) {
      this.output = [];
    }
    this.output.push(output);
  }

  /**
   * 清空输出
   */
  clearOutput(): void {
    this.output = [];
  }
}

/**
 * Markdown单元格实现
 */
export class MarkdownCellImpl implements MarkdownCell {
  /**
   * 单元格ID
   */
  id: string;

  /**
   * 单元格类型
   */
  type: 'markdown' = 'markdown';

  /**
   * Markdown内容
   */
  content: string;

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
  metadata: Record<string, any>;

  /**
   * 执行状态
   */
  executionState: CellExecutionState;

  /**
   * 执行时间
   */
  executionTime?: number;

  /**
   * 渲染后的HTML
   */
  renderedContent?: string;

  /**
   * 构造函数
   */
  constructor(id: string, content: string) {
    this.id = id;
    this.content = content;
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.metadata = {};
    this.executionState = CellExecutionState.IDLE;
  }

  /**
   * 更新内容
   */
  updateContent(content: string): void {
    this.content = content;
    this.updatedAt = new Date();
  }

  /**
   * 更新渲染内容
   */
  updateRenderedContent(rendered: string): void {
    this.renderedContent = rendered;
  }
}

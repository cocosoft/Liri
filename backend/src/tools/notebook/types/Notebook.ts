/**
 * Notebook类型定义
 */

import {
  Notebook as NotebookInterface,
  Cell,
  CodeCell,
  MarkdownCell,
  CellExecutionState,
} from './NotebookTool.js';

/**
 * Notebook实现
 */
export class NotebookImpl implements NotebookInterface {
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
  metadata: Record<string, any>;

  /**
   * 版本
   */
  version: string;

  /**
   * 构造函数
   */
  constructor(id: string, name: string, path?: string) {
    this.id = id;
    this.name = name;
    this.path = path;
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.cells = [];
    this.metadata = {
      kernelspec: {
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: '3.9',
      },
    };
    this.version = '1.0.0';
  }

  /**
   * 添加单元格
   */
  addCell(cell: Cell): void {
    this.cells.push(cell);
    this.updateTimestamp();
  }

  /**
   * 插入单元格
   */
  insertCell(index: number, cell: Cell): void {
    this.cells.splice(index, 0, cell);
    this.updateTimestamp();
  }

  /**
   * 删除单元格
   */
  removeCell(cellId: string): boolean {
    const index = this.cells.findIndex((cell) => cell.id === cellId);
    if (index === -1) {
      return false;
    }
    this.cells.splice(index, 1);
    this.updateTimestamp();
    return true;
  }

  /**
   * 获取单元格
   */
  getCell(cellId: string): Cell | undefined {
    return this.cells.find((cell) => cell.id === cellId);
  }

  /**
   * 更新单元格
   */
  updateCell(cellId: string, updates: Partial<Cell>): boolean {
    const cell = this.getCell(cellId);
    if (!cell) {
      return false;
    }
    Object.assign(cell, updates);
    (cell as any).updatedAt = new Date();
    this.updateTimestamp();
    return true;
  }

  /**
   * 更新时间戳
   */
  private updateTimestamp(): void {
    this.updatedAt = new Date();
  }

  /**
   * 转换为JSON
   */
  toJSON(): any {
    return {
      id: this.id,
      name: this.name,
      path: this.path,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      cells: this.cells.map((cell) => this.cellToJSON(cell)),
      metadata: this.metadata,
      version: this.version,
    };
  }

  /**
   * 单元格转换为JSON
   */
  private cellToJSON(cell: Cell): any {
    const base = {
      id: cell.id,
      type: cell.type,
      createdAt: cell.createdAt.toISOString(),
      updatedAt: cell.updatedAt.toISOString(),
      metadata: cell.metadata,
      executionState: cell.executionState,
      executionTime: cell.executionTime,
    };

    if (cell.type === 'code') {
      const codeCell = cell as CodeCell;
      return {
        ...base,
        code: codeCell.code,
        language: codeCell.language,
        output: codeCell.output,
      };
    } else {
      const markdownCell = cell as MarkdownCell;
      return {
        ...base,
        content: markdownCell.content,
        renderedContent: markdownCell.renderedContent,
      };
    }
  }

  /**
   * 从JSON创建
   */
  static fromJSON(data: any): NotebookImpl {
    const notebook = new NotebookImpl(data.id, data.name, data.path);
    notebook.createdAt = new Date(data.createdAt);
    notebook.updatedAt = new Date(data.updatedAt);
    notebook.cells = data.cells.map((cellData: any) =>
      NotebookImpl.cellFromJSON(cellData)
    );
    notebook.metadata = data.metadata;
    notebook.version = data.version;
    return notebook;
  }

  /**
   * 从JSON创建单元格
   */
  static cellFromJSON(data: any): any {
    const base: any = {
      id: data.id,
      type: data.type,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
      metadata: data.metadata,
      executionState: data.executionState,
      executionTime: data.executionTime,
    };

    if (data.type === 'code') {
      return {
        ...base,
        code: data.code,
        language: data.language,
        output: data.output,
      };
    } else {
      return {
        ...base,
        content: data.content,
        renderedContent: data.renderedContent,
      };
    }
  }
}

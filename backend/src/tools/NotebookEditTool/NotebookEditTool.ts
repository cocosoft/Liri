/**
 * NotebookEditTool - Jupyter笔记本操作工具
 *
 * 参考CC源码实现: cc_code/tools/NotebookEditTool.ts
 *
 * 功能:
 * - 编辑Jupyter笔记本文件
 * - 添加、删除、修改笔记本单元格
 * - 支持Markdown和代码单元格
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Tool, ToolInfo, ValidationResult } from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';

/**
 * NotebookEditTool参数
 */
export interface NotebookEditToolParams {
  /** 笔记本文件路径 */
  notebook_path: string;
  /** 操作类型: add, remove, update, execute */
  action: 'add' | 'remove' | 'update' | 'execute';
  /** 单元格索引（对于remove和update操作） */
  cell_index?: number;
  /** 单元格类型: markdown, code */
  cell_type?: 'markdown' | 'code';
  /** 单元格内容 */
  cell_content?: string;
  /** 单元格执行结果（对于execute操作） */
  cell_output?: any;
}

/**
 * Jupyter笔记本单元格接口
 */
export interface NotebookCell {
  cell_type: 'markdown' | 'code';
  metadata: Record<string, unknown>;
  source: string[];
  execution_count?: number;
  outputs?: any[];
}

/**
 * Jupyter笔记本接口
 */
export interface Notebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

/**
 * 读取笔记本文件
 */
function readNotebook(filePath: string): Notebook {
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * 写入笔记本文件
 */
function writeNotebook(filePath: string, notebook: Notebook): void {
  writeFileSync(filePath, JSON.stringify(notebook, null, 2), 'utf-8');
}

/**
 * NotebookEditTool实现
 */
export const NotebookEditTool: Tool = {
  name: 'NotebookEditTool',
  description: 'Edit Jupyter notebook files',
  params: [
    {
      name: 'notebook_path',
      type: 'string',
      description: 'Path to the notebook file',
      required: true,
      default: '',
    },
    {
      name: 'action',
      type: 'string',
      description: 'Action to perform: add, remove, update, execute',
      required: true,
      default: '',
    },
    {
      name: 'cell_index',
      type: 'number',
      description: 'Index of the cell to modify',
      required: false,
      default: 0,
    },
    {
      name: 'cell_type',
      type: 'string',
      description: 'Type of cell: markdown, code',
      required: false,
      default: 'markdown',
    },
    {
      name: 'cell_content',
      type: 'string',
      description: 'Content of the cell',
      required: false,
      default: '',
    },
    {
      name: 'cell_output',
      type: 'object',
      description: 'Output of the cell (for execute action)',
      required: false,
      default: {},
    },
  ],
  isEnabled: () => true,
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  getInfo: function (): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: ['EditNotebook', 'NotebookEdit'],
      searchTips: ['edit notebook', 'jupyter', 'notebook cell'],
      enabled: true,
      readOnly: false,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block' as const,
      maxResultSizeChars: 10000,
    };
  },
  validateInput: function (input: Record<string, unknown>): ValidationResult {
    if (!input.notebook_path || typeof input.notebook_path !== 'string') {
      return {
        result: false,
        message: 'notebook_path is required and must be a string',
      };
    }

    if (!input.action || typeof input.action !== 'string') {
      return {
        result: false,
        message: 'action is required and must be a string',
      };
    }

    const validActions = ['add', 'remove', 'update', 'execute'];
    if (!validActions.includes(input.action as string)) {
      return {
        result: false,
        message: `action must be one of: ${validActions.join(', ')}`,
      };
    }

    const action = input.action as string;
    if (action === 'remove' || action === 'update' || action === 'execute') {
      if (
        input.cell_index === undefined ||
        typeof input.cell_index !== 'number'
      ) {
        return {
          result: false,
          message: 'cell_index is required for remove/update/execute action',
        };
      }
    }

    if (action === 'add') {
      if (!input.cell_type || typeof input.cell_type !== 'string') {
        return {
          result: false,
          message: 'cell_type is required for add action',
        };
      }
      if (!input.cell_content || typeof input.cell_content !== 'string') {
        return {
          result: false,
          message: 'cell_content is required for add action',
        };
      }
    }

    if (action === 'update') {
      if (!input.cell_content || typeof input.cell_content !== 'string') {
        return {
          result: false,
          message: 'cell_content is required for update action',
        };
      }
    }

    return { result: true };
  },
  async execute(
    args: NotebookEditToolParams,
    context: ToolUseContext
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const {
        notebook_path,
        action,
        cell_index,
        cell_type,
        cell_content,
        cell_output,
      } = args;

      const fullPath = resolve(process.cwd(), notebook_path);

      // 读取笔记本
      let notebook: Notebook;
      try {
        notebook = readNotebook(fullPath);
      } catch (error: any) {
        return {
          status: ToolExecutionStatus.FAILURE,
          result: null,
          error: `Failed to read notebook: ${error.message}`,
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: `Failed to read notebook: ${error.message}`,
          progress: [],
          metadata: {},
          executionId: '',
          toolName: this.name,
          timestamp: Date.now(),
        };
      }

      let resultMessage = '';

      switch (action) {
        case 'add':
          if (!cell_type || !cell_content) {
            return {
              status: ToolExecutionStatus.FAILURE,
              result: null,
              error: 'cell_type and cell_content are required for add action',
              executionTime: Date.now() - startTime,
              output: '',
              errorOutput:
                'cell_type and cell_content are required for add action',
              progress: [],
              metadata: {},
              executionId: '',
              toolName: this.name,
              timestamp: Date.now(),
            };
          }

          const newCell: NotebookCell = {
            cell_type,
            metadata: {},
            source: cell_content.split('\n'),
          };

          if (cell_index !== undefined) {
            notebook.cells.splice(cell_index, 0, newCell);
            resultMessage = `Added ${cell_type} cell at index ${cell_index}`;
          } else {
            notebook.cells.push(newCell);
            resultMessage = `Added ${cell_type} cell at end of notebook`;
          }
          break;

        case 'remove':
          if (cell_index === undefined) {
            return {
              status: ToolExecutionStatus.FAILURE,
              result: null,
              error: 'cell_index is required for remove action',
              executionTime: Date.now() - startTime,
              output: '',
              errorOutput: 'cell_index is required for remove action',
              progress: [],
              metadata: {},
              executionId: '',
              toolName: this.name,
              timestamp: Date.now(),
            };
          }

          if (cell_index < 0 || cell_index >= notebook.cells.length) {
            return {
              status: ToolExecutionStatus.FAILURE,
              result: null,
              error: `cell_index ${cell_index} is out of range`,
              executionTime: Date.now() - startTime,
              output: '',
              errorOutput: `cell_index ${cell_index} is out of range`,
              progress: [],
              metadata: {},
              executionId: '',
              toolName: this.name,
              timestamp: Date.now(),
            };
          }

          notebook.cells.splice(cell_index, 1);
          resultMessage = `Removed cell at index ${cell_index}`;
          break;

        case 'update':
          if (cell_index === undefined || !cell_content) {
            return {
              status: ToolExecutionStatus.FAILURE,
              result: null,
              error:
                'cell_index and cell_content are required for update action',
              executionTime: Date.now() - startTime,
              output: '',
              errorOutput:
                'cell_index and cell_content are required for update action',
              progress: [],
              metadata: {},
              executionId: '',
              toolName: this.name,
              timestamp: Date.now(),
            };
          }

          if (cell_index < 0 || cell_index >= notebook.cells.length) {
            return {
              status: ToolExecutionStatus.FAILURE,
              result: null,
              error: `cell_index ${cell_index} is out of range`,
              executionTime: Date.now() - startTime,
              output: '',
              errorOutput: `cell_index ${cell_index} is out of range`,
              progress: [],
              metadata: {},
              executionId: '',
              toolName: this.name,
              timestamp: Date.now(),
            };
          }

          notebook.cells[cell_index].source = cell_content.split('\n');
          resultMessage = `Updated cell at index ${cell_index}`;
          break;

        case 'execute':
          if (cell_index === undefined) {
            return {
              status: ToolExecutionStatus.FAILURE,
              result: null,
              error: 'cell_index is required for execute action',
              executionTime: Date.now() - startTime,
              output: '',
              errorOutput: 'cell_index is required for execute action',
              progress: [],
              metadata: {},
              executionId: '',
              toolName: this.name,
              timestamp: Date.now(),
            };
          }

          if (cell_index < 0 || cell_index >= notebook.cells.length) {
            return {
              status: ToolExecutionStatus.FAILURE,
              result: null,
              error: `cell_index ${cell_index} is out of range`,
              executionTime: Date.now() - startTime,
              output: '',
              errorOutput: `cell_index ${cell_index} is out of range`,
              progress: [],
              metadata: {},
              executionId: '',
              toolName: this.name,
              timestamp: Date.now(),
            };
          }

          if (notebook.cells[cell_index].cell_type !== 'code') {
            return {
              status: ToolExecutionStatus.FAILURE,
              result: null,
              error: 'execute action can only be performed on code cells',
              executionTime: Date.now() - startTime,
              output: '',
              errorOutput: 'execute action can only be performed on code cells',
              progress: [],
              metadata: {},
              executionId: '',
              toolName: this.name,
              timestamp: Date.now(),
            };
          }

          // 模拟执行结果
          notebook.cells[cell_index].execution_count =
            (notebook.cells[cell_index].execution_count || 0) + 1;
          if (cell_output) {
            notebook.cells[cell_index].outputs = [cell_output];
          } else {
            notebook.cells[cell_index].outputs = [
              {
                output_type: 'stream',
                name: 'stdout',
                text: ['Cell executed successfully\n'],
              },
            ];
          }
          resultMessage = `Executed code cell at index ${cell_index}`;
          break;
      }

      // 写入笔记本
      writeNotebook(fullPath, notebook);

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: {
          notebook_path: fullPath,
          action,
          cell_index,
          cell_type,
          cell_content: cell_content
            ? cell_content.substring(0, 100) +
              (cell_content.length > 100 ? '...' : '')
            : '',
          message: resultMessage,
        },
        error: undefined,
        executionTime: Date.now() - startTime,
        output: resultMessage,
        errorOutput: '',
        progress: [],
        metadata: {
          notebook_path: fullPath,
          action,
          cell_index,
        },
        executionId: '',
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return {
        status: ToolExecutionStatus.FAILURE,
        result: null,
        error: `Failed to edit notebook: ${error.message}`,
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: `Failed to edit notebook: ${error.message}`,
        progress: [],
        metadata: {},
        executionId: '',
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  },
  userFacingName: function (input?: Partial<any>): string {
    const path = (input?.notebook_path as string) || '';
    const action = (input?.action as string) || '';
    if (path && action) {
      return `Notebook ${action}: ${path}`;
    }
    return this.name;
  },
  getActivityDescription: function (input?: Partial<any>): string | null {
    const path = (input?.notebook_path as string) || '';
    const action = (input?.action as string) || '';
    const index = input?.cell_index as number;
    if (path && action) {
      switch (action) {
        case 'add':
          return `Adding cell to notebook: ${path}`;
        case 'remove':
          return `Removing cell ${index} from notebook: ${path}`;
        case 'update':
          return `Updating cell ${index} in notebook: ${path}`;
        case 'execute':
          return `Executing cell ${index} in notebook: ${path}`;
        default:
          return `Editing notebook: ${path}`;
      }
    }
    return null;
  },
  getToolUseSummary: function (input?: Partial<any>): string | null {
    const path = (input?.notebook_path as string) || '';
    const action = (input?.action as string) || '';
    const index = input?.cell_index as number;
    if (path && action) {
      switch (action) {
        case 'add':
          return `Add cell to notebook: ${path}`;
        case 'remove':
          return `Remove cell ${index} from notebook: ${path}`;
        case 'update':
          return `Update cell ${index} in notebook: ${path}`;
        case 'execute':
          return `Execute cell ${index} in notebook: ${path}`;
        default:
          return `Edit notebook: ${path}`;
      }
    }
    return null;
  },
};

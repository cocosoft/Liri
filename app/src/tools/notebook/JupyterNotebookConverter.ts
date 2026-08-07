/**
 * JupyterNotebookConverter — 内部 Notebook ⇄ 标准 Jupyter nbformat 4.x 转换器
 *
 * P1-1: NotebookManager 保存/打开时按格式识别选择序列化器；
 *       IpynbConverter 复用本转换器，消除两套 cell_type/source 解析逻辑。
 */

import { NotebookImpl } from './types/Notebook.js';
import { CodeCellImpl, MarkdownCellImpl } from './types/Cell.js';
import { CellExecutionState } from './types/NotebookTool.js';
import type {
  Notebook,
  Cell,
  CodeCell,
  MarkdownCell,
} from './types/NotebookTool.js';

/** 将 Jupyter source（string | string[]）归一化为字符串 */
function sourceToString(source: unknown): string {
  if (Array.isArray(source)) return source.join('');
  return typeof source === 'string' ? source : '';
}

/** 将文本拆分为 Jupyter source 行数组（每行保留换行，末行除外） */
function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n').map((line) => line + '\n');
  lines[lines.length - 1] = lines[lines.length - 1]!.replace(/\n$/, '');
  return lines;
}

/**
 * Jupyter Notebook 转换器
 */
export class JupyterNotebookConverter {
  /**
   * 识别数据是否为标准 Jupyter nbformat（含 nbformat 字段或 cells[].cell_type）
   */
  static isJupyterFormat(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    if (typeof obj.nbformat === 'number') return true;
    if (Array.isArray(obj.cells) && obj.cells.length > 0) {
      const first = obj.cells[0] as Record<string, unknown>;
      if (first && typeof first.cell_type === 'string') return true;
    }
    return false;
  }

  /**
   * 内部 Notebook → 标准 Jupyter nbformat 4.x
   */
  static toJupyter(notebook: Notebook): object {
    return {
      cells: notebook.cells.map((cell) => {
        if (cell.type === 'code') {
          const codeCell = cell as CodeCell;
          return {
            cell_type: 'code',
            metadata: { ...(codeCell.metadata ?? {}) },
            execution_count: null,
            source: splitLines(codeCell.code),
            outputs: [],
          };
        }
        const markdownCell = cell as MarkdownCell;
        return {
          cell_type: 'markdown',
          metadata: { ...(markdownCell.metadata ?? {}) },
          source: splitLines(markdownCell.content),
        };
      }),
      metadata: {
        title: notebook.name,
        ...(notebook.metadata ?? {}),
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
  }

  /**
   * 标准 Jupyter nbformat JSON → 内部 Notebook（raw 单元归入 code，语言取 metadata.language）
   */
  static fromJupyter(data: unknown): NotebookImpl {
    const obj = (data ?? {}) as Record<string, unknown>;
    const cellsData = Array.isArray(obj.cells) ? obj.cells : [];
    const metadata = (obj.metadata as Record<string, unknown>) ?? {};

    const notebookName =
      typeof metadata.title === 'string' ? metadata.title : 'Untitled';
    const notebook = new NotebookImpl(
      `notebook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      notebookName
    );
    notebook.cells = cellsData.map((cellData) =>
      JupyterNotebookConverter.cellFromJupyter(cellData)
    );
    notebook.metadata = metadata;
    return notebook;
  }

  /**
   * 单个标准 cell → 内部 Cell
   */
  private static cellFromJupyter(data: unknown): Cell {
    const obj = (data ?? {}) as Record<string, unknown>;
    const cellType = obj.cell_type ?? 'code';
    const source = sourceToString(obj.source);
    const id = `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const metadata: Record<string, unknown> = {
      ...((obj.metadata as Record<string, unknown>) ?? {}),
      // 保留原始 cell_type，供 IpynbConverter 等下游区分 raw
      originalCellType: cellType,
    };

    if (cellType === 'markdown') {
      const cell = new MarkdownCellImpl(id, source);
      cell.metadata = metadata;
      cell.executionState = CellExecutionState.IDLE;
      return cell;
    }

    // code / raw
    const language =
      typeof obj.language === 'string'
        ? obj.language
        : (metadata.language as string) || 'python';
    const cell = new CodeCellImpl(id, source, language);
    cell.metadata = metadata;
    cell.executionState = CellExecutionState.IDLE;
    return cell;
  }
}

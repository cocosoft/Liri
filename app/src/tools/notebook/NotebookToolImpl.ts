/**
 * Notebook工具实现
 */

import {
  NotebookTool,
  Notebook,
  CodeCell,
  MarkdownCell,
  CellExecutionResult,
  CellExecutionState,
  CellOutput,
} from './types/index.js';
import { notebookManager } from './NotebookManager.js';
import { CodeCellImpl, MarkdownCellImpl } from './types/Cell.js';
import { REPLToolImpl } from '../repl/REPLToolImpl.js';
import { REPLSession } from '../repl/types/index.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools\notebook\NotebookToolImpl', level: LogLevel.INFO });

/**
 * Notebook工具实现
 */
export class NotebookToolImpl implements NotebookTool {
  private replTool: REPLToolImpl;
  private replSessions: Map<string, REPLSession> = new Map();

  /**
   * 构造函数
   */
  constructor() {
    this.replTool = new REPLToolImpl();
  }

  /**
   * 创建Notebook
   */
  async createNotebook(name: string): Promise<Notebook> {
    return notebookManager.createNotebook(name);
  }

  /**
   * 打开Notebook
   */
  async openNotebook(path: string): Promise<Notebook> {
    return notebookManager.openNotebook(path);
  }

  /**
   * 保存Notebook
   */
  async saveNotebook(notebook: Notebook): Promise<void> {
    notebookManager.saveNotebook(notebook);
  }

  /**
   * 保存Notebook到指定路径
   */
  async saveNotebookAs(notebook: Notebook, path: string): Promise<void> {
    notebookManager.saveNotebookAs(notebook, path);
  }

  /**
   * 添加代码单元格
   */
  async addCodeCell(
    notebook: Notebook,
    code: string,
    language: string
  ): Promise<CodeCell> {
    const id = `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const cell = new CodeCellImpl(id, code, language);
    (notebook as any).addCell(cell);
    return cell;
  }

  /**
   * 添加Markdown单元格
   */
  async addMarkdownCell(
    notebook: Notebook,
    content: string
  ): Promise<MarkdownCell> {
    const id = `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const cell = new MarkdownCellImpl(id, content);
    (notebook as any).addCell(cell);
    return cell;
  }

  /**
   * 执行单元格
   * 注：按语言复用 REPL 会话，避免会话泄漏
   */
  async executeCell(cell: CodeCell): Promise<CellExecutionResult> {
    const startTime = Date.now();
    cell.executionState = CellExecutionState.RUNNING;

    try {
      // 按语言复用 REPL 会话，避免每次创建新会话导致泄漏
      const sessionId = `session-${cell.language}`;
      let session = this.replSessions.get(sessionId);

      if (!session) {
        session = await this.replTool.startREPL(cell.language);
        this.replSessions.set(sessionId, session);
      }

      // 执行代码
      const result = await this.replTool.executeCode(session, cell.code);

      // 处理输出
      const output: CellOutput[] = [];
      if (result.output) {
        output.push({
          type: 'text',
          content: result.output,
        });
      }

      if (result.error) {
        output.push({
          type: 'error',
          content: result.error,
        });
      }

      cell.output = output;
      cell.executionState = result.success
        ? CellExecutionState.SUCCEEDED
        : CellExecutionState.FAILED;
      cell.executionTime = Date.now() - startTime;

      return {
        cellId: cell.id,
        success: result.success,
        output,
        error: result.error,
        executionTime: cell.executionTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      cell.executionState = CellExecutionState.FAILED;
      cell.executionTime = Date.now() - startTime;
      cell.output = [
        {
          type: 'error',
          content: errorMessage,
        },
      ];

      return {
        cellId: cell.id,
        success: false,
        error: errorMessage,
        executionTime: cell.executionTime,
      };
    }
  }

  /**
   * 执行所有单元格
   */
  async executeAllCells(notebook: Notebook): Promise<CellExecutionResult[]> {
    const results: CellExecutionResult[] = [];

    for (const cell of notebook.cells) {
      if (cell.type === 'code') {
        const result = await this.executeCell(cell as CodeCell);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 导出Notebook
   */
  async exportNotebook(
    notebook: Notebook,
    format: 'html' | 'pdf' | 'markdown'
  ): Promise<Buffer> {
    switch (format) {
      case 'markdown':
        return this.exportToMarkdown(notebook);
      case 'html':
        return this.exportToHTML(notebook);
      case 'pdf':
        return this.exportToPDF(notebook);
      default:
        throw new AppError(
          `Unsupported format: ${format}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
    }
  }

  /**
   * 导出为Markdown
   */
  private exportToMarkdown(notebook: Notebook): Buffer {
    let markdown = `# ${notebook.name}\n\n`;

    for (const cell of notebook.cells) {
      if (cell.type === 'markdown') {
        const mdCell = cell as MarkdownCell;
        markdown += `${mdCell.content}\n\n`;
      } else if (cell.type === 'code') {
        const codeCell = cell as CodeCell;
        markdown += `\`\`\`${codeCell.language}\n${codeCell.code}\n\`\`\`\n\n`;

        if (codeCell.output) {
          for (const output of codeCell.output) {
            if (output.type === 'text') {
              markdown += `\`\`\`\n${output.content}\n\`\`\`\n\n`;
            } else if (output.type === 'error') {
              markdown += `\`\`\`\nError: ${output.content}\n\`\`\`\n\n`;
            }
          }
        }
      }
    }

    return Buffer.from(markdown, 'utf8');
  }

  /**
   * 导出为HTML
   */
  private exportToHTML(notebook: Notebook): Buffer {
    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${notebook.name}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    h1 { color: #333; }
    .cell { margin: 20px 0; padding: 15px; border: 1px solid #ddd; }
    .code-cell { background-color: #f5f5f5; }
    .markdown-cell { background-color: #fff; }
    pre { background-color: #f0f0f0; padding: 10px; overflow-x: auto; }
    code { font-family: 'Courier New', monospace; }
    .output { margin-top: 10px; padding: 10px; background-color: #e8f4f8; }
    .error { margin-top: 10px; padding: 10px; background-color: #ffe8e8; color: #c00; }
  </style>
</head>
<body>
  <h1>${notebook.name}</h1>
`;

    for (const cell of notebook.cells) {
      if (cell.type === 'markdown') {
        const mdCell = cell as MarkdownCell;
        html += `
  <div class="cell markdown-cell">
    ${mdCell.renderedContent || mdCell.content}
  </div>
`;
      } else if (cell.type === 'code') {
        const codeCell = cell as CodeCell;
        html += `
  <div class="cell code-cell">
    <pre><code>${this.escapeHtml(codeCell.code)}</code></pre>
`;

        if (codeCell.output) {
          for (const output of codeCell.output) {
            if (output.type === 'text') {
              html += `
    <div class="output">
      <pre>${this.escapeHtml(output.content as string)}</pre>
    </div>
`;
            } else if (output.type === 'error') {
              html += `
    <div class="error">
      <pre>${this.escapeHtml(output.content as string)}</pre>
    </div>
`;
            }
          }
        }
        html += `
  </div>
`;
      }
    }

    html += `
</body>
</html>
`;

    return Buffer.from(html, 'utf8');
  }

  /**
   * 导出为PDF（打印就绪 HTML）
   * 基于 HTML 输出构建，增加 @media print 样式和页面元数据，
   * 浏览器打印/另存为 PDF 时可获得良好排版效果
   */
  private exportToPDF(notebook: Notebook): Buffer {
    const html = this.exportToHTML(notebook).toString('utf8');

    const printStyles = `
  @media print {
    @page { margin: 2cm; size: A4; }
    body { font-size: 11pt; line-height: 1.6; color: #000; background: #fff; margin: 0; padding: 0; }
    h1 { font-size: 18pt; margin-top: 0; page-break-before: avoid; page-break-after: avoid; }
    h2 { font-size: 14pt; page-break-after: avoid; }
    .cell { border: 1px solid #ccc; page-break-inside: avoid; margin: 1.5em 0; padding: 1em; }
    .code-cell { background: #f9f9f9; border-left: 3px solid #4a9; }
    .markdown-cell { border-left: 3px solid #69c; }
    pre { font-size: 9pt; background: #f5f5f5; padding: 0.5em; border: 1px solid #ddd; white-space: pre-wrap; word-break: break-all; }
    .output { border-top: 1px dashed #aaa; margin-top: 0.5em; padding-top: 0.5em; }
    .error { color: #c00; font-weight: bold; }
    .metadata { text-align: center; font-size: 9pt; color: #666; margin-top: 0.5em; padding-top: 0.5em; border-top: 1px solid #ccc; }
  }`;

    const metadata = `
  <div class="metadata">
    <span>导出时间: ${new Date().toISOString().split('T')[0]}</span>
    <span> | 单元格数: ${notebook.cells.length}</span>
    <span> | 版本: ${(notebook as any).version || '1.0'}</span>
  </div>`;

    const pdfContent = html
      .replace('</style>', `${printStyles}\n</style>`)
      .replace('</body>', `${metadata}\n</body>`);

    return Buffer.from(pdfContent, 'utf8');
  }

  /**
   * 转义HTML
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 获取所有Notebook
   */
  async getNotebooks(): Promise<Notebook[]> {
    return notebookManager.getNotebooks();
  }

  /**
   * 删除Notebook
   */
  async deleteNotebook(notebook: Notebook): Promise<void> {
    notebookManager.deleteNotebook(notebook);
  }
}

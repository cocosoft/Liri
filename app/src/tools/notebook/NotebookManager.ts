/**
 * Notebook管理
 */

import {
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { Notebook } from './types/index.js';
import { NotebookImpl } from './types/Notebook.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { resolveDataSubDir } from '@modules/core/paths';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * Notebook管理器
 */
export class NotebookManager {
  private notebooks: Map<string, Notebook> = new Map();
  private notebookDir: string;

  /**
   * 构造函数
   */
  constructor(notebookDir: string = resolveDataSubDir('notebooks')) {
    this.notebookDir = notebookDir;
    this.ensureNotebookDir();
    this.loadNotebooks();
  }

  /**
   * 确保Notebook目录存在
   */
  private ensureNotebookDir(): void {
    if (!existsSync(this.notebookDir)) {
      mkdirSync(this.notebookDir, { recursive: true });
    }
  }

  /**
   * 加载Notebook
   */
  private loadNotebooks(): void {
    if (!existsSync(this.notebookDir)) {
      return;
    }

    const files = readdirSync(this.notebookDir);
    for (const file of files) {
      if (file.endsWith('.ipynb')) {
        const path = join(this.notebookDir, file);
        try {
          const data = readFileSync(path, 'utf8');
          const notebookData = JSON.parse(data);
          const notebook = NotebookImpl.fromJSON(notebookData);
          this.notebooks.set(notebook.id, notebook);
        } catch (error) {
          logger.error(`Error loading notebook ${file}:`, { error });
        }
      }
    }
  }

  /**
   * 创建Notebook
   */
  createNotebook(name: string): Notebook {
    const id = `notebook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const notebook = new NotebookImpl(id, name);
    this.notebooks.set(id, notebook);
    return notebook;
  }

  /**
   * 打开Notebook
   */
  openNotebook(path: string): Notebook {
    try {
      const data = readFileSync(path, 'utf8');
      const notebookData = JSON.parse(data);
      const notebook = NotebookImpl.fromJSON(notebookData);
      notebook.path = path;
      this.notebooks.set(notebook.id, notebook);
      return notebook;
    } catch (error) {
      throw new AppError(
        `Failed to open notebook: ${error}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 保存Notebook
   */
  saveNotebook(notebook: Notebook): void {
    try {
      const path =
        notebook.path || join(this.notebookDir, `${notebook.name}.ipynb`);
      const data = JSON.stringify(notebook, null, 2);
      writeFileSync(path, data, 'utf8');
      (notebook as any).path = path;
      this.notebooks.set(notebook.id, notebook);
    } catch (error) {
      throw new AppError(
        `Failed to save notebook: ${error}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 保存Notebook到指定路径
   */
  saveNotebookAs(notebook: Notebook, path: string): void {
    try {
      const data = JSON.stringify(notebook, null, 2);
      writeFileSync(path, data, 'utf8');
      (notebook as any).path = path;
      this.notebooks.set(notebook.id, notebook);
    } catch (error) {
      throw new AppError(
        `Failed to save notebook as: ${error}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 获取Notebook
   */
  getNotebook(id: string): Notebook | undefined {
    return this.notebooks.get(id);
  }

  /**
   * 获取所有Notebook
   */
  getNotebooks(): Notebook[] {
    return Array.from(this.notebooks.values());
  }

  /**
   * 删除Notebook
   */
  deleteNotebook(notebook: Notebook): void {
    if (notebook.path && existsSync(notebook.path)) {
      unlinkSync(notebook.path);
    }
    this.notebooks.delete(notebook.id);
  }

  /**
   * 清理Notebook
   */
  clearNotebooks(): void {
    this.notebooks.clear();
  }

  /**
   * 获取Notebook数量
   */
  getNotebookCount(): number {
    return this.notebooks.size;
  }
}

/**
 * 全局Notebook管理器实例
 */
export const notebookManager = new NotebookManager();

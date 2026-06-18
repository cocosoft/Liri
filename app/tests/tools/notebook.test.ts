/**
 * Notebook 子系统单元测试
 * 覆盖 NotebookImpl、NotebookManager、NotebookToolImpl
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { NotebookImpl } from '../../src/tools/notebook/types/Notebook.js';
import { CodeCellImpl, MarkdownCellImpl } from '../../src/tools/notebook/types/Cell.js';
import { NotebookManager } from '../../src/tools/notebook/NotebookManager.js';
import { CellExecutionState } from '../../src/tools/notebook/types/NotebookTool.js';

describe('NotebookImpl', () => {

  it('创建 Notebook 实例', () => {
    const nb = new NotebookImpl('nb-1', 'Test Notebook');
    expect(nb.id).toBe('nb-1');
    expect(nb.name).toBe('Test Notebook');
    expect(nb.cells.length).toBe(0);
    expect(nb.version).toBe('1.0.0');
  });

  it('添加代码单元格', () => {
    const nb = new NotebookImpl('nb-1', 'Test');
    const cell = new CodeCellImpl('c1', 'console.log("hello")', 'javascript');

    nb.addCell(cell);
    expect(nb.cells.length).toBe(1);
    expect(nb.cells[0].type).toBe('code');
    expect((nb.cells[0] as any).code).toBe('console.log("hello")');
  });

  it('添加 Markdown 单元格', () => {
    const nb = new NotebookImpl('nb-1', 'Test');
    const cell = new MarkdownCellImpl('c1', '# Title');

    nb.addCell(cell);
    expect(nb.cells.length).toBe(1);
    expect(nb.cells[0].type).toBe('markdown');
    expect((nb.cells[0] as any).content).toBe('# Title');
  });

  it('插入单元格到指定位置', () => {
    const nb = new NotebookImpl('nb-1', 'Test');
    nb.addCell(new CodeCellImpl('c1', 'code1', 'js'));
    nb.addCell(new CodeCellImpl('c3', 'code3', 'js'));

    nb.insertCell(1, new CodeCellImpl('c2', 'code2', 'js'));
    expect(nb.cells.length).toBe(3);
    expect((nb.cells[1] as any).code).toBe('code2');
  });

  it('删除单元格', () => {
    const nb = new NotebookImpl('nb-1', 'Test');
    nb.addCell(new CodeCellImpl('c1', 'code1', 'js'));
    nb.addCell(new CodeCellImpl('c2', 'code2', 'js'));

    const removed = nb.removeCell('c1');
    expect(removed).toBe(true);
    expect(nb.cells.length).toBe(1);
    expect((nb.cells[0] as any).code).toBe('code2');
  });

  it('删除不存在的单元格返回 false', () => {
    const nb = new NotebookImpl('nb-1', 'Test');
    nb.addCell(new CodeCellImpl('c1', 'code1', 'js'));

    expect(nb.removeCell('nonexistent')).toBe(false);
  });

  it('获取单元格', () => {
    const nb = new NotebookImpl('nb-1', 'Test');
    nb.addCell(new CodeCellImpl('c1', 'code1', 'js'));
    nb.addCell(new CodeCellImpl('c2', 'code2', 'js'));

    const cell = nb.getCell('c1');
    expect(cell).toBeDefined();
    expect((cell as any).code).toBe('code1');

    const missing = nb.getCell('nonexistent');
    expect(missing).toBeUndefined();
  });

  it('更新单元格', () => {
    const nb = new NotebookImpl('nb-1', 'Test');
    nb.addCell(new CodeCellImpl('c1', 'code1', 'js'));

    const updated = nb.updateCell('c1', { code: 'updated_code' });
    expect(updated).toBe(true);
    expect((nb.cells[0] as any).code).toBe('updated_code');
  });

  it('序列化为 JSON', () => {
    const nb = new NotebookImpl('nb-1', 'Test');
    nb.addCell(new CodeCellImpl('c1', 'console.log("hi")', 'javascript'));

    const json = nb.toJSON();
    expect(json.id).toBe('nb-1');
    expect(json.name).toBe('Test');
    expect(json.cells.length).toBe(1);
    expect(json.cells[0].id).toBe('c1');
  });

  it('从 JSON 反序列化', () => {
    const json = {
      id: 'nb-import',
      name: 'Imported',
      cells: [
        { id: 'c1', type: 'code', code: 'print(1)', language: 'python', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {}, executionState: 'idle' },
        { id: 'c2', type: 'markdown', content: '# Docs', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {} },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
      version: '1.0.0',
      path: '',
    };

    const nb = NotebookImpl.fromJSON(json);
    expect(nb.id).toBe('nb-import');
    expect(nb.cells.length).toBe(2);
    expect(nb.cells[0].type).toBe('code');
    expect(nb.cells[1].type).toBe('markdown');
  });

  it('更新时间戳', () => {
    const nb = new NotebookImpl('nb-1', 'Test');
    const before = nb.updatedAt.getTime();

    // 等待一下确保时间变化
    nb.addCell(new CodeCellImpl('c1', 'code', 'js'));
    expect(nb.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

});

describe('CodeCellImpl', () => {

  it('创建代码单元格', () => {
    const cell = new CodeCellImpl('c1', 'print("hello")', 'python');
    expect(cell.type).toBe('code');
    expect(cell.code).toBe('print("hello")');
    expect(cell.language).toBe('python');
    expect(cell.executionState).toBe(CellExecutionState.IDLE);
  });

  it('添加输出', () => {
    const cell = new CodeCellImpl('c1', 'print(1)', 'python');
    cell.addOutput({ type: 'text', data: '1', metadata: {} });
    expect(cell.output).toBeDefined();
    expect(cell.output!.length).toBe(1);
    expect(cell.output![0].data).toBe('1');

    cell.clearOutput();
    expect(cell.output!.length).toBe(0);
  });

  it('设置执行状态', () => {
    const cell = new CodeCellImpl('c1', 'print(1)', 'python');
    cell.executionState = CellExecutionState.RUNNING;
    expect(cell.executionState).toBe(CellExecutionState.RUNNING);
  });

});

describe('MarkdownCellImpl', () => {

  it('创建 Markdown 单元格', () => {
    const cell = new MarkdownCellImpl('c1', '# Hello');
    expect(cell.type).toBe('markdown');
    expect(cell.content).toBe('# Hello');
  });

  it('更新渲染内容', () => {
    const cell = new MarkdownCellImpl('c1', '# Title');
    cell.updateRenderedContent('<h1>Title</h1>');
    expect(cell.renderedContent).toBe('<h1>Title</h1>');
  });

});

describe('NotebookManager', () => {
  const testDir = join(tmpdir(), `pyapp-notebook-test-${randomUUID()}`);
  let manager: NotebookManager;

  beforeEach(() => {
    manager = new NotebookManager(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {} /* 清理临时目录, 忽略错误 */
    }
  });

  it('创建 Notebook 管理器', () => {
    expect(manager).toBeDefined();
  });

  it('创建 Notebook', () => {
    const nb = manager.createNotebook('test-nb');
    expect(nb).toBeDefined();
    expect(nb.name).toBe('test-nb');
    expect(nb.id).toContain('notebook-');
  });

  it('获取所有 Notebook', () => {
    manager.createNotebook('nb-1');
    manager.createNotebook('nb-2');

    const notebooks = manager.getNotebooks();
    expect(notebooks.length).toBe(2);
  });

  it('保存和加载 Notebook', () => {
    const nb = manager.createNotebook('persist-test');
    nb.addCell(new CodeCellImpl('c1', 'print("hello")', 'python'));

    manager.saveNotebook(nb);
    const path = join(testDir, 'persist-test.ipynb');
    expect(existsSync(path)).toBe(true);

    const loaded = manager.openNotebook(path);
    expect(loaded.name).toBe('persist-test');
    expect(loaded.cells.length).toBe(1);
  });

});

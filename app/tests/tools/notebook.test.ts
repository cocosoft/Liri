/**
 * Notebook 子系统单元测试
 * 覆盖 NotebookImpl、NotebookManager、NotebookToolImpl
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { unlinkSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { NotebookImpl } from '../../src/tools/notebook/types/Notebook.js';
import { CodeCellImpl, MarkdownCellImpl } from '../../src/tools/notebook/types/Cell.js';
import { NotebookManager } from '../../src/tools/notebook/NotebookManager.js';
import { CellExecutionState } from '../../src/tools/notebook/types/NotebookTool.js';
import { NotebookToolImpl } from '../../src/tools/notebook/NotebookToolImpl.js';
import { REPLToolImpl } from '../../src/tools/repl/REPLToolImpl.js';
import { REPLSessionStatus } from '../../src/tools/repl/types/REPLTool.js';
import { replSessionManager } from '../../src/tools/repl/REPLSessionManager';
import { getAllBaseTools } from '../../src/tools/ToolFactory.js';
import { NotebookToolAdapter } from '../../src/tools/adapters/NotebookToolAdapter.js';
import { FileRegistry } from '../../src/services/file/FileRegistry.js';
import { notebookManager } from '../../src/tools/notebook/NotebookManager.js';
import { JupyterNotebookConverter } from '../../src/tools/notebook/JupyterNotebookConverter.js';
import { notebookCommand } from '../../src/commands/tools/dev/notebook.js';

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

describe('NotebookToolImpl.executeCell (P0-1 REPL 会话修复)', () => {
  let tool: NotebookToolImpl;
  let startSpy: ReturnType<typeof spyOn>;
  let execSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tool = new NotebookToolImpl();
    // mock REPL：startREPL 创建 RUNNING 会话；executeCode 直接成功
    startSpy = spyOn(REPLToolImpl.prototype, 'startREPL').mockImplementation(
      async (language: string) => {
        const s = replSessionManager.createSession(language);
        s.setStatus(REPLSessionStatus.RUNNING);
        return s;
      }
    );
    execSpy = spyOn(REPLToolImpl.prototype, 'executeCode').mockImplementation(
      async () => ({
        success: true,
        output: 'ok',
        executionTime: 1,
      })
    );
  });

  afterEach(() => {
    startSpy.mockRestore();
    execSpy.mockRestore();
    replSessionManager.clearSessions();
  });

  it('无会话时新建 REPL 会话', async () => {
    const cell = new CodeCellImpl('c1', 'print(1)', 'python');
    const result = await tool.executeCell(cell);
    expect(result.success).toBe(true);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(replSessionManager.getSessionCount()).toBe(1);
  });

  it('复用 RUNNING 会话，不重复 startREPL', async () => {
    const cell1 = new CodeCellImpl('c1', 'print(1)', 'python');
    const cell2 = new CodeCellImpl('c2', 'print(2)', 'python');
    await tool.executeCell(cell1);
    await tool.executeCell(cell2);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(replSessionManager.getSessionCount()).toBe(1);
  });

  it('STOPPED 会话不被复用，自动重建（P0-1 核心回归）', async () => {
    // 预置一个 STOPPED 会话，模拟 REPL 60s 超时后的状态
    const stopped = replSessionManager.createSession('python');
    stopped.setStatus(REPLSessionStatus.STOPPED);

    const cell = new CodeCellImpl('c1', 'print(1)', 'python');
    const result = await tool.executeCell(cell);
    expect(result.success).toBe(true);
    // 不复用 STOPPED 会话，而是重新 startREPL
    expect(startSpy).toHaveBeenCalledTimes(1);
    // STOPPED 残留 + 新建 RUNNING
    expect(replSessionManager.getSessionCount()).toBe(2);
  });

  it('闲置超过 10min 的会话在下次执行时被回收（N-2 常驻泄漏回归）', async () => {
    // 预置一个 11min 无活动的 RUNNING 会话（模拟泄漏场景）
    const idle = replSessionManager.createSession('python');
    idle.setStatus(REPLSessionStatus.RUNNING);
    (idle as any).lastActivity = new Date(Date.now() - 11 * 60 * 1000);

    // mock stopREPL 为真实移除（原实现会 removeSession）
    const stopSpy = spyOn(REPLToolImpl.prototype, 'stopREPL').mockImplementation(
      async (s: any) => {
        replSessionManager.removeSession(s.id);
      }
    );

    try {
      const cell = new CodeCellImpl('c1', 'print(1)', 'python');
      const result = await tool.executeCell(cell);

      // 闲置会话被回收：stopREPL 收到 idle 会话
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(stopSpy.mock.calls[0][0]).toBe(idle);
      // 回收后无 RUNNING 可复用，重新 startREPL
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      // 会话数量不净增长：idle 回收 + 新建 1
      expect(replSessionManager.getSessionCount()).toBe(1);
    } finally {
      stopSpy.mockRestore();
    }
  });

});

describe('Notebook Feature 开关 (P0-2)', () => {
  it('getAllBaseTools 不含 notebook（无条件注册已删除）', () => {
    const names = getAllBaseTools().map((t) => t.name);
    expect(names).not.toContain('notebook');
    // 同时确认条件注册路径仍存在（feature 开启时经 ToolManagerUtils conditionalTool 加载）
    expect(names.length).toBeGreaterThan(0);
  });

  it('feature 关闭（默认）时 /notebook 命令禁用（命令层/工具层一致性）', async () => {
    const prev = process.env.FEATURE_NOTEBOOK;
    delete process.env.FEATURE_NOTEBOOK; // 默认 NOTEBOOK: false
    try {
      const cmd = await notebookCommand.load();
      const result = await cmd.execute('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Notebook 功能未启用');
    } finally {
      if (prev === undefined) delete process.env.FEATURE_NOTEBOOK;
      else process.env.FEATURE_NOTEBOOK = prev;
    }
  });

  it('feature 开启时命令放行（help 分支可执行）', async () => {
    const prev = process.env.FEATURE_NOTEBOOK;
    process.env.FEATURE_NOTEBOOK = 'true';
    try {
      const cmd = await notebookCommand.load();
      const result = await cmd.execute('');
      expect(result.success).toBe(true);
      expect(result.message).toContain('notebook help');
    } finally {
      if (prev === undefined) delete process.env.FEATURE_NOTEBOOK;
      else process.env.FEATURE_NOTEBOOK = prev;
    }
  });
});

describe('Notebook 导出存储 (P0-3)', () => {
  it('导出注册到 notebook zone 的 exports 子目录', async () => {
    const spy = spyOn(FileRegistry.prototype, 'registerFile').mockResolvedValue({
      action: 'created',
      fileId: 'x',
      savedPath: '/tmp/x.md',
      savedName: 'x.md',
      originalName: 'x.md',
      md5: 'abc',
    });
    try {
      const adapter = new NotebookToolAdapter();
      const created = (await adapter.execute(
        { action: 'create', name: 'p0-3-test' },
        {} as any
      )) as any;
      const notebookId = created.data?.notebookId as string | undefined;
      expect(notebookId).toBeDefined();

      await adapter.execute(
        { action: 'export', notebookId, format: 'markdown' },
        {} as any
      );

      // registerNotebookExport 为 fire-and-forget，轮询等待 registerFile 被调用
      let called = false;
      for (let i = 0; i < 50; i++) {
        if (spy.mock.calls.length > 0) {
          called = true;
          break;
        }
        await Bun.sleep(10);
      }
      expect(called).toBe(true);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ storeZone: 'notebook', subDir: 'exports' })
      );
    } finally {
      spy.mockRestore();
      notebookManager.clearNotebooks();
    }
  });
});

describe('JupyterNotebookConverter (P1-1 标准 nbformat 对齐)', () => {
  it('isJupyterFormat 识别标准 nbformat（cell_type）与自定义格式（type）', () => {
    expect(
      JupyterNotebookConverter.isJupyterFormat({ nbformat: 4, cells: [] })
    ).toBe(true);
    expect(
      JupyterNotebookConverter.isJupyterFormat({
        cells: [{ cell_type: 'code' }],
      })
    ).toBe(true);
    expect(
      JupyterNotebookConverter.isJupyterFormat({
        id: 'x',
        cells: [{ type: 'code' }],
      })
    ).toBe(false);
  });

  it('toJupyter 输出标准 nbformat 4.x（cell_type/source 行数组）', () => {
    const nb = new NotebookImpl('nb-1', 'Test');
    nb.addCell(new CodeCellImpl('c1', 'print(1)', 'python'));
    nb.addCell(new MarkdownCellImpl('c2', '# Title'));
    const j = JupyterNotebookConverter.toJupyter(nb) as any;
    expect(j.nbformat).toBe(4);
    expect(j.cells[0].cell_type).toBe('code');
    expect(j.cells[0].source.join('')).toBe('print(1)');
    expect(j.cells[1].cell_type).toBe('markdown');
    expect(j.cells[1].source.join('')).toBe('# Title');
  });

  it('toJupyter 满足 nbformat.validate 必填（cell.id + kernelspec.display_name）', () => {
    const nb = new NotebookImpl('nb-1', 'Test');
    nb.addCell(new CodeCellImpl('c1', 'print(1)', 'python'));
    nb.addCell(new MarkdownCellImpl('c2', '# Title'));
    const j = JupyterNotebookConverter.toJupyter(nb) as any;
    // cell 必须带 id（nbformat 5.x 起为硬性要求）
    expect(j.cells[0].id).toBe('c1');
    expect(j.cells[1].id).toBe('c2');
    // 内部默认 kernelspec 仅有 language/name，必须补齐 display_name
    expect(j.metadata.kernelspec.display_name).toBe('Python 3');
    expect(j.metadata.kernelspec.language).toBe('python');
  });

  it('fromJupyter → toJupyter roundtrip 保留内容', () => {
    const nb = new NotebookImpl('nb-1', 'RT');
    nb.addCell(new CodeCellImpl('c1', 'x = 1', 'python'));
    nb.addCell(new MarkdownCellImpl('c2', '## Doc'));
    const back = JupyterNotebookConverter.fromJupyter(
      JupyterNotebookConverter.toJupyter(nb)
    );
    expect(back.cells.length).toBe(2);
    expect(back.cells[0].type).toBe('code');
    expect((back.cells[0] as any).code).toBe('x = 1');
    expect(back.cells[1].type).toBe('markdown');
    expect((back.cells[1] as any).content).toBe('## Doc');
  });

  it('NotebookManager 保存写标准格式且可回读（含打开标准 ipynb）', () => {
    const dir = join(tmpdir(), `pyapp-notebook-p1-${randomUUID()}`);
    try {
      const manager = new NotebookManager(dir);
      const nb = manager.createNotebook('p1-test');
      nb.addCell(new CodeCellImpl('c1', 'print("hi")', 'python'));
      manager.saveNotebook(nb);

      const raw = JSON.parse(
        readFileSync(join(dir, 'p1-test.ipynb'), 'utf8')
      ) as any;
      expect(raw.nbformat).toBe(4);
      expect(raw.cells[0].cell_type).toBe('code');
      expect(raw.cells[0].source.join('')).toBe('print("hi")');

      // 从标准文件回读
      const loaded = manager.openNotebook(join(dir, 'p1-test.ipynb'));
      expect(loaded.cells.length).toBe(1);
      expect((loaded.cells[0] as any).code).toBe('print("hi")');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('NotebookToolAdapter.executeAllCells (P2-1 批量执行)', () => {
  it('批量执行所有代码单元格（跳过 markdown）', async () => {
    const startSpy = spyOn(REPLToolImpl.prototype, 'startREPL').mockImplementation(
      async (language: string) => {
        const s = replSessionManager.createSession(language);
        s.setStatus(REPLSessionStatus.RUNNING);
        return s;
      }
    );
    const execSpy = spyOn(REPLToolImpl.prototype, 'executeCode').mockImplementation(
      async () => ({
        success: true,
        output: 'ok',
        executionTime: 1,
      })
    );
    try {
      const adapter = new NotebookToolAdapter();
      const created = (await adapter.execute(
        { action: 'create', name: 'p2-1' },
        {} as any
      )) as any;
      const notebookId = created.data?.notebookId as string | undefined;
      expect(notebookId).toBeDefined();

      await adapter.execute(
        { action: 'addCodeCell', notebookId, code: 'a = 1', language: 'python' },
        {} as any
      );
      await adapter.execute(
        { action: 'addCodeCell', notebookId, code: 'a = 2', language: 'python' },
        {} as any
      );
      await adapter.execute(
        { action: 'addMarkdownCell', notebookId, content: '# doc' },
        {} as any
      );

      const res = (await adapter.execute(
        { action: 'executeAllCells', notebookId },
        {} as any
      )) as any;
      expect(res.success).toBe(true);
      expect(res.data.total).toBe(2); // 仅代码单元格被批量执行
      expect(res.data.succeeded).toBe(2);
      expect(res.data.failed).toBe(0);
    } finally {
      startSpy.mockRestore();
      execSpy.mockRestore();
      replSessionManager.clearSessions();
      notebookManager.clearNotebooks();
    }
  });
});

/**
 * TodoWriteTool - 待办事项管理工具
 *
 * 提供任务清单管理功能
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult, ErrorLevel } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolParam, ToolCallProgress } from '../types/Tool';
import { feature } from '@modules/core';
import { VERIFICATION_AGENT_TYPE } from '../AgentTool/constants';
import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath, ensureDir } from '@modules/core';
import { dirname } from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import { SimpleMutex } from '@modules/core';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'tools:todoWrite', level: LogLevel.INFO });

/**
 * Todo 项状态
 */
type TodoStatus = 'pending' | 'in_progress' | 'completed';

/**
 * Todo 项
 * 对标 CC TodoItemSchema: content（祈使句）+ activeForm（现在进行时）
 */
interface Todo {
  id: string;
  content: string;
  status: TodoStatus;
  activeForm?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const TODO_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS todowrite_todos (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  active_form TEXT,
  depends_on TEXT,
  metadata TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_todowrite_todos_session ON todowrite_todos(session_id);
`;

/** SQLite 持久化的 Todo 结构 */
interface TodoRow {
  id: string;
  session_id: string;
  content: string;
  status: string;
  active_form?: string;
  depends_on?: string;
  metadata?: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

/**
 * Todo 管理器（带 SQLite 持久化）
 */
class TodoManager {
  private todos: Map<string, Todo[]> = new Map();
  private db: Database;
  private initialized = false;
  private dbMutex = new SimpleMutex();

  constructor(dbPath: string = resolveDbPath()) {
    ensureDir(dirname(dbPath));
    this.db = new Database(dbPath);
    this.ensureTable();
    this.loadFromDb();
  }

  /** 确保表存在 */
  private ensureTable(): void {
    try {
      this.db.exec(TODO_TABLE_SCHEMA);
    } catch (e) {
      handleError(e, { module: 'tools:todoWrite', action: '建表失败' });
    }
  }

  /** 从 SQLite 恢复内存数据 */
  private loadFromDb(): void {
    try {
      this.db.all(
        'SELECT * FROM todowrite_todos ORDER BY session_id, sort_order',
        [],
        (err: Error | null, rows: TodoRow[]) => {
          if (err) {
            logger.error('TodoManager: 恢复失败', { error: String(err) });
            this.initialized = true;
            return;
          }
          for (const row of rows) {
            const todos = this.todos.get(row.session_id) || [];
            todos.push({
              id: row.id,
              content: row.content,
              status: row.status as TodoStatus,
              activeForm: row.active_form || undefined,
              metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
              createdAt: new Date(row.created_at),
              updatedAt: new Date(row.updated_at),
            });
            this.todos.set(row.session_id, todos);
          }
          this.initialized = true;
          logger.info('TodoManager: 恢复完成', {
            sessionCount: this.todos.size,
          });
        }
      );
    } catch (e) {
      handleError(e, {
        module: 'tools:todoWrite',
        action: '从数据库恢复Todo失败',
      });
      this.initialized = true;
    }
  }

  /** 写入单条 todo 到 SQLite */
  private async saveTodoToDb(
    sessionId: string,
    todo: Todo,
    sortOrder: number
  ): Promise<void> {
    await this.dbMutex.run(async () => {
      return new Promise<void>((resolve, reject) => {
        this.db.run(
          `INSERT OR REPLACE INTO todowrite_todos (id, session_id, content, status, active_form, metadata, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            todo.id,
            sessionId,
            todo.content,
            todo.status,
            todo.activeForm || null,
            todo.metadata ? JSON.stringify(todo.metadata) : null,
            sortOrder,
            todo.createdAt.getTime(),
            todo.updatedAt.getTime(),
          ],
          (err: Error | null) => {
            if (err) {
              logger.error('TodoManager: 写入失败', {
                todoId: todo.id,
                error: String(err),
              });
              resolve();
            } else {
              resolve();
            }
          }
        );
      });
    });
  }

  /** 全部写入到 SQLite（覆盖） */
  private async saveAllToDb(sessionId: string, todos: Todo[]): Promise<void> {
    await this.dbMutex.run(async () => {
      return new Promise<void>((resolve) => {
        this.db.run(
          'DELETE FROM todowrite_todos WHERE session_id = ?',
          [sessionId],
          (err: Error | null) => {
            if (err) {
              logger.error('TodoManager: 清除失败', { error: String(err) });
              resolve();
              return;
            }

            if (todos.length === 0) {
              resolve();
              return;
            }

            let completed = 0;
            for (let i = 0; i < todos.length; i++) {
              const todo = todos[i];
              this.db.run(
                `INSERT OR REPLACE INTO todowrite_todos (id, session_id, content, status, active_form, metadata, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  todo.id,
                  sessionId,
                  todo.content,
                  todo.status,
                  todo.activeForm || null,
                  todo.metadata ? JSON.stringify(todo.metadata) : null,
                  i,
                  todo.createdAt.getTime(),
                  todo.updatedAt.getTime(),
                ],
                (err2: Error | null) => {
                  if (err2)
                    logger.error('TodoManager: 写入失败', {
                      todoId: todo.id,
                      error: String(err2),
                    });
                  completed++;
                  if (completed >= todos.length) {
                    resolve();
                  }
                }
              );
            }
          }
        );
      });
    });
  }

  /** 删除单条 */
  private deleteFromDb(sessionId: string, todoId: string): void {
    this.dbMutex.run(async () => {
      return new Promise<void>((resolve) => {
        this.db.run(
          'DELETE FROM todowrite_todos WHERE id = ? AND session_id = ?',
          [todoId, sessionId],
          () => resolve()
        );
      });
    });
  }

  /**
   * 获取指定会话的 todos
   */
  getTodos(sessionId: string): Todo[] {
    return this.todos.get(sessionId) || [];
  }

  /**
   * 设置指定会话的 todos
   */
  setTodos(sessionId: string, todos: Todo[]): void {
    this.todos.set(sessionId, todos);
    void this.saveAllToDb(sessionId, todos);
  }

  /**
   * 添加 todo
   */
  addTodo(sessionId: string, content: string, activeForm?: string): Todo {
    const todos = this.getTodos(sessionId);
    const todo: Todo = {
      id: `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      content,
      status: 'pending',
      activeForm: activeForm || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    todos.push(todo);
    this.setTodos(sessionId, todos);

    return todo;
  }

  /**
   * 更新 todo
   */
  updateTodo(
    sessionId: string,
    todoId: string,
    updates: Partial<Todo>
  ): Todo | null {
    const todos = this.getTodos(sessionId);
    const index = todos.findIndex((t) => t.id === todoId);

    if (index === -1) return null;

    todos[index] = {
      ...todos[index],
      ...updates,
      updatedAt: new Date(),
    };

    this.setTodos(sessionId, todos);
    return todos[index];
  }

  /**
   * 删除 todo
   */
  deleteTodo(sessionId: string, todoId: string): boolean {
    const todos = this.getTodos(sessionId);
    const filtered = todos.filter((t) => t.id !== todoId);

    if (filtered.length === todos.length) return false;

    this.setTodos(sessionId, filtered);
    return true;
  }

  /**
   * 清除已完成的 todos
   */
  clearCompleted(sessionId: string): number {
    const todos = this.getTodos(sessionId);
    const completed = todos.filter((t) => t.status === 'completed');
    const active = todos.filter((t) => t.status !== 'completed');

    this.setTodos(sessionId, active);
    return completed.length;
  }

  /**
   * 列出所有会话的 todos
   */
  listAll(): Array<{ sessionId: string; todos: Todo[] }> {
    return Array.from(this.todos.entries())
      .map(([sessionId, todos]) => ({ sessionId, todos }))
      .filter((item) => item.todos.length > 0);
  }

  /** 关闭数据库连接 */
  close(): void {
    try {
      this.db.close();
    } catch (e) {
      handleError(e, {
        module: 'tools:todoWrite',
        action: '关闭数据库连接失败',
      });
    }
  }
}

// 全局 Todo 管理器（现在带 SQLite 持久化）
const todoManager = new TodoManager();

/**
 * TodoWriteTool实现
 */
export class TodoWriteTool extends BaseTool<Record<string, unknown>> {
  /** 工具名称 */
  name = 'todo_write';

  /** 工具描述 */
  override description =
    'Manage a todo list for tracking tasks. Create, update, and complete todos.';

  /** 最大结果大小 */
  override maxResultSizeChars = 10000;

  /** 工具参数 */
  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description:
        'Action to perform: list, add, update, delete, clear_completed, write',
      required: true,
      default: 'list',
    },
    {
      name: 'session_id',
      type: 'string',
      description: 'Session ID for the todo list',
      required: false,
      default: 'default',
    },
    {
      name: 'todo_id',
      type: 'string',
      description: 'ID of the todo to update or delete',
      required: false,
      default: '',
    },
    {
      name: 'content',
      type: 'string',
      description: 'Content of the todo',
      required: false,
      default: '',
    },
    {
      name: 'status',
      type: 'string',
      description: 'Status of the todo: pending, in_progress, completed',
      required: false,
      default: 'pending',
    },
    {
      name: 'todos',
      type: 'object',
      description: 'Array of todos for write action',
      required: false,
      default: [],
    },
    {
      name: 'activeForm',
      type: 'string',
      description:
        'Present continuous form of the task (e.g. "Fixing the login bug")',
      required: false,
      default: '',
    },
  ];

  /** 工具别名 */
  override aliases = ['todo', 'tasks', 'todo_list', 'create_task_list'];

  /**
   * 搜索提示
   */
  override searchHint = 'Manage tasks';

  /**
   * 检查工具是否只读
   */
  override isReadOnly(_input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查工具是否并发安全
   */
  override isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * 验证输入
   */
  override validateInput(
    input: Record<string, unknown>
  ): { result: true } | { result: false; message: string; errorCode?: number } {
    const validActions = [
      'list',
      'add',
      'update',
      'delete',
      'clear_completed',
      'write',
    ];
    if (!input.action || !validActions.includes(input.action as string)) {
      return {
        result: false,
        message: `action must be one of: ${validActions.join(', ')}`,
      };
    }

    const action = input.action as string;
    if (action === 'add' && !input.content) {
      return { result: false, message: 'content is required for add action' };
    }

    if ((action === 'update' || action === 'delete') && !input.todo_id) {
      return {
        result: false,
        message: 'todo_id is required for update/delete action',
      };
    }

    if (action === 'write' && (!input.todos || !Array.isArray(input.todos))) {
      return {
        result: false,
        message: 'todos array is required for write action',
      };
    }

    return { result: true };
  }

  /**
   * 获取用户可见的工具名称
   */
  override userFacingName(input?: Partial<Record<string, unknown>>): string {
    const action = (input?.action as string) || '';
    const content = (input?.content as string) || '';
    const sessionId = (input?.session_id as string) || 'default';

    switch (action) {
      case 'add':
        return `Todo Add: ${content.substring(0, 30)}${content.length > 30 ? '...' : ''}`;
      case 'update':
        return `Todo Update: ${(input?.todo_id as string) || ''}`;
      case 'delete':
        return `Todo Delete: ${(input?.todo_id as string) || ''}`;
      case 'list':
        return `Todo List: ${sessionId}`;
      case 'clear_completed':
        return `Todo Clear Completed: ${sessionId}`;
      case 'write':
        return `Todo Write: ${sessionId}`;
      default:
        return this.name;
    }
  }

  /**
   * 获取活动描述
   */
  override getActivityDescription(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const action = (input?.action as string) || '';
    const content = (input?.content as string) || '';
    const sessionId = (input?.session_id as string) || 'default';

    switch (action) {
      case 'add':
        return `Adding todo: ${content}`;
      case 'update':
        return `Updating todo: ${(input?.todo_id as string) || ''}`;
      case 'delete':
        return `Deleting todo: ${(input?.todo_id as string) || ''}`;
      case 'list':
        return `Listing todos for session: ${sessionId}`;
      case 'clear_completed':
        return `Clearing completed todos for session: ${sessionId}`;
      case 'write':
        return `Writing todos to session: ${sessionId}`;
      default:
        return null;
    }
  }

  /**
   * 获取工具使用摘要
   */
  override getToolUseSummary(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const action = (input?.action as string) || '';
    const content = (input?.content as string) || '';
    const sessionId = (input?.session_id as string) || 'default';

    switch (action) {
      case 'add':
        return `Add todo: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`;
      case 'update':
        return `Update todo: ${(input?.todo_id as string) || ''}`;
      case 'delete':
        return `Delete todo: ${(input?.todo_id as string) || ''}`;
      case 'list':
        return `List todos for session: ${sessionId}`;
      case 'clear_completed':
        return `Clear completed todos for session: ${sessionId}`;
      case 'write':
        return `Write todos to session: ${sessionId}`;
      default:
        return null;
    }
  }

  /**
   * 从 todo 列表构建 _todoData（用于流式更新 TaskCard）
   */
  private _buildTodoData(
    todos: Todo[],
    title: string = '任务计划'
  ): Record<string, unknown> {
    const safeTodos = Array.isArray(todos) ? todos : [];
    const allDone =
      safeTodos.length > 0 && safeTodos.every((t) => t.status === 'completed');
    const anyActive = safeTodos.some(
      (t) => t.status === 'in_progress' || t.status === 'completed'
    );
    const phase = allDone
      ? ('done' as const)
      : anyActive
        ? ('executing' as const)
        : ('planning' as const);

    return {
      title,
      phase,
      tasks: safeTodos.map((t) => ({
        id: t.id,
        name: t.content,
        status: t.status as 'pending' | 'in_progress' | 'completed',
        dependsOn: t.metadata?.dependsOn
          ? [t.metadata.dependsOn as string]
          : [],
      })),
    };
  }

  /**
   * 执行工具
   */
  async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult> {
    const toolUseId = context.toolUseId || this.name;

    const validation = this.validateInput(input);
    if (!validation.result) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${validation.message}`,
          },
        ],
        errorLevel: ErrorLevel.RECOVERABLE,
        metadata: {
          errorCategory: 'validation',
          errorCode: 'VALIDATION_FAILED',
        },
      });
    }

    const {
      action,
      session_id = context.toolUseId || 'default',
      todo_id,
      content,
      status,
      todos,
    } = input;

    try {
      onProgress?.({
        toolUseID: toolUseId,
        data: {
          percentage: 20,
          message: `正在执行 todo ${action}...`,
          stage: 'executing',
        },
      });

      switch (action) {
        case 'list': {
          const todos = todoManager.getTodos(session_id as string);

          if (todos.length === 0) {
            return createToolResult(
              'No todos found.\nUse `todo add` to create a new todo.',
              {
                newMessages: [
                  {
                    role: 'system',
                    content: 'No todos found.',
                  },
                ],
              }
            );
          }

          const pending = todos.filter((t) => t.status === 'pending').length;
          const inProgress = todos.filter(
            (t) => t.status === 'in_progress'
          ).length;
          const completed = todos.filter(
            (t) => t.status === 'completed'
          ).length;

          let output = `Todo List (${todos.length} items):\n`;
          output += `  Pending: ${pending} | In Progress: ${inProgress} | Completed: ${completed}\n`;
          output += `${'='.repeat(60)}\n\n`;

          todos.forEach((todo, index) => {
            const statusIcon =
              todo.status === 'completed'
                ? '✓'
                : todo.status === 'in_progress'
                  ? '◐'
                  : '○';
            output += `${index + 1}. [${statusIcon}] ${todo.content}\n`;
            output += `   ID: ${todo.id} | Status: ${todo.status}`;
            if (todo.activeForm) {
              output += ` | ActiveForm: ${todo.activeForm}`;
            }
            output += '\n\n';
          });

          return createToolResult(output, {
            newMessages: [
              {
                role: 'system',
                content: `Listed ${todos.length} todos`,
              },
            ],
          });
        }

        case 'add': {
          const todo = todoManager.addTodo(
            session_id as string,
            content as string,
            input.activeForm as string | undefined
          );

          let result = `Added todo:\n  ID: ${todo.id}\n  Content: ${todo.content}\n  Status: ${todo.status}`;
          if (todo.activeForm) {
            result += `\n  ActiveForm: ${todo.activeForm}`;
          }

          // 构建全量 todo 数据供前端流式更新 TaskCard
          const addAllTodos = todoManager.getTodos(session_id as string);
          const addTodoData = this._buildTodoData(addAllTodos);

          return createToolResult(result, {
            newMessages: [
              {
                role: 'system',
                content: `Added todo: ${todo.id}`,
              },
            ],
            metadata: { _todoData: addTodoData },
          });
        }

        case 'update': {
          const updates: Partial<Todo> = {};
          if (content) updates.content = content as string;
          if (
            status &&
            ['pending', 'in_progress', 'completed'].includes(status as string)
          ) {
            updates.status = status as TodoStatus;
          }
          if (input.activeForm !== undefined) {
            updates.activeForm = input.activeForm as string;
          }

          const todo = todoManager.updateTodo(
            session_id as string,
            todo_id as string,
            updates
          );

          if (todo) {
            let result = `Updated todo:\n  ID: ${todo.id}\n  Content: ${todo.content}\n  Status: ${todo.status}`;
            if (todo.activeForm) {
              result += `\n  ActiveForm: ${todo.activeForm}`;
            }

            // 构建全量 todo 数据供前端流式更新 TaskCard
            const updAllTodos = todoManager.getTodos(session_id as string);
            const updTodoData = this._buildTodoData(updAllTodos);

            return createToolResult(result, {
              newMessages: [
                {
                  role: 'system',
                  content: `Updated todo: ${todo.id}`,
                },
              ],
              metadata: { _todoData: updTodoData },
            });
          }

          // 补偿：todo_id 不存在时自动匹配该会话中最近被操作的任务
          // （防止上下文切换/丢失后 AI 用了错误的 todo_id，修复 BUG #11 todo 补偿）
          const sessionTodos = todoManager.getTodos(session_id as string);
          const latestTodo = sessionTodos[sessionTodos.length - 1];
          if (latestTodo) {
            Object.assign(latestTodo, updates, { updatedAt: new Date() });
            todoManager.setTodos(session_id as string, sessionTodos);

            const fallbackAllTodos = todoManager.getTodos(session_id as string);
            const fallbackTodoData = this._buildTodoData(fallbackAllTodos);

            return createToolResult(
              `Note: todo_id "${todo_id}" not found, auto-matched to latest todo "${latestTodo.id}".\nUpdated todo:\n  ID: ${latestTodo.id}\n  Content: ${latestTodo.content}\n  Status: ${latestTodo.status}`,
              {
                newMessages: [
                  {
                    role: 'system',
                    content: `Autofixed: "${todo_id}" → "${latestTodo.id}"`,
                  },
                ],
                metadata: { _todoData: fallbackTodoData },
              }
            );
          }

          return createToolResult(null, {
            newMessages: [
              {
                role: 'system',
                content: `Error: Todo not found: ${todo_id}，且该会话无可用 todo 自动匹配`,
              },
            ],
            errorLevel: ErrorLevel.RECOVERABLE,
            metadata: { errorCategory: 'data', errorCode: 'TODO_NOT_FOUND' },
          });
        }

        case 'delete': {
          const deleted = todoManager.deleteTodo(
            session_id as string,
            todo_id as string
          );

          if (deleted) {
            // 构建全量 todo 数据供前端流式更新 TaskCard
            const delAllTodos = todoManager.getTodos(session_id as string);
            const delTodoData = this._buildTodoData(delAllTodos);

            return createToolResult(`Deleted todo: ${todo_id}`, {
              newMessages: [
                {
                  role: 'system',
                  content: `Deleted todo: ${todo_id}`,
                },
              ],
              metadata: { _todoData: delTodoData },
            });
          }

          return createToolResult(null, {
            newMessages: [
              {
                role: 'system',
                content: `Error: Todo not found: ${todo_id}`,
              },
            ],
            errorLevel: ErrorLevel.RECOVERABLE,
            metadata: { errorCategory: 'data', errorCode: 'TODO_NOT_FOUND' },
          });
        }

        case 'clear_completed': {
          const count = todoManager.clearCompleted(session_id as string);

          // 构建全量 todo 数据供前端流式更新 TaskCard
          const ccAllTodos = todoManager.getTodos(session_id as string);
          const ccTodoData = this._buildTodoData(ccAllTodos);

          return createToolResult(`Cleared ${count} completed todo(s)`, {
            newMessages: [
              {
                role: 'system',
                content: `Cleared ${count} completed todos`,
              },
            ],
            metadata: { _todoData: ccTodoData },
          });
        }

        case 'write': {
          const newTodos: Todo[] = (todos as any[]).map((t) => ({
            id:
              t.id ||
              `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            content: t.content,
            status: t.status || 'pending',
            activeForm: t.activeForm || undefined,
            metadata: t.metadata || undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          }));

          todoManager.setTodos(session_id as string, newTodos);

          let resultMsg = `Wrote ${newTodos.length} todo(s) to session: ${session_id}`;

          const allDone =
            newTodos.length > 0 &&
            newTodos.every((t) => t.status === 'completed');
          if (
            feature('VERIFICATION_AGENT') &&
            allDone &&
            newTodos.length >= 3 &&
            !newTodos.some((t) => /verif/i.test(t.content))
          ) {
            resultMsg += `\n\nNOTE: You just closed out 3+ tasks and none of them was a verification step. Before writing your final summary, spawn the verification agent (subagent_type="${VERIFICATION_AGENT_TYPE}"). You cannot self-assign PARTIAL by listing caveats in your summary — only the verifier issues a verdict.`;
          }

          return createToolResult(resultMsg, {
            newMessages: [
              {
                role: 'system',
                content: `Wrote ${newTodos.length} todos to session: ${session_id}`,
              },
            ],
            metadata: {
              _todoData: {
                title: (input.name as string) || '任务计划',
                phase: 'planning' as const,
                tasks: newTodos.map((t) => ({
                  id: t.id,
                  name: t.content,
                  status: t.status as 'pending' | 'in_progress' | 'completed',
                  dependsOn: t.metadata?.dependsOn
                    ? [t.metadata.dependsOn as string]
                    : [],
                })),
              },
            },
          });
        }

        default:
          return createToolResult(null, {
            newMessages: [
              {
                role: 'system',
                content: `Error: Unknown action: ${action}`,
              },
            ],
            errorLevel: ErrorLevel.RECOVERABLE,
            metadata: {
              errorCategory: 'validation',
              errorCode: 'UNKNOWN_ACTION',
            },
          });
      }
    } catch (error: unknown) {
      onProgress?.({
        toolUseID: toolUseId,
        data: {
          percentage: 100,
          message: `Todo 操作失败: ${error instanceof Error ? error.message : String(error)}`,
          stage: 'error',
        },
      });
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: Todo operation failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        errorLevel: ErrorLevel.RETRYABLE,
        metadata: { errorCategory: 'execution', errorCode: 'EXECUTION_FAILED' },
      });
    }
  }
}

/**
 * 创建TodoWriteTool实例
 */
export function createTodoWriteTool(): TodoWriteTool {
  return new TodoWriteTool();
}

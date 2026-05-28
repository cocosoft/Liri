// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * TaskTool类型定义
 */

/**
 * Task状态
 */
export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Task优先级
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Task输入参数
 */
export interface TaskCreateInput {
  /** 任务主题 */
  subject: string;
  /** 任务描述 */
  description?: string;
  /** 主动词(显示在进度中) */
  activeForm?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export interface TaskUpdateInput {
  /** 任务ID */
  id: string;
  /** 任务状态 */
  status?: TaskStatus;
  /** 任务主题 */
  subject?: string;
  /** 任务描述 */
  description?: string;
  /** 主动词 */
  activeForm?: string;
  /** 优先级 */
  priority?: TaskPriority;
  /** 阻塞任务 */
  blockedBy?: string[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export interface TaskGetInput {
  /** 任务ID */
  id: string;
}

/**
 * Task输出结果
 */
export interface TaskOutput {
  /** 任务ID */
  id: string;
  /** 任务主题 */
  subject: string;
  /** 状态 */
  status: TaskStatus;
  /** 描述 */
  description?: string;
  /** 主动词 */
  activeForm?: string;
  /** 优先级 */
  priority?: TaskPriority;
  /** 阻塞任务 */
  blockedBy?: string[];
  /** 所有者 */
  owner?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 创建时间 */
  createdAt?: number;
  /** 更新时间 */
  updatedAt?: number;
}

/**
 * Task列表项
 */
export interface TaskListItem {
  id: string;
  subject: string;
  status: TaskStatus;
  owner?: string;
  blockedBy: string[];
}

/**
 * Task列表输出
 */
export interface TaskListOutput {
  tasks: TaskListItem[];
}

/**
 * Task创建输出
 */
export interface TaskCreateOutput {
  task: {
    id: string;
    subject: string;
  };
}

/**
 * Task更新输出
 */
export interface TaskUpdateOutput {
  task: {
    id: string;
    subject: string;
    status: TaskStatus;
  };
}

/**
 * Task定义
 */
export interface Task {
  /** 任务ID */
  id: string;
  /** 任务主题 */
  subject: string;
  /** 描述 */
  description?: string;
  /** 状态 */
  status: TaskStatus;
  /** 主动词 */
  activeForm?: string;
  /** 优先级 */
  priority?: TaskPriority;
  /** 阻塞任务 */
  blockedBy: string[];
  /** 所有者 */
  owner?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt?: number;
}

/**
 * Task存储接口
 */
export interface TaskStorage {
  /** 创建任务 */
  create(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task>;

  /** 获取任务 */
  get(id: string): Promise<Task | null>;

  /** 更新任务 */
  update(id: string, updates: Partial<Task>): Promise<Task>;

  /** 删除任务 */
  delete(id: string): Promise<void>;

  /** 列出任务 */
  list(): Promise<Task[]>;

  /** 按状态列出任务 */
  listByStatus(status: TaskStatus): Promise<Task[]>;
}

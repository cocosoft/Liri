/**
 * 任务管理模块主入口
 */

import {
  TaskService,
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
} from './models/types';
import { createTaskService, taskService } from './services/taskService';

// 导出任务管理相关类型和服务
export {
  TaskService,
  createTaskService,
  taskService,
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
};

// 导出默认服务实例
export default taskService;

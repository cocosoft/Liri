/**
 * Tips注册表
 * 管理所有可用的操作提示
 * */

import type { Tip, TipContext } from './types';

const externalTips: Tip[] = [
  {
    id: 'new-user-warmup',
    content: '从小的功能或bug修复开始，让Claude提出计划，并验证其建议的修改',
    cooldownSessions: 3,
    isRelevant: async () => true,
  },
  {
    id: 'plan-mode-for-complex-tasks',
    content: '对于复杂任务，使用计划模式让Claude先制定方案再执行',
    cooldownSessions: 5,
    isRelevant: async () => true,
  },
  {
    id: 'memory-command',
    content: '使用 /memory 查看和管理Claude的记忆',
    cooldownSessions: 15,
    isRelevant: async () => true,
  },
  {
    id: 'theme-command',
    content: '使用 /theme 更改颜色主题',
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'todo-list',
    content: '在处理复杂任务时，让Claude创建待办事项列表来跟踪进度',
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'compact-command',
    content: '对话太长时使用 /compact 压缩历史记录，减少上下文大小',
    cooldownSessions: 10,
    isRelevant: async () => true,
  },
  {
    id: 'voice-mode',
    content: '使用 /voice 启用语音模式，通过语音与Claude交互',
    cooldownSessions: 15,
    isRelevant: async () => true,
  },
  {
    id: 'config-command',
    content: '使用 /config 自定义Claude的行为和偏好设置',
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'session-management',
    content: '使用 /session 管理对话会话，保存和恢复工作进度',
    cooldownSessions: 15,
    isRelevant: async () => true,
  },
  {
    id: 'history-search',
    content: '使用 /history 搜索和回顾之前的对话记录',
    cooldownSessions: 15,
    isRelevant: async () => true,
  },
];

/**
 * 获取相关的提示列表
 */
export async function getRelevantTips(context?: TipContext): Promise<Tip[]> {
  const relevant: Tip[] = [];

  for (const tip of externalTips) {
    try {
      if (await tip.isRelevant()) {
        relevant.push(tip);
      }
    } catch {
      // ignore
    }
  }

  return relevant;
}

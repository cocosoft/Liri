//
/**
 * Hook设置工具
 * 负责Hook配置的读写和管理
 */

import { getLogger } from '@modules/monitoring/logs/Logger';
import { IndividualHookConfig, HookEvent } from '../types';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const logger = getLogger('hooksSettings');

/**
 * 读取Hook配置
 * @param configPath 配置文件路径
 * @returns 配置对象
 */
export function readHookConfig(configPath: string): any {
  if (!existsSync(configPath)) {
    return { hooks: [] };
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    logger.error('Error reading hook config', { error: String(error) });
    return { hooks: [] };
  }
}

/**
 * 写入Hook配置
 * @param configPath 配置文件路径
 * @param config 配置对象
 */
export function writeHookConfig(configPath: string, config: any): void {
  try {
    const content = JSON.stringify(config, null, 2);
    writeFileSync(configPath, content, 'utf8');
  } catch (error) {
    logger.error('Error writing hook config:', error);
  }
}

/**
 * 按优先级排序Hook
 * @param hooks Hook配置列表
 * @returns 排序后的Hook配置列表
 */
export function sortHooksByPriority(
  hooks: IndividualHookConfig[]
): IndividualHookConfig[] {
  return hooks.sort(
    (a, b) =>
      (((b.config as Record<string, unknown>).priority as number) || 0) -
      (((a.config as Record<string, unknown>).priority as number) || 0)
  );
}

/**
 * 按优先级排序匹配器
 * @param matchers 匹配器列表
 * @param hooksByEventAndMatcher 按事件和匹配器分组的Hook
 * @param event 事件类型
 * @returns 排序后的匹配器列表
 */
export function sortMatchersByPriority(
  matchers: string[],
  hooksByEventAndMatcher: Record<
    HookEvent,
    Record<string, IndividualHookConfig[]>
  >,
  event: HookEvent
): string[] {
  return matchers.sort((a, b) => {
    const hooksA = hooksByEventAndMatcher[event]?.[a] || [];
    const hooksB = hooksByEventAndMatcher[event]?.[b] || [];

    // 计算匹配器的平均优先级
    const getPriority = (hook: IndividualHookConfig) =>
      ((hook.config as Record<string, unknown>).priority as number) || 0;

    const priorityA =
      hooksA.reduce((sum, hook) => sum + getPriority(hook), 0) /
      (hooksA.length || 1);
    const priorityB =
      hooksB.reduce((sum, hook) => sum + getPriority(hook), 0) /
      (hooksB.length || 1);

    return priorityB - priorityA;
  });
}

/**
 * 验证Hook配置
 * @param hook Hook配置
 * @returns 验证结果
 */
export function validateHookConfig(hook: any): {
  valid: boolean;
  error?: string;
} {
  // 验证事件类型
  if (!hook.event) {
    return { valid: false, error: 'Hook must have an event' };
  }

  // 验证配置
  if (!hook.config) {
    return { valid: false, error: 'Hook must have a config' };
  }

  // 验证配置类型
  if (!['command', 'prompt', 'http', 'agent'].includes(hook.config.type)) {
    return {
      valid: false,
      error: 'Hook config type must be one of: command, prompt, http, agent',
    };
  }

  // 验证命令类型Hook
  if (hook.config.type === 'command' && !hook.config.command) {
    return { valid: false, error: 'Command type hook must have a command' };
  }

  // 验证HTTP类型Hook
  if (
    hook.config.type === 'http' &&
    (!hook.config.http || !hook.config.http.url)
  ) {
    return { valid: false, error: 'HTTP type hook must have a url' };
  }

  // 验证代理类型Hook
  if (
    hook.config.type === 'agent' &&
    (!hook.config.agent || !hook.config.agent.id)
  ) {
    return { valid: false, error: 'Agent type hook must have an agent id' };
  }

  return { valid: true };
}

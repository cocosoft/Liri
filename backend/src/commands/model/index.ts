/**
 * Model命令
 * 设置AI模型
 * 参考CC源码 cc_code/backend/commands/model/index.ts 实现
 */

import type { Command } from '../types/index.js';

/**
 * 获取当前模型名称
 */
function getCurrentModel(): string {
  return process.env.PY_APP_MODEL || 'claude-sonnet-4-20250514';
}

/**
 * Model命令实现
 */
const model: Command = {
  type: 'local',
  name: 'model',
  get description() {
    return `设置PY_APP的AI模型 (当前: ${getCurrentModel()})`;
  },
  argumentHint: '[model]',
  load: async () => {
    const { executeModel } = await import('./model.js');
    return {
      execute: executeModel,
    };
  },
};

export default model;

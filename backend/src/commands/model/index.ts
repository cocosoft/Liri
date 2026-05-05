/**
 * Model命令
 * 设置AI模型
 * 参考CC源码 cc_code/backend/commands/model/index.ts 实现
 * 使用 ModelManager 作为唯一数据源
 */

import type { Command } from '../types/index.js';
import { modelManager } from '../../ai/models/ModelManager.js';

/**
 * Model命令实现
 */
const model: Command = {
  type: 'local',
  name: 'model',
  get description() {
    return `设置PY_APP的AI模型 (当前: ${modelManager.getCurrentModel()})`;
  },
  aliases: ['models', 'ml', 'list-models'],
  argumentHint: '[model]',
  userInvocable: true,
  load: async () => {
    const { executeModel } = await import('./model.js');
    return {
      execute: executeModel,
    };
  },
};

export default model;

/**
 * Model 命令模块入口
 * 设置 AI 模型
 * 对标 CC 源码 cc_code/backend/commands/model/index.ts 实现
 * 使用 ModelManager 作为唯一数据源
 */
import type { Command } from '@modules/commands/types';
import { modelManager } from '@modules/ai/models/ModelManager.js';

const modelCommand: Command = {
  type: 'local',
  name: 'model',
  get description() {
    return `设置 PY_APP 的 AI 模型 (当前: ${modelManager.getCurrentModel()})`;
  },
  aliases: ['models', 'ml', 'list-models'],
  argumentHint: '[model|info|all|--json|help]',
  whenToUse: '当你需要查看或切换 AI 模型时',
  load: () => import('./model.js').then(m => m.default),
};

export default modelCommand;
export { modelCommand };

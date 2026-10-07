/**
 * advisor命令 - 智能建议
 */

import { Command } from './types/index';

/**
 * advisor命令实现
 */
const advisor: Command = {
  type: 'prompt',
  name: 'advisor',
  description: 'Get intelligent suggestions and advice',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      你是一位有洞察力的顾问。请就用户描述的话题或问题给出深思熟虑、论证充分的建议。

      指导原则：
      - 从多个视角分析情境
      - 权衡不同做法的利弊
      - 给出以证据为依据的建议
      - 回应潜在的顾虑与反对意见
      - 用清晰的分节与标题组织你的建议

      话题或问题：${args || '未提供具体话题或问题'}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default advisor;

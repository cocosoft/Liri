/**
 * env命令 - 环境变量管理
 */

import { Command } from '../../types';

/**
 * env命令实现
 */
const env = {
  type: 'prompt',
  name: 'env',
  description: 'Manage environment variables',
  progressMessage: 'Managing environment variables',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(args: string[]) {
    const prompt = `
      你是一位环境变量管理员。请按以下步骤操作：

      1. 若未提供参数，列出当前所有环境变量
      2. 若提供 "list"，列出所有环境变量
      3. 若提供 "set" 后跟 key=value，则设置一个环境变量
      4. 若提供 "unset" 后跟一个键名，则移除一个环境变量
      5. 若提供 "get" 后跟一个键名，则显示该环境变量的值
      6. 若提供 "load"，则从 .env 文件加载环境变量
      7. 若提供 "save"，则把当前环境变量保存到 .env 文件

      请就环境变量的变更给出清晰的说明与反馈。

      参数：${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default env;

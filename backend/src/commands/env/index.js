/**
 * env命令 - 环境变量管理
 */

const { Command } = require('../../types/command');

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
  async getPromptForCommand(args) {
    const prompt = `
      You are an environment variable manager. Follow these steps:

      1. If no arguments are provided, list all current environment variables
      2. If "list" is provided, list all environment variables
      3. If "set" is provided followed by key=value, set an environment variable
      4. If "unset" is provided followed by a key, remove an environment variable
      5. If "get" is provided followed by a key, show the value of an environment variable
      6. If "load" is provided, load environment variables from a .env file
      7. If "save" is provided, save current environment variables to a .env file

      Provide clear instructions and feedback on environment variable changes.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

module.exports = env;

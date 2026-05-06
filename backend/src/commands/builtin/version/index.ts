/**
 * 版本命令
 * 显示系统版本信息
 */
import type { Command } from '@modules/commands/types';
import * as fs from 'fs';
import * as path from 'path';

export const versionCommand: Command = {
  type: 'action',
  name: 'version',
  description: '显示系统版本信息',
  aliases: ['v', 'ver'],
  whenToUse: '当你需要了解PY_APP的版本信息时',
  load: async () => ({
    execute: async () => {
      try {
        const packagePath = path.join(process.cwd(), 'package.json');
        const packageContent = fs.readFileSync(packagePath, 'utf8');
        const packageData = JSON.parse(packageContent);

        return {
          success: true,
          message:
            `PY_APP Version: ${packageData.version}\n` +
            `Description: ${packageData.description}\n` +
            `Author: ${packageData.author}\n` +
            `License: ${packageData.license}`,
        };
      } catch (error) {
        return {
          success: true,
          message: 'PY_APP Version: 1.0.0\nDescription: AI Agent for Python',
        };
      }
    },
  }),
};
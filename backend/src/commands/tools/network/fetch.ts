/**
 * Fetch命令
 * 调用WebFetchTool来获取网页内容
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * Fetch命令
 */
export const fetchCommand: Command = {
  type: 'action',
  name: 'fetch',
  description: '获取网页内容',
  aliases: [],
  argumentHint: '<url>',
  whenToUse: '当你需要获取网页内容时',
  load: async () => ({
    execute: async (args: string) => {
      const url = args.trim();

      if (!url) {
        return {
          success: false,
          error: `Usage: /fetch <url>\n\nFetch web content from a URL.\n\nExample:\n  /fetch https://example.com\n  /fetch https://api.example.com/data`,
        };
      }

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'web_fetch',
          {
            url: url,
          },
          {}
        );

        // 限制输出长度，避免过多内容
        const content = result.content || '';
        const limitedContent =
          content.length > 1000 ? content.substring(0, 1000) + '...' : content;

        return {
          success: true,
          message: `Fetched content from ${url}:\n\n${limitedContent}`,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error fetching content: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default fetchCommand;

/**
 * WebSearch命令
 * 调用WebSearchTool来执行网络搜索
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * WebSearch命令
 */
export const websearchCommand: Command = {
  type: 'action',
  name: 'websearch',
  description: '执行网络搜索',
  aliases: [],
  argumentHint: '<query>',
  whenToUse: '当你需要执行网络搜索时',
  load: async () => ({
    execute: async (args: string) => {
      const query = args.trim();

      if (!query) {
        return {
          success: false,
          error: `Usage: /websearch <query>\n\nSearch the web for information.\n\nExample:\n  /websearch "Python programming"`,
        };
      }

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'web_search',
          {
            query: query,
          },
          {}
        );

        if (result.results && result.results.length > 0) {
          const formattedResults = result.results
            .map((item: any, index: number) => {
              return `${index + 1}. ${item.title}\n   ${item.url}\n   ${item.snippet}`;
            })
            .join('\n\n');

          return {
            success: true,
            message: `Search results for "${query}":\n\n${formattedResults}`,
          };
        } else {
          return {
            success: true,
            message: `No results found for "${query}"`,
          };
        }
      } catch (error) {
        return {
          success: false,
          error: `Error searching the web: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default websearchCommand;

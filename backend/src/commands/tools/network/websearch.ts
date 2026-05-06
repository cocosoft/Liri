/**
 * WebSearch命令
 * 调用WebSearchTool来执行网络搜索
 * 基于CC源码 cc_code/backend/tools/WebSearchTool 实现
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '@modules/tools/ToolManager.js';

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
        const rawResult = await toolManager.executeTool(
          'web_search',
          {
            query: query,
          },
          {}
        );

        // executeTool 返回的是 createToolResult 包裹后的 ToolResult 对象
        // 实际数据在 data 字段中
        const data = rawResult.data as {
          query: string;
          results: Array<{ title: string; url: string; snippet: string }>;
          totalResults: number;
        };

        if (data && data.results && data.results.length > 0) {
          const formattedResults = data.results
            .map((item, index) => {
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

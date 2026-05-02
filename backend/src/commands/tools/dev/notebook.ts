/**
 * Notebook命令
 * 调用NotebookTool来编辑Jupyter笔记本
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * Notebook命令
 */
export const notebookCommand: Command = {
  type: 'action',
  name: 'notebook',
  description: '编辑Jupyter笔记本',
  aliases: [],
  argumentHint: '[create|open|add|run|save|help] [args]',
  whenToUse: '当你需要编辑Jupyter笔记本时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return {
          success: true,
          message: `Notebook Command Help\n=====================\n\nUsage:\n  /notebook create <name>            - Create a new notebook\n  /notebook open <path>              - Open an existing notebook\n  /notebook add <cell_type> <content> - Add a cell to notebook\n  /notebook run <path>               - Run a notebook\n  /notebook save <path>              - Save a notebook\n\nExamples:\n  /notebook create "My Notebook"\n  /notebook open notebook.ipynb\n  /notebook add code "print('Hello')"`,
        };
      }

      if (subcommand === 'create') {
        const name = parts.slice(1).join(' ');

        if (!name) {
          return {
            success: false,
            error:
              'Error: Please specify notebook name\nUsage: /notebook create <name>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'notebook',
            {
              action: 'create',
              name: name,
            },
            {}
          );

          return {
            success: true,
            message: `Notebook created: ${result.path}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error creating notebook: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'open') {
        const path = parts[1];

        if (!path) {
          return {
            success: false,
            error:
              'Error: Please specify notebook path\nUsage: /notebook open <path>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'notebook',
            {
              action: 'open',
              path: path,
            },
            {}
          );

          return {
            success: true,
            message: `Notebook opened: ${path}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error opening notebook: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'add') {
        const cellType = parts[1];
        const content = parts.slice(2).join(' ');

        if (!cellType || !content) {
          return {
            success: false,
            error:
              'Error: Please specify cell type and content\nUsage: /notebook add <cell_type> <content>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'notebook',
            {
              action: 'add',
              cell_type: cellType,
              content: content,
            },
            {}
          );

          return {
            success: true,
            message: `Cell added successfully`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error adding cell: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'run') {
        const path = parts[1];

        if (!path) {
          return {
            success: false,
            error:
              'Error: Please specify notebook path\nUsage: /notebook run <path>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'notebook',
            {
              action: 'run',
              path: path,
            },
            {}
          );

          return {
            success: true,
            message: `Notebook executed successfully`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error running notebook: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'save') {
        const path = parts[1];

        if (!path) {
          return {
            success: false,
            error:
              'Error: Please specify notebook path\nUsage: /notebook save <path>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'notebook',
            {
              action: 'save',
              path: path,
            },
            {}
          );

          return {
            success: true,
            message: `Notebook saved: ${path}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error saving notebook: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      return {
        success: false,
        error: `Error: Unknown subcommand: ${subcommand}\n\nUse /notebook help for help`,
      };
    },
  }),
};

export default notebookCommand;

// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import type { Command } from '@modules/commands';
import { createChatManager } from '@modules/chat/ChatManager.js';

function getChatManager(context: any) {
  if (context.chatManager) {
    return context.chatManager;
  }
  const manager = createChatManager();
  if (typeof (manager as any).initialize === 'function') {
    (manager as any).initialize();
  }
  return manager;
}

function getHelpText(): string {
  return `Checkpoint Command Help
========================

Usage:
  /checkpoint create [label]        - Create a checkpoint for current session
  /checkpoint list [session_id]     - List checkpoints for a session
  /checkpoint info <checkpoint_id>  - Show checkpoint details
  /checkpoint rollback <cp_id>      - Rollback to a checkpoint
  /checkpoint delete <cp_id>        - Delete a checkpoint
  /checkpoint clean <session_id>    - Delete all checkpoints for a session
  /checkpoint current               - Show latest checkpoint for current session

Examples:
  /checkpoint create "before refactor"
  /checkpoint list
  /checkpoint info cp_abc123
  /checkpoint rollback cp_abc123
  /checkpoint delete cp_abc123
  /checkpoint clean session_xyz
  /checkpoint current`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

function truncateLabel(label?: string, maxLen: number = 40): string {
  if (!label) return '(no label)';
  return label.length > maxLen ? label.substring(0, maxLen) + '...' : label;
}

function getSessionIdFromContext(
  context: any,
  chatManager: any
): string | null {
  if (context?.sessionId) {
    return context.sessionId;
  }
  const current = chatManager.getCurrentSession();
  return current?.id || null;
}

const checkpointCommand: Command = {
  type: 'action',
  name: 'checkpoint',
  description: '管理会话检查点（快照与回滚）',
  aliases: ['cp'],
  argumentHint: '[create|list|info|rollback|delete|clean|current]',
  whenToUse: '当你需要保存会话快照或回滚到之前的会话状态时',
  load: async () => ({
    execute: async (args: string, context: any) => {
      const chatManager = getChatManager(context);
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return { success: true, message: getHelpText() };
      }

      try {
        switch (subcommand) {
          case 'create': {
            const sessionId = getSessionIdFromContext(context, chatManager);
            if (!sessionId) {
              return {
                success: false,
                error:
                  'No active session. Create one with /session create first.',
              };
            }

            const label = parts.slice(1).join(' ') || undefined;
            const cpId = await chatManager.createCheckpoint(sessionId, label);

            return {
              success: true,
              message: `Checkpoint created successfully!\nID: ${cpId}\nSession: ${sessionId}${label ? `\nLabel: ${label}` : ''}`,
            };
          }

          case 'list': {
            const sessionId =
              parts[1] || getSessionIdFromContext(context, chatManager);
            if (!sessionId) {
              return {
                success: false,
                error: 'No session specified and no active session.',
              };
            }

            const checkpoints = await chatManager.listCheckpoints(sessionId);

            if (checkpoints.length === 0) {
              return {
                success: true,
                message: `No checkpoints found for session: ${sessionId}`,
              };
            }

            let output = `Checkpoints for session: ${sessionId}\n`;
            output += '='.repeat(50) + '\n\n';

            for (const cp of checkpoints) {
              output += `[${cp.id}]\n`;
              output += `  Label:     ${truncateLabel(cp.label)}\n`;
              output += `  Created:   ${formatTimestamp(cp.createdAt)}\n`;
              output += `  Messages:  ${cp.messages.length}\n`;
              output += `  State:     ${cp.state}\n`;
              output += `  Auto:      ${cp.autoCreated ? 'Yes' : 'No'}\n\n`;
            }

            output += `Total: ${checkpoints.length} checkpoints`;
            return { success: true, message: output };
          }

          case 'info': {
            const cpId = parts[1];
            if (!cpId) {
              return {
                success: false,
                error:
                  'Please specify a checkpoint ID.\nUsage: /checkpoint info <checkpoint_id>',
              };
            }

            const allCheckpoints = await chatManager.listCheckpoints('');
            let checkpoint = null;
            for (const cp of allCheckpoints) {
              if (cp.id === cpId) {
                checkpoint = cp;
                break;
              }
            }

            if (!checkpoint) {
              const cp = await (chatManager as any).getCheckpoint?.(cpId);
              if (cp) checkpoint = cp;
            }

            if (!checkpoint) {
              return { success: false, error: `Checkpoint not found: ${cpId}` };
            }

            let output = `Checkpoint Info: ${cpId}\n`;
            output += '='.repeat(40) + '\n\n';
            output += `Session:     ${checkpoint.sessionId}\n`;
            output += `Label:       ${checkpoint.label || '(no label)'}\n`;
            output += `Description: ${checkpoint.description || '(none)'}\n`;
            output += `Created:     ${formatTimestamp(checkpoint.createdAt)}\n`;
            output += `Messages:    ${checkpoint.messages.length}\n`;
            output += `State:       ${checkpoint.state}\n`;
            output += `Auto:        ${checkpoint.autoCreated ? 'Yes' : 'No'}\n`;
            if (checkpoint.tokenCount) {
              output += `Tokens:      ${checkpoint.tokenCount}\n`;
            }

            return { success: true, message: output };
          }

          case 'rollback': {
            const cpId = parts[1];
            if (!cpId) {
              return {
                success: false,
                error:
                  'Please specify a checkpoint ID.\nUsage: /checkpoint rollback <checkpoint_id>',
              };
            }

            const result = await chatManager.rollbackToCheckpoint(cpId);

            let output = `Rolled back to checkpoint: ${cpId}\n`;
            output += '='.repeat(40) + '\n\n';
            output += `Session: ${result.session.id}\n`;
            output += `Messages: ${result.session.messages.length}\n`;
            output += `State: ${result.session.state}\n`;
            output += `\nChanges:\n  ${result.diff.summary}`;

            return { success: true, message: output };
          }

          case 'delete': {
            const cpId = parts[1];
            if (!cpId) {
              return {
                success: false,
                error:
                  'Please specify a checkpoint ID.\nUsage: /checkpoint delete <checkpoint_id>',
              };
            }

            await chatManager.deleteCheckpoint(cpId);
            return { success: true, message: `Checkpoint deleted: ${cpId}` };
          }

          case 'clean': {
            const sessionId =
              parts[1] || getSessionIdFromContext(context, chatManager);
            if (!sessionId) {
              return {
                success: false,
                error: 'No session specified and no active session.',
              };
            }

            const sessionManager = chatManager.getSessionManager();
            await (sessionManager as any).deleteSessionCheckpoints(sessionId);
            return {
              success: true,
              message: `All checkpoints deleted for session: ${sessionId}`,
            };
          }

          case 'current': {
            const sessionId = getSessionIdFromContext(context, chatManager);
            if (!sessionId) {
              return { success: false, error: 'No active session.' };
            }

            const latest = await chatManager.getLatestCheckpoint(sessionId);
            if (!latest) {
              return {
                success: true,
                message: `No checkpoints found for current session: ${sessionId}`,
              };
            }

            let output = `Latest Checkpoint for current session\n`;
            output += '='.repeat(40) + '\n\n';
            output += `ID:        ${latest.id}\n`;
            output += `Label:     ${latest.label || '(no label)'}\n`;
            output += `Created:   ${formatTimestamp(latest.createdAt)}\n`;
            output += `Messages:  ${latest.messages.length}\n`;
            output += `State:     ${latest.state}`;

            return { success: true, message: output };
          }

          default:
            return {
              success: false,
              error: `Unknown subcommand: ${subcommand}\n\nUse /checkpoint help for usage.`,
            };
        }
      } catch (error) {
        return {
          success: false,
          error: `Checkpoint command failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default checkpointCommand;

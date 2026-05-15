/**
 * ThinkingTool 结构化思维工具
 * 让 Agent 记录和组织思考过程，支持多轮推理和链式思考
 */
import { BaseTool } from '../BaseTool';
import type { ToolParam, ToolResult, ToolUseContext } from '../types/index';

interface ThinkingInput {
  action: 'think' | 'reflect' | 'summarize' | 'revise';
  thought: string;
  step?: number;
  tags?: string[];
}

interface ThinkingEntry {
  step: number;
  thought: string;
  tags: string[];
  timestamp: number;
  revised?: string;
}

export class ThinkingTool extends BaseTool<Record<string, unknown>> {
  name = 'thinking';
  description = 'Record and organize structured thinking steps. Supports adding, reflecting, summarizing, and revising thoughts during multi-step reasoning.';
  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description: 'Thinking action: think (add), reflect (review), summarize (condense), revise (update)',
      required: true,
      enum: ['think', 'reflect', 'summarize', 'revise'],
    },
    {
      name: 'thought',
      type: 'string',
      description: 'The thought content to record',
      required: true,
    },
    {
      name: 'step',
      type: 'number',
      description: 'Step number (auto-assigned if omitted)',
      required: false,
    },
    {
      name: 'tags',
      type: 'array',
      description: 'Optional tags to categorize the thought',
      required: false,
    },
  ];

  override aliases = ['think', 'reason', 'reflect'];
  override searchHint = 'Record structured reasoning steps';

  private thoughts: ThinkingEntry[] = [];
  private stepCounter: number = 0;

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const { action, thought, tags } = input as unknown as ThinkingInput;

      const validActions = ['think', 'reflect', 'summarize', 'revise'];
      if (!action || !validActions.includes(action)) {
        return { success: false, error: `action must be one of: ${validActions.join(', ')}` };
      }

      switch (action) {
        case 'think': {
          if (!thought || typeof thought !== 'string') {
            return { success: false, error: 'thought is required and must be a string' };
          }

          this.stepCounter++;
          const entry: ThinkingEntry = {
            step: this.stepCounter,
            thought,
            tags: (tags as string[]) || [],
            timestamp: Date.now(),
          };
          this.thoughts.push(entry);

          return {
            success: true,
            data: { step: this.stepCounter, totalSteps: this.thoughts.length },
            output: `Step ${this.stepCounter}: ${thought.slice(0, 200)}${thought.length > 200 ? '...' : ''}`,
          };
        }

        case 'reflect': {
          if (this.thoughts.length === 0) {
            return { success: true, data: { thoughts: [] }, output: 'No thoughts recorded yet.' };
          }

          const summary = this.thoughts.map((t) =>
            `[Step ${t.step}] ${t.thought.slice(0, 100)}`
          ).join('\n');

          return {
            success: true,
            data: { thoughts: this.thoughts, count: this.thoughts.length },
            output: `=== Thinking Log (${this.thoughts.length} steps) ===\n${summary}`,
          };
        }

        case 'summarize': {
          if (this.thoughts.length === 0) {
            return { success: true, output: 'No thoughts to summarize.' };
          }

          const tagSummary = this.thoughts.flatMap((t) => t.tags).filter(Boolean);
          const uniqueTags = [...new Set(tagSummary)];

          return {
            success: true,
            data: { totalSteps: this.thoughts.length, tags: uniqueTags, steps: this.thoughts },
            output: `Summary: ${this.thoughts.length} reasoning steps recorded. Tags: ${uniqueTags.join(', ') || 'none'}.`,
          };
        }

        case 'revise': {
          if (!thought || typeof thought !== 'string') {
            return { success: false, error: 'thought is required and must be a string for revise action' };
          }

          const step = (input as unknown as ThinkingInput).step;
          if (!step) {
            return { success: false, error: 'step number is required for revise action' };
          }

          const target = this.thoughts.find((t) => t.step === step);
          if (!target) {
            return { success: false, error: `Step ${step} not found` };
          }

          target.revised = thought;

          return {
            success: true,
            data: { step, original: target.thought, revised: thought },
            output: `Step ${step} revised.`,
          };
        }

        default:
          return { success: false, error: `Unhandled action: ${action}` };
      }
    } catch (error) {
      return {
        success: false,
        error: `Thinking tool failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createThinkingTool(): ThinkingTool {
  return new ThinkingTool();
}

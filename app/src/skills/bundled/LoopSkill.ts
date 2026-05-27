/**
 * Loop技能
 * 用于设置周期性任务的技能
 */

import { Tool } from '@modules/tools/types/Tool';
import { ToolResult } from '@modules/tools/types/ToolResult';
import { ToolUseContext } from '@modules/tools/types/ToolUseContext';
import { ToolUtils } from '@modules/tools/utils/ToolUtils';
import {
  addCronTask,
  listAllCronTasks,
  nextCronRunMs,
} from '@modules/chronos/CronTasks';
import { cronToHuman, parseCronExpression } from '@modules/chronos/cron';

const DEFAULT_INTERVAL = '10m';
const DEFAULT_MAX_AGE_DAYS = 7;
const CRON_CREATE_TOOL_NAME = 'cron_create';
const CRON_DELETE_TOOL_NAME = 'cron_delete';

const USAGE_MESSAGE = `Usage: /loop [interval] <prompt>

Run a prompt or slash command on a recurring interval.

Intervals: Ns, Nm, Nh, Nd (e.g. 5m, 30m, 2h, 1d). Minimum granularity is 1 minute.
If no interval is specified, defaults to ${DEFAULT_INTERVAL}.

Examples:
  /loop 5m /babysit-prs
  /loop 30m check the deploy
  /loop 1h /standup 1
  /loop check the deploy          (defaults to ${DEFAULT_INTERVAL})
  /loop check the deploy every 20m`;

interface ParsedInterval {
  interval: string;
  cron: string;
  humanReadable: string;
}

function parseIntervalToCron(intervalStr: string): ParsedInterval | null {
  const match = intervalStr.match(/^(\d+)([smhd])$/);
  if (!match) {
    return null;
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2];

  if (value <= 0) {
    return null;
  }

  switch (unit) {
    case 's': {
      const minutes = Math.ceil(value / 60);
      return {
        interval: `${minutes}m`,
        cron: `*/${minutes} * * * *`,
        humanReadable: `every ${minutes} minute${minutes > 1 ? 's' : ''}`,
      };
    }
    case 'm': {
      if (value <= 59) {
        return {
          interval: `${value}m`,
          cron: `*/${value} * * * *`,
          humanReadable: `every ${value} minute${value > 1 ? 's' : ''}`,
        };
      } else {
        const hours = Math.round(value / 60);
        if (hours > 0 && 24 % hours === 0) {
          return {
            interval: `${value}m`,
            cron: `0 */${hours} * * *`,
            humanReadable: `every ${hours} hour${hours > 1 ? 's' : ''}`,
          };
        } else {
          return null;
        }
      }
    }
    case 'h': {
      if (value <= 23) {
        return {
          interval: `${value}h`,
          cron: `0 */${value} * * *`,
          humanReadable: `every ${value} hour${value > 1 ? 's' : ''}`,
        };
      } else {
        return null;
      }
    }
    case 'd': {
      if (value <= 31) {
        return {
          interval: `${value}d`,
          cron: `0 0 */${value} * *`,
          humanReadable: `every ${value} day${value > 1 ? 's' : ''}`,
        };
      } else {
        return null;
      }
    }
    default:
      return null;
  }
}

function parseLoopInput(input: string): {
  interval: string;
  cron: string;
  humanReadable: string;
  prompt: string;
} | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  let intervalStr: string;
  let promptText: string;

  const tokens = trimmed.split(/\s+/);
  const firstToken = tokens[0];

  if (firstToken && firstToken.match(/^\d+[smhd]$/)) {
    intervalStr = firstToken;
    promptText = tokens.slice(1).join(' ');
  } else {
    const everyMatch = trimmed.match(
      /^(.+?)\s+every\s+(\d+)\s*(minutes?|hours?|days?|h|m|d)s?$/i
    );
    if (everyMatch) {
      promptText = everyMatch[1]!.trim();
      const num = parseInt(everyMatch[2]!, 10);
      const unitStr = everyMatch[3]!.toLowerCase();
      let unit = 'm';
      if (unitStr.startsWith('hour') || unitStr === 'h') {
        unit = 'h';
      } else if (unitStr.startsWith('day') || unitStr === 'd') {
        unit = 'd';
      }
      intervalStr = `${num}${unit}`;
    } else {
      intervalStr = DEFAULT_INTERVAL;
      promptText = trimmed;
    }
  }

  if (!promptText) {
    return null;
  }

  const parsed = parseIntervalToCron(intervalStr);
  if (!parsed) {
    return null;
  }

  return {
    interval: parsed.interval,
    cron: parsed.cron,
    humanReadable: parsed.humanReadable,
    prompt: promptText,
  };
}

function buildPrompt(args: string): string {
  const parsed = parseLoopInput(args);

  if (!parsed) {
    return USAGE_MESSAGE;
  }

  return `# /loop — schedule a recurring prompt

Parse the input below into \`[interval] <prompt…>\` and schedule it with ${CRON_CREATE_TOOL_NAME}.

## Parsing (in priority order)

1. **Leading token**: if the first whitespace-delimited token matches \`^\\d+[smhd]$\` (e.g. \`5m\`, \`2h\`), that's the interval; the rest is the prompt.
2. **Trailing "every" clause**: otherwise, if the input ends with \`every <N><unit>\` or \`every <N> <unit-word>\` (e.g. \`every 20m\`, \`every 5 minutes\`, \`every 2 hours\`), extract that as the interval and strip it from the prompt. Only match when what follows "every" is a time expression — \`check every PR\` has no interval.
3. **Default**: otherwise, interval is \`${DEFAULT_INTERVAL}\` and the entire input is the prompt.

## Interval → cron

| Interval pattern      | Cron expression     | Notes                                    |
|-----------------------|---------------------|------------------------------------------|
| \`Nm\` where N ≤ 59   | \`*/N * * * *\`     | every N minutes                          |
| \`Nm\` where N ≥ 60   | \`0 */H * * *\`     | round to hours (H = N/60, must divide 24)|
| \`Nh\` where N ≤ 23   | \`0 */N * * *\`     | every N hours                            |
| \`Nd\`                | \`0 0 */N * *\`     | every N days at midnight local           |
| \`Ns\`                | treat as \`ceil(N/60)m\` | cron minimum granularity is 1 minute  |

## Action

1. Call ${CRON_CREATE_TOOL_NAME} with:
   - \`cron\`: the expression from the table above
   - \`prompt\`: the parsed prompt from above, verbatim (slash commands are passed through unchanged)
   - \`recurring\`: \`true\`
2. Briefly confirm: what's scheduled, the cron expression, the human-readable cadence, that recurring tasks auto-expire after ${DEFAULT_MAX_AGE_DAYS} days, and that they can cancel sooner with ${CRON_DELETE_TOOL_NAME} (include the job ID).
3. **Then immediately execute the parsed prompt now** — don't wait for the first cron fire. If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.

## Input

${args}`;
}

export interface LoopSkill {
  name: string;
  description: string;
  argumentHint: string;
  userInvocable: boolean;
  whenToUse: string;
  getPromptForCommand(
    args: string,
    context: ToolUseContext
  ): Promise<{ type: string; text: string }[]>;
}

export class LoopSkill {
  private static readonly name = 'loop';
  private static readonly description =
    'Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo, defaults to 10m)';
  private static readonly argumentHint = '[interval] <prompt>';
  private static readonly userInvocable = true;
  private static readonly whenToUse =
    'When the user wants to set up a recurring task, poll for status, or run something repeatedly on an interval (e.g. "check the deploy every 5 minutes", "keep running /babysit-prs"). Do NOT invoke for one-off tasks.';

  static create(): LoopSkill {
    return {
      name: LoopSkill.name,
      description: LoopSkill.description,
      argumentHint: LoopSkill.argumentHint,
      userInvocable: LoopSkill.userInvocable,
      whenToUse: LoopSkill.whenToUse,
      getPromptForCommand: async (args: string, context: ToolUseContext) => {
        const trimmed = args.trim();
        if (!trimmed) {
          return [{ type: 'text', text: USAGE_MESSAGE }];
        }
        return [{ type: 'text', text: buildPrompt(trimmed) }];
      },
    };
  }

  static getName(): string {
    return LoopSkill.name;
  }

  static getDescription(): string {
    return LoopSkill.description;
  }

  static getArgumentHint(): string {
    return LoopSkill.argumentHint;
  }

  static getWhenToUse(): string {
    return LoopSkill.whenToUse;
  }
}

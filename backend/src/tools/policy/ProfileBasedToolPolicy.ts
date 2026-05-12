/**
 * 基于 Profile 的工具策略
 * 按 coding/messaging/minimal profile 过滤可用工具
 */

import type { Tool } from '../types/Tool';
import type { ToolPolicy, PolicyContext, PolicyResult } from './ToolPolicy';
import { allowResult, denyResult } from './ToolPolicy';
import { filterToolsByProfile, ToolClassifier } from './ToolCatalog';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export class ProfileBasedToolPolicy implements ToolPolicy {
  readonly name = 'ProfileBasedToolPolicy';
  private classifier: ToolClassifier;

  constructor(classifier?: ToolClassifier) {
    this.classifier = classifier ?? new ToolClassifier();
  }

  evaluate(tool: Tool, context: PolicyContext): PolicyResult {
    const profile = context.profile ?? 'coding';

    const filtered = filterToolsByProfile([tool], profile, this.classifier);

    if (filtered.length > 0) {
      return allowResult(this.name);
    }

    logger.debug(`Profile 策略拒绝工具: ${tool.name} (profile: ${profile})`);
    return denyResult(
      this.name,
      `Profile ${profile} 不允许使用工具 ${tool.name}`
    );
  }

  evaluateBatch(tools: Tool[], context: PolicyContext): PolicyResult[] {
    const profile = context.profile ?? 'coding';
    const allowedNames = new Set(
      filterToolsByProfile(tools, profile, this.classifier).map((t) =>
        t.name.toLowerCase()
      )
    );

    return tools.map((tool) => {
      if (allowedNames.has(tool.name.toLowerCase())) {
        return allowResult(this.name);
      }
      logger.debug(`Profile 策略拒绝工具: ${tool.name} (profile: ${profile})`);
      return denyResult(
        this.name,
        `Profile ${profile} 不允许使用工具 ${tool.name}`
      );
    });
  }
}

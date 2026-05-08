//
/**
 * 条件命令加载器
 * 根据feature开关决定是否加载命令
 */

import { feature, FeatureFlag } from '@modules/core';
import type { Command, CommandLoader } from '@modules/commands/types';

export interface FeatureCommandConfig {
  featureFlag: FeatureFlag;
  modulePath: string;
  fallbackPath?: string;
}

export class FeatureCommandLoader implements CommandLoader {
  private config: FeatureCommandConfig;

  constructor(config: FeatureCommandConfig) {
    this.config = config;
  }

  async loadCommands(): Promise<Command[]> {
    if (!feature(this.config.featureFlag)) {
      return [];
    }

    try {
      const module = await import(this.config.modulePath);
      if (module.default) {
        return [module.default];
      }
      return [];
    } catch (error) {
      console.error(
        `FeatureCommandLoader: Failed to load ${this.config.modulePath}:`,
        error
      );

      if (this.config.fallbackPath) {
        try {
          const fallbackModule = await import(this.config.fallbackPath);
          if (fallbackModule.default) {
            return [fallbackModule.default];
          }
        } catch (fallbackError) {
          console.error(
            `FeatureCommandLoader: Fallback ${this.config.fallbackPath} also failed:`,
            fallbackError
          );
        }
      }

      return [];
    }
  }

  getSource(): string {
    return `feature:${this.config.featureFlag}`;
  }

  static create(
    featureFlag: FeatureFlag,
    modulePath: string,
    fallbackPath?: string
  ): FeatureCommandLoader {
    return new FeatureCommandLoader({ featureFlag, modulePath, fallbackPath });
  }
}

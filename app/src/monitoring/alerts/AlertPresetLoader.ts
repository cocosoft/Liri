/**
 * 告警预置规则加载器
 * 从 presets 目录加载 JSON 预置规则文件，校验后注册到 AlertRuleService
 */

import fs from 'fs';
import path from 'path';
import {
  AlertPresetFile,
  AlertPresetRule,
  AlertPresetValidator,
  AlertPresetLoaderConfig,
} from './AlertSchema.js';
import { alertRuleService } from '../AlertRuleService.js';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { configManager } from '@modules/config';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'monitoring:alert_preset',
});

/**
 * 预置加载结果
 */
export interface AlertPresetLoadResult {
  totalFiles: number;
  loadedFiles: number;
  totalRules: number;
  loadedRules: number;
  failedFiles: string[];
  errors: string[];
}

/**
 * 默认预置加载器配置
 */
const DEFAULT_CONFIG: AlertPresetLoaderConfig = {
  presetsDir: '',
  enabled: true,
  validateBeforeLoad: true,
};

/**
 * 告警预置规则加载器
 */
export class AlertPresetLoader {
  private config: AlertPresetLoaderConfig;
  private loadedPresets: Set<string> = new Set();

  constructor(config?: Partial<AlertPresetLoaderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置预置目录
   */
  setPresetsDir(dir: string): void {
    this.config.presetsDir = dir;
  }

  /**
   * 加载所有预置规则
   */
  loadAllPresets(): AlertPresetLoadResult {
    const result: AlertPresetLoadResult = {
      totalFiles: 0,
      loadedFiles: 0,
      totalRules: 0,
      loadedRules: 0,
      failedFiles: [],
      errors: [],
    };

    if (!this.config.enabled) {
      logger.info('预置规则加载已禁用');
      return result;
    }

    const presetsDir = this.config.presetsDir;
    if (!presetsDir || !fs.existsSync(presetsDir)) {
      const projectRoot =
        configManager.env('LIRI_PROJECT_DIR') || process.cwd();
      const fallbackDir = path.join(
        projectRoot,
        'app',
        'src',
        'monitoring',
        'alerts',
        'presets'
      );
      if (fs.existsSync(fallbackDir)) {
        this.config.presetsDir = fallbackDir;
        logger.info(`预置目录已回退到: ${fallbackDir}`);
      } else {
        const altDir = path.join(projectRoot, 'alerts', 'presets');
        if (fs.existsSync(altDir)) {
          this.config.presetsDir = altDir;
          logger.info(`预置目录已回退到: ${altDir}`);
        } else {
          logger.warn(`预置目录不存在: ${presetsDir}`);
          return result;
        }
      }
    }

    const files = this.findPresetFiles(presetsDir);
    result.totalFiles = files.length;

    for (const filePath of files) {
      const fileResult = this.loadPresetFile(filePath);
      result.totalRules += fileResult.totalRules;
      result.loadedRules += fileResult.loadedRules;

      if (fileResult.success) {
        result.loadedFiles++;
      } else {
        result.failedFiles.push(filePath);
        result.errors.push(...fileResult.errors);
      }
    }

    logger.info(
      `预置规则加载完成: ${result.loadedFiles}/${result.totalFiles} 文件, ` +
        `${result.loadedRules}/${result.totalRules} 规则`
    );

    return result;
  }

  /**
   * 查找预置目录下的 JSON 文件
   */
  private findPresetFiles(dir: string): string[] {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith('.json') &&
            !this.loadedPresets.has(entry.name)
        )
        .map((entry) => path.join(dir, entry.name));
    } catch (error) {
      void handleError(error, {
        module: 'monitoring:alerts',
        action: 'scan_preset_files',
        context: { directory: dir },
      });
      return [];
    }
  }

  /**
   * 加载单个预置文件
   */
  private loadPresetFile(filePath: string): {
    success: boolean;
    totalRules: number;
    loadedRules: number;
    errors: string[];
  } {
    const result = {
      success: false,
      totalRules: 0,
      loadedRules: 0,
      errors: [] as string[],
    };

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as AlertPresetFile;

      result.totalRules = data.rules?.length || 0;

      if (this.config.validateBeforeLoad) {
        const validation = AlertPresetValidator.validate(data);
        if (!validation.valid) {
          result.errors.push(
            `校验失败 ${path.basename(filePath)}: ${validation.errors.join('; ')}`
          );
          return result;
        }
      }

      if (!data.rules || data.rules.length === 0) {
        result.errors.push(`文件 ${path.basename(filePath)} 没有规则`);
        return result;
      }

      const presetName =
        data.metadata?.name || path.basename(filePath, '.json');
      let loadedCount = 0;

      for (const rule of data.rules) {
        try {
          this.registerRule(rule);
          loadedCount++;
        } catch (error) {
          result.errors.push(
            `注册规则失败 ${rule.name}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      result.loadedRules = loadedCount;
      result.success = loadedCount > 0;
      this.loadedPresets.add(path.basename(filePath));
    } catch (error) {
      result.errors.push(
        `加载文件失败 ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return result;
  }

  /**
   * 注册预置规则到 AlertRuleService
   */
  private registerRule(rule: AlertPresetRule): void {
    alertRuleService.createRule({
      name: rule.name,
      description: rule.description,
      level: rule.level,
      conditions: rule.conditions.map((c) => ({
        type: c.type,
        metric: c.metric,
        operator: c.operator,
        value: c.value,
        window: c.window,
        count: c.count,
        expression: c.expression,
      })),
      conditionOperator: rule.conditionOperator,
      cooldown: rule.cooldown,
      enabled: rule.enabled,
      labels: rule.labels,
      annotations: rule.annotations,
    });
  }
}

/**
 * 创建默认预置加载器实例
 */
export function createAlertPresetLoader(
  presetsDir?: string
): AlertPresetLoader {
  const loader = new AlertPresetLoader();

  if (presetsDir) {
    loader.setPresetsDir(presetsDir);
  }

  return loader;
}

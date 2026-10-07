import * as fs from 'fs';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import {
  getUserSettingsPath,
  getProjectSettingsPath,
  getLocalSettingsPath,
} from '@modules/config';
import { PermissionRuleSource } from './types/PermissionRule';
import type { ToolPermissionContext } from './permissions';
import { getEmptyToolPermissionContext } from './permissions';

const logger = getLogger('permissionsLoader');

export function loadPermissionsFromSettings(
  settingsPath: string,
  source: PermissionRuleSource,
  context: ToolPermissionContext = getEmptyToolPermissionContext()
): ToolPermissionContext {
  try {
    if (!fs.existsSync(settingsPath)) {
      return context;
    }

    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);

    if (settings?.permissions) {
      const p = settings.permissions;

      if (p.allow && Array.isArray(p.allow)) {
        context.alwaysAllowRules[source] = [
          ...(context.alwaysAllowRules[source] || []),
          ...p.allow,
        ];
      }

      if (p.deny && Array.isArray(p.deny)) {
        context.alwaysDenyRules[source] = [
          ...(context.alwaysDenyRules[source] || []),
          ...p.deny,
        ];
      }

      if (p.ask && Array.isArray(p.ask)) {
        context.alwaysAskRules[source] = [
          ...(context.alwaysAskRules[source] || []),
          ...p.ask,
        ];
      }
    }

    if (
      settings?.additionalDirectories &&
      Array.isArray(settings.additionalDirectories)
    ) {
      context.additionalWorkingDirectories = [
        ...context.additionalWorkingDirectories,
        ...settings.additionalDirectories,
      ];
    }
  } catch (e) {
    // 设置文件读取失败时使用默认值，不影响系统启动
    void handleError(e, {
      module: 'permission:loader',
      action: '读取权限设置文件失败',
    });
  }

  return context;
}

export function loadAllPermissionSettings(cwd: string): ToolPermissionContext {
  let context = getEmptyToolPermissionContext();

  // 路径统一取自配置层的规范解析器（与 ConfigManager 的 settings 来源同源），
  // 禁止在此自行拼接 —— 曾因自建 `{dataDir}/settings/…` 与真实来源不一致而读不到规则。
  context = loadPermissionsFromSettings(
    getUserSettingsPath(),
    PermissionRuleSource.USER_SETTINGS,
    context
  );
  context = loadPermissionsFromSettings(
    getProjectSettingsPath(),
    PermissionRuleSource.PROJECT_SETTINGS,
    context
  );
  context = loadPermissionsFromSettings(
    getLocalSettingsPath(),
    PermissionRuleSource.LOCAL_SETTINGS,
    context
  );

  return context;
}

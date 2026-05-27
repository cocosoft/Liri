/**
 * 权限设置持久化加载（基于CC源码 utils/permissions/permissionsLoader.ts）
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PermissionRuleSource } from './PermissionRule';
import type { ToolPermissionContext } from './permissions';
import { getEmptyToolPermissionContext } from './permissions';

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
  }

  return context;
}

export function loadAllPermissionSettings(cwd: string): ToolPermissionContext {
  let context = getEmptyToolPermissionContext();

  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const userSettings = path.join(homeDir, '.py_app', 'settings.json');
  const projectSettings = path.join(cwd, '.py_app', 'settings.json');
  const localSettings = path.join(cwd, '.py_app', 'local_settings.json');

  context = loadPermissionsFromSettings(userSettings, 'userSettings', context);
  context = loadPermissionsFromSettings(
    projectSettings,
    'projectSettings',
    context
  );
  context = loadPermissionsFromSettings(
    localSettings,
    'localSettings',
    context
  );

  return context;
}

/**
 * 应用设置管理Hook
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { configManager, type GlobalConfig } from '@modules/config';

/**
 * 设置变更监听器
 */
type SettingsChangeListener = (key: string, value: unknown) => void;

const settingsChangeListeners = new Set<SettingsChangeListener>();

/**
 * 触发设置变更通知
 */
function notifySettingsChange(key: string, value: unknown): void {
  settingsChangeListeners.forEach((listener) => listener(key, value));
}

/**
 * useSettings Hook
 * @returns 设置管理对象
 */
export function useSettings() {
  const [settings, setSettings] = useState<GlobalConfig>(() =>
    configManager.getGlobalConfig()
  );

  // 监听配置变化
  useEffect(() => {
    const handleConfigChange: SettingsChangeListener = (key, value) => {
      setSettings((prev) => ({
        ...prev,
        [key]: value,
      }));
    };

    settingsChangeListeners.add(handleConfigChange);

    return () => {
      settingsChangeListeners.delete(handleConfigChange);
    };
  }, []);

  /**
   * 获取设置值
   * @param key 设置键
   * @returns 设置值
   */
  const get = useCallback(
    <T = unknown>(key: string): T | undefined => {
      return settings[key] as T;
    },
    [settings]
  );

  /**
   * 设置配置值
   * @param key 设置键
   * @param value 设置值
   */
  const set = useCallback(<T = unknown>(key: string, value: T): void => {
    configManager.setConfigValue(key, value);
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
    notifySettingsChange(key, value);
  }, []);

  /**
   * 批量更新设置
   * @param updates 设置更新对象
   */
  const update = useCallback((updates: Partial<GlobalConfig>): void => {
    configManager.saveGlobalConfig((prev) => ({
      ...prev,
      ...updates,
    }));
    setSettings((prev) => ({
      ...prev,
      ...updates,
    }));
    Object.entries(updates).forEach(([key, value]) => {
      notifySettingsChange(key, value);
    });
  }, []);

  /**
   * 重置设置为默认值
   */
  const reset = useCallback((): void => {
    configManager.resetConfig();
    setSettings(configManager.getGlobalConfig());
  }, []);

  /**
   * 重新加载设置
   */
  const reload = useCallback((): void => {
    configManager.reloadConfig();
    setSettings(configManager.getGlobalConfig());
  }, []);

  return useMemo(
    () => ({
      settings,
      get,
      set,
      update,
      reset,
      reload,
    }),
    [settings, get, set, update, reset, reload]
  );
}

/**
 * useSettings 的简化版本，获取单个设置值
 * @param key 设置键
 * @param defaultValue 默认值
 * @returns 设置值
 */
export function useSetting<T = unknown>(
  key: string,
  defaultValue?: T
): T | undefined {
  const { get } = useSettings();
  const value = get<T>(key);
  return value ?? defaultValue;
}

/**
 * 订阅设置变更（非Hook版本）
 * @param listener 变更监听器
 * @returns 取消订阅函数
 */
export function subscribeToSettingsChange(
  listener: SettingsChangeListener
): () => void {
  settingsChangeListeners.add(listener);
  return () => settingsChangeListeners.delete(listener);
}

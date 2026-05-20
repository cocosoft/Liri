import { useEffect, useRef } from 'react';

import { appStateStore } from '../../system/state/AppStateStore';

/**
 * 插件安装状态通知钩子
 * 监控插件安装状态，在出现安装失败时发出通知
 */
export function usePluginInstallationNotification(): void {
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = appStateStore.subscribe((state) => {
      const { plugins } = state;
      if (!plugins?.installationStatus) return;

      const failedPlugins = plugins.installationStatus.plugins.filter(
        (p) => p.status === 'failed'
      );
      const failedMarketplaces = plugins.installationStatus.marketplaces.filter(
        (m) => m.status === 'failed'
      );

      for (const plugin of failedPlugins) {
        if (notifiedRef.current.has(plugin.id)) continue;
        notifiedRef.current.add(plugin.id);

        appStateStore.addNotification({
          type: 'error',
          title: '插件安装失败',
          message: `${plugin.id}${plugin.version ? `@${plugin.version}` : ''}: ${plugin.error || '未知错误'}`,
          priority: 'medium',
        });
      }

      for (const marketplace of failedMarketplaces) {
        if (notifiedRef.current.has(marketplace.name)) continue;
        notifiedRef.current.add(marketplace.name);

        appStateStore.addNotification({
          type: 'error',
          title: '市场加载失败',
          message: `${marketplace.name}: ${marketplace.error || '未知错误'}`,
          priority: 'medium',
        });
      }
    });

    return unsubscribe;
  }, []);
}

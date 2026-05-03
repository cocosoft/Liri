// @ts-nocheck
/**
 * useApp Hook
 * 提供Ink应用的全局状态和生命周期管理
 */

import { useEffect, useRef } from 'react';
import { instances } from '../instances';

export interface UseAppOptions {
  /** 是否在应用挂载时注册实例 */
  registerOnMount?: boolean;
  /** 应用ID */
  appId?: string;
}

export interface UseAppReturn {
  /** 应用是否已激活 */
  isActive: boolean;
  /** 当前应用ID */
  appId: string | undefined;
  /** 激活当前应用 */
  activate: () => void;
  /** 注销当前应用 */
  deactivate: () => void;
  /** 获取所有已注册的应用 */
  getRegisteredApps: () => string[];
}

export function useApp(options: UseAppOptions = {}): UseAppReturn {
  const { registerOnMount = true, appId } = options;
  const instanceRef = useRef<string | null>(null);

  useEffect(() => {
    if (registerOnMount) {
      instanceRef.current = instances.register();
    }

    return () => {
      if (instanceRef.current) {
        instances.unregister(instanceRef.current);
      }
    };
  }, [registerOnMount]);

  const activate = () => {
    if (instanceRef.current) {
      instances.activate(instanceRef.current);
    }
  };

  const deactivate = () => {
    if (instanceRef.current) {
      instances.deactivate(instanceRef.current);
    }
  };

  const getRegisteredApps = () => {
    return instances.getIds();
  };

  return {
    isActive: instances.isActive(instanceRef.current || ''),
    appId: instanceRef.current || appId,
    activate,
    deactivate,
    getRegisteredApps,
  };
}

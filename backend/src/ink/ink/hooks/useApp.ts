/**
 * useApp Hook
 * 提供Ink应用的全局状态和生命周期管理
 */

import { useEffect, useRef, useState } from 'react';
import { registerInstance, unregisterInstance, getInstances, setActiveInstance, getInstanceById } from '../instances';
import type { InkInstance } from '../types';

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
  const instanceRef = useRef<InkInstance | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (registerOnMount) {
      const instance: InkInstance = {
        id: appId || `ink-instance-${Date.now()}`,
        isActive: true,
        cleanup: () => {},
      };
      registerInstance(instance);
      instanceRef.current = instance;
      setIsActive(true);
    }

    return () => {
      if (instanceRef.current) {
        unregisterInstance(instanceRef.current);
      }
    };
  }, [registerOnMount, appId]);

  const activate = () => {
    if (instanceRef.current) {
      setActiveInstance(instanceRef.current.id);
      setIsActive(true);
    }
  };

  const deactivate = () => {
    setIsActive(false);
  };

  const getRegisteredApps = () => {
    return getInstances().map((inst) => inst.id);
  };

  return {
    isActive,
    appId: instanceRef.current?.id || appId,
    activate,
    deactivate,
    getRegisteredApps,
  };
}

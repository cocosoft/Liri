//
/**
 * 按键绑定提供者设置
 * 用于将KeybindingProvider集成到应用中的设置工具
 * 
 * 这个文件提供绑定和一个组合的提供者，可以添加到应用的组件树中。
 * 它加载默认绑定和用户定义的绑定（来自 ~/.py_app/keybindings.json），
 * 并在文件变更时支持热重载。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { KeybindingContextName, ParsedBinding, ParsedKeystroke, KeybindingWarning } from './types.js';
import { KeybindingProvider, useHandlerRegistryRef, usePendingChordRef } from './KeybindingContext.js';
import { loadDefaultBindings } from './defaultBindings.js';
import { loadUserBindingsSync, subscribeToKeybindingChanges, initializeKeybindingWatcher } from './loadUserBindings.js';
import { createDefaultFeatureManager, createFeatureAwareKeybindingProvider } from './featureToggle.js';
import { loadPlatformAdaptedBindings } from './platformAdapter.js';

/**
 * 和弦序列的超时时间（毫秒）
 * 如果用户在这个时间内没有完成和弦，将被取消
 */
const CHORD_TIMEOUT_MS = 1000;

/**
 * 提供者属性
 */
interface Props {
  children: React.ReactNode;
}

/**
 * 带有默认+用户绑定和热重载支持的按键绑定提供者
 * 
 * 用法：用这个提供者包装你的应用以启用按键绑定支持
 * 
 * ```tsx
 * <AppStateProvider>
 *   <KeybindingSetup>
 *     <REPL ... />
 *   </KeybindingSetup>
 * </AppStateProvider>
 * ```
 * 
 * 特性：
 * - 从代码加载默认绑定
 * - 与用户绑定合并（来自 ~/.py_app/keybindings.json）
 * - 监听文件变更并自动重载（热重载）
 * - 用户绑定覆盖默认绑定（后出现的条目获胜）
 * - 支持和弦自动超时
 */
export function KeybindingProviderSetup({ children }: Props): React.JSX.Element {
  // 引用和状态管理
  const handlerRegistryRef = useHandlerRegistryRef();
  const pendingChordRef = usePendingChordRef();
  const chordTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // 状态
  const [bindings, setBindings] = useState<ParsedBinding[]>([]);
  const [pendingChord, setPendingChord] = useState<ParsedKeystroke[] | null>(null);
  const [activeContexts, setActiveContexts] = useState<Set<KeybindingContextName>>(new Set());
  const [warnings, setWarnings] = useState<KeybindingWarning[]>([]);
  
  // 特性管理器
  const [featureManager] = useState(() => createDefaultFeatureManager());

  /**
   * 注册活跃上下文
   */
  const registerActiveContext = useCallback((context: KeybindingContextName) => {
    setActiveContexts(prev => new Set([...prev, context]));
  }, []);

  /**
   * 注销活跃上下文
   */
  const unregisterActiveContext = useCallback((context: KeybindingContextName) => {
    setActiveContexts(prev => {
      const next = new Set(prev);
      next.delete(context);
      return next;
    });
  }, []);

  /**
   * 设置待处理和弦并启动超时
   */
  const setPendingChordWithTimeout = useCallback((pending: ParsedKeystroke[] | null) => {
    // 清除现有超时
    if (chordTimeoutRef.current) {
      clearTimeout(chordTimeoutRef.current);
      chordTimeoutRef.current = null;
    }

    // 更新引用和状态
    pendingChordRef.current = pending;
    setPendingChord(pending);

    // 如果设置了新的和弦，启动超时
    if (pending) {
      chordTimeoutRef.current = setTimeout(() => {
        pendingChordRef.current = null;
        setPendingChord(null);
        chordTimeoutRef.current = null;
      }, CHORD_TIMEOUT_MS);
    }
  }, [pendingChordRef]);

  /**
   * 加载绑定
   */
  const loadBindings = useCallback(() => {
    try {
      // 加载默认绑定
      const defaultBindings = loadDefaultBindings();
      
      // 加载用户绑定
      const userBindingsResult = loadUserBindingsSync();
      
      // 合并绑定（用户绑定覆盖默认绑定）
      let mergedBindings = [...defaultBindings, ...userBindingsResult.bindings];
      
      // 应用平台适配
      mergedBindings = loadPlatformAdaptedBindings(mergedBindings);
      
      // 应用特性开关过滤
      mergedBindings = createFeatureAwareKeybindingProvider(mergedBindings, featureManager);
      
      // 更新绑定和警告
      setBindings(mergedBindings);
      setWarnings(userBindingsResult.warnings);
      
      // 记录加载统计
      console.log(`按键绑定加载完成: ${mergedBindings.length} 个绑定`);
      
    } catch (error) {
      console.error('Failed to load keybindings:', error);
      // 回退到默认绑定
      const defaultBindings = loadDefaultBindings();
      setBindings(defaultBindings);
      setWarnings([{
        type: 'error',
        message: `Failed to load user keybindings: ${error instanceof Error ? error.message : String(error)}`
      }]);
    }
  }, [featureManager]);

  /**
   * 初始化按键绑定观察器
   */
  useEffect(() => {
    // 初始加载
    loadBindings();

    // 初始化按键绑定观察器
    initializeKeybindingWatcher();

    // 订阅绑定变更
    const unsubscribeFileChanges = subscribeToKeybindingChanges(loadBindings);

    // 订阅特性变更
    const unsubscribeFeatureChanges = featureManager.subscribe((featureName, enabled) => {
      console.log(`特性 ${featureName} ${enabled ? '启用' : '禁用'}，重新加载绑定...`);
      loadBindings();
    });

    // 清理函数
    return () => {
      unsubscribeFileChanges();
      unsubscribeFeatureChanges();
      if (chordTimeoutRef.current) {
        clearTimeout(chordTimeoutRef.current);
      }
    };
  }, [loadBindings, featureManager]);

  /**
   * 显示按键绑定警告
   */
  useEffect(() => {
    if (warnings.length > 0) {
      console.warn('Keybinding warnings:', warnings);
      // 在实际应用中，这里应该显示通知给用户
      // 例如：使用通知系统显示警告
    }
  }, [warnings]);

  // 如果没有绑定，返回空组件
  if (bindings.length === 0) {
    return <>{children}</>;
  }

  return (
    <KeybindingProvider
      bindings={bindings}
      pendingChordRef={pendingChordRef}
      pendingChord={pendingChord}
      setPendingChord={setPendingChordWithTimeout}
      activeContexts={activeContexts}
      registerActiveContext={registerActiveContext}
      unregisterActiveContext={unregisterActiveContext}
      handlerRegistryRef={handlerRegistryRef}
    >
      {children}
    </KeybindingProvider>
  );
}

/**
 * 简化的提供者组件别名
 */
export const KeybindingSetup = KeybindingProviderSetup;

/**
 * 使用按键绑定设置的Hook
 */
export function useKeybindingSetup() {
  return {
    // 这里可以添加一些设置相关的功能
  };
}
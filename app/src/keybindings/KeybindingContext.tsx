//
/**
 * 按键绑定上下文管理
 * 提供按键绑定系统的React上下文和API
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import React, { createContext, useContext, useRef } from 'react';
import type {
  KeybindingContextName,
  ParsedBinding,
  ParsedKeystroke,
  ChordResolveResult,
  HandlerRegistration,
} from './types.js';
import { resolveKeyWithChordState, getBindingDisplayText } from './resolver.js';

/**
 * 按键绑定上下文值
 */
export interface KeybindingContextValue {
  /** 解析按键输入为动作名称（支持和弦） */
  resolve: (
    input: string,
    key: string,
    activeContexts: KeybindingContextName[]
  ) => ChordResolveResult;

  /** 更新待处理的和弦状态 */
  setPendingChord: (pending: ParsedKeystroke[] | null) => void;

  /** 获取动作的显示文本（如 "ctrl+t"） */
  getDisplayText: (
    action: string,
    context: KeybindingContextName
  ) => string | undefined;

  /** 所有解析后的绑定（用于帮助显示） */
  bindings: ParsedBinding[];

  /** 当前待处理的和弦按键（null表示不在和弦中） */
  pendingChord: ParsedKeystroke[] | null;

  /** 当前活跃的按键绑定上下文（用于优先级解析） */
  activeContexts: Set<KeybindingContextName>;

  /** 注册上下文为活跃状态（在挂载时调用） */
  registerActiveContext: (context: KeybindingContextName) => void;

  /** 注销上下文（在卸载时调用） */
  unregisterActiveContext: (context: KeybindingContextName) => void;

  /** 为动作注册处理器（被useKeybinding使用） */
  registerHandler: (registration: HandlerRegistration) => () => void;

  /** 调用动作的所有处理器（被ChordInterceptor使用） */
  invokeAction: (action: string) => boolean;
}

/**
 * 提供者属性
 */
interface ProviderProps {
  /** 所有解析后的绑定 */
  bindings: ParsedBinding[];

  /** 用于立即访问待处理和弦的引用（避免React状态延迟） */
  pendingChordRef: React.RefObject<ParsedKeystroke[] | null>;

  /** 用于重新渲染的状态值（UI更新） */
  pendingChord: ParsedKeystroke[] | null;

  /** 设置待处理和弦状态 */
  setPendingChord: (pending: ParsedKeystroke[] | null) => void;

  /** 当前活跃的上下文 */
  activeContexts: Set<KeybindingContextName>;

  /** 注册活跃上下文 */
  registerActiveContext: (context: KeybindingContextName) => void;

  /** 注销活跃上下文 */
  unregisterActiveContext: (context: KeybindingContextName) => void;

  /** 处理器注册表的引用（被ChordInterceptor使用） */
  handlerRegistryRef: React.RefObject<Map<string, Set<HandlerRegistration>>>;

  /** 子组件 */
  children: React.ReactNode;
}

/**
 * 创建按键绑定上下文
 */
const KeybindingContext = createContext<KeybindingContextValue | null>(null);

/**
 * 按键绑定提供者组件
 */
export function KeybindingProvider({
  bindings,
  pendingChordRef,
  pendingChord,
  setPendingChord,
  activeContexts,
  registerActiveContext,
  unregisterActiveContext,
  handlerRegistryRef,
  children,
}: ProviderProps): React.JSX.Element {
  /**
   * 解析按键输入
   */
  const resolve = (
    input: string,
    key: string,
    activeContexts: KeybindingContextName[]
  ): ChordResolveResult => {
    return resolveKeyWithChordState(
      input,
      key,
      activeContexts,
      bindings,
      pendingChordRef.current
    );
  };

  /**
   * 获取显示文本
   */
  const getDisplayText = (
    action: string,
    context: KeybindingContextName
  ): string | undefined => {
    return getBindingDisplayText(action, context, bindings);
  };

  /**
   * 注册处理器
   */
  const registerHandler = (registration: HandlerRegistration): (() => void) => {
    const registry = handlerRegistryRef.current;
    if (!registry) {
      return () => {}; // 空函数
    }

    // 确保动作的处理器集合存在
    if (!registry.has(registration.action)) {
      registry.set(registration.action, new Set());
    }

    // 添加处理器
    registry.get(registration.action)!.add(registration);

    // 返回注销函数
    return () => {
      const handlers = registry.get(registration.action);
      if (handlers) {
        handlers.delete(registration);
        if (handlers.size === 0) {
          registry.delete(registration.action);
        }
      }
    };
  };

  /**
   * 调用动作
   */
  const invokeAction = (action: string): boolean => {
    const registry = handlerRegistryRef.current;
    if (!registry) {
      return false;
    }

    const handlers = registry.get(action);
    if (!handlers || handlers.size === 0) {
      return false;
    }

    // 在活跃上下文中查找并调用处理器
    for (const registration of handlers) {
      if (activeContexts.has(registration.context)) {
        registration.handler();
        return true;
      }
    }

    return false;
  };

  /**
   * 构建上下文值
   */
  const contextValue: KeybindingContextValue = {
    resolve,
    setPendingChord,
    getDisplayText,
    bindings,
    pendingChord,
    activeContexts,
    registerActiveContext,
    unregisterActiveContext,
    registerHandler,
    invokeAction,
  };

  return (
    <KeybindingContext.Provider value={contextValue}>
      {children}
    </KeybindingContext.Provider>
  );
}

/**
 * 使用按键绑定上下文的Hook
 * 必须在KeybindingProvider内部使用
 */
export function useKeybindingContext(): KeybindingContextValue {
  const ctx = useContext(KeybindingContext);
  if (!ctx) {
    throw new AppError(
      ErrorCodes.INTERNAL.message,
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      'CONTEXT_NOT_AVAILABLE',
      { hook: 'useKeybindingContext', provider: 'KeybindingProvider' }
    );
  }
  return ctx;
}

/**
 * 可选的使用按键绑定上下文的Hook
 * 在提供者不可用时返回undefined
 * 用于可能在提供者可用之前渲染的组件
 */
export function useOptionalKeybindingContext():
  | KeybindingContextValue
  | undefined {
  const ctx = useContext(KeybindingContext);
  return ctx ?? undefined;
}

/**
 * 创建处理器注册表引用
 */
export function useHandlerRegistryRef(): React.RefObject<
  Map<string, Set<HandlerRegistration>>
> {
  return useRef<Map<string, Set<HandlerRegistration>>>(new Map());
}

/**
 * 创建和弦状态引用
 */
export function usePendingChordRef(): React.RefObject<
  ParsedKeystroke[] | null
> {
  return useRef<ParsedKeystroke[] | null>(null);
}

/**
 * 和弦拦截器
 * 全局和弦键拦截器，在所有子组件之前注册useInput
 *
 * 这个组件在所有其他处理器之前拦截按键，确保和弦序列能够正确
 * 处理而不被其他组件拦截。这是和弦支持的关键组件。
 */
import React, { useEffect } from 'react';
import { useKeybindingContext } from './KeybindingContext.js';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 和弦拦截器组件
 *
 * 这个组件应该放在应用组件树的最顶层，确保在所有其他
 * 按键处理器之前处理按键事件。
 */
export function ChordInterceptor(): null {
  const keybindingContext = useKeybindingContext();

  useEffect(() => {
    /**
     * 全局按键事件监听器
     */
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (!keybindingContext) {
        return;
      }

      try {
        // 构建按键输入信息
        const input = event.key;
        const key = {
          name: event.key,
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          meta: event.metaKey,
        };

        // 解析按键输入
        const activeContexts = Array.from(keybindingContext.activeContexts);
        const result = keybindingContext.resolve(
          input,
          key.name,
          activeContexts
        );

        if (result.action) {
          // 找到匹配的动作，调用处理器
          const handled = keybindingContext.invokeAction(result.action);
          if (handled) {
            // 动作已处理，阻止事件传播
            event.preventDefault();
            event.stopPropagation();
          }
        }

        // 更新和弦状态
        if (result.pendingChord !== keybindingContext.pendingChord) {
          keybindingContext.setPendingChord(result.pendingChord);
        }

        // 如果正在处理和弦序列，阻止事件传播
        if (result.pendingChord) {
          event.preventDefault();
          event.stopPropagation();
        }
      } catch (error) {
        logger.error('Error in chord interceptor:', { error });
      }
    };

    // 注册全局事件监听器
    document.addEventListener('keydown', handleGlobalKeyDown, {
      capture: true,
    });

    // 清理函数
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown, {
        capture: true,
      });
    };
  }, [keybindingContext]);

  // 这个组件不渲染任何内容
  return null;
}

/**
 * 简化的和弦拦截器Hook
 *
 * 用于函数组件中快速启用和弦拦截
 */
export function useChordInterceptor(): void {
  const keybindingContext = useKeybindingContext();

  useEffect(() => {
    if (!keybindingContext) {
      return;
    }

    /**
     * 和弦超时处理
     */
    const handleChordTimeout = () => {
      if (keybindingContext.pendingChord) {
        // 和弦超时，重置状态
        keybindingContext.setPendingChord(null);

        // 可以在这里添加超时反馈
        // 例如：显示提示信息或声音反馈
      }
    };

    // 设置和弦超时检查
    const timeoutCheck = setInterval(handleChordTimeout, 1000);

    // 清理函数
    return () => {
      clearInterval(timeoutCheck);
    };
  }, [keybindingContext]);
}

/**
 * 和弦状态指示器组件
 *
 * 显示当前和弦状态，用于调试和用户反馈
 */
export function ChordStatusIndicator(): React.JSX.Element | null {
  const keybindingContext = useKeybindingContext();

  if (!keybindingContext.pendingChord) {
    return null;
  }

  const chordText = keybindingContext.pendingChord
    .map((keystroke) => {
      const parts = [];
      if (keystroke.ctrl) parts.push('Ctrl');
      if (keystroke.alt) parts.push('Alt');
      if (keystroke.shift) parts.push('Shift');
      if (keystroke.meta) parts.push('Meta');
      parts.push(keystroke.key.toUpperCase());
      return parts.join('+');
    })
    .join(' → ');

  return (
    <div
      style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        background: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '5px 10px',
        borderRadius: '4px',
        fontSize: '12px',
        zIndex: 1000,
      }}
    >
      🎹 和弦: {chordText}
    </div>
  );
}

/**
 * 和弦拦截器提供者
 *
 * 包装应用并提供和弦拦截功能
 */
export function ChordInterceptorProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <ChordInterceptor />
      <ChordStatusIndicator />
      {children}
    </>
  );
}

/**
 * 检查和弦序列是否有效
 */
export function isValidChordSequence(sequence: string[]): boolean {
  if (sequence.length === 0) {
    return false;
  }

  // 检查每个按键是否有效
  for (const keystroke of sequence) {
    if (!keystroke.trim()) {
      return false;
    }

    // 这里可以添加更复杂的验证逻辑
    // 例如：检查是否为保留快捷键等
  }

  return true;
}

/**
 * 获取和弦序列的显示名称
 */
export function getChordDisplayName(sequence: string[]): string {
  return sequence
    .map((keystroke) => {
      // 将按键格式化为可读形式
      return keystroke
        .split('+')
        .map((part) => {
          switch (part.toLowerCase()) {
            case 'ctrl':
              return 'Ctrl';
            case 'alt':
              return 'Alt';
            case 'shift':
              return 'Shift';
            case 'meta':
              return 'Meta';
            case 'cmd':
              return 'Cmd';
            case 'command':
              return 'Cmd';
            case 'escape':
              return 'Esc';
            case 'enter':
              return 'Enter';
            case 'tab':
              return 'Tab';
            case 'space':
              return 'Space';
            case 'backspace':
              return 'Backspace';
            case 'delete':
              return 'Delete';
            case 'up':
              return '↑';
            case 'down':
              return '↓';
            case 'left':
              return '←';
            case 'right':
              return '→';
            default:
              return part.toUpperCase();
          }
        })
        .join('+');
    })
    .join(' ');
}

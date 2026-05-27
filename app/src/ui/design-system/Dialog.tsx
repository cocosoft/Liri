//
/**
 * 对话框组件
 * 提供模态对话框功能，支持标题、内容、操作按钮等
 */

import React from 'react';
import { Box, Text } from '@modules/ink';
import { DialogProps, UITheme } from '../types/UITypes';
import { useTheme } from './ThemeProvider';
import { KeyboardShortcutHint } from './KeyboardShortcutHint';
import { Byline } from './Byline';
import { Pane } from './Pane';

/**
 * 对话框组件
 */
export function Dialog({
  title,
  subtitle,
  children,
  onCancel,
  onConfirm,
  color = 'primary',
  hideInputGuide = false,
  hideBorder = false,
  isCancelActive = true,
  confirmText = '确认',
  cancelText = '取消',
}: DialogProps) {
  const { theme } = useTheme();

  /**
   * 处理键盘事件
   */
  const handleKeyPress = (event: any) => {
    if (!isCancelActive) return;

    if (event.key === 'escape' || event.key === 'n') {
      onCancel();
    } else if (event.key === 'enter' && onConfirm) {
      onConfirm();
    }
  };

  /**
   * 渲染输入指南
   */
  const renderInputGuide = () => {
    if (hideInputGuide) return null;

    const shortcuts = [
      { keys: ['Esc', 'n'], description: cancelText },
      ...(onConfirm ? [{ keys: ['Enter'], description: confirmText }] : []),
    ];

    return (
      <Byline color={color}>
        {shortcuts.map((shortcut, index) => (
          <KeyboardShortcutHint
            key={index}
            keys={shortcut.keys}
            description={shortcut.description}
            color={color}
          />
        ))}
      </Byline>
    );
  };

  return (
    <Box
      flexDirection="column"
      onKeyPress={handleKeyPress}
      focusable={isCancelActive}
    >
      {/* 对话框标题区域 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={theme.colors[color]}>
          {title}
        </Text>
        {subtitle && <Text color={theme.colors.textSecondary}>{subtitle}</Text>}
      </Box>

      {/* 对话框内容区域 */}
      <Pane color={color} hideBorder={hideBorder}>
        {children}
      </Pane>

      {/* 输入指南区域 */}
      {renderInputGuide()}
    </Box>
  );
}

/**
 * 确认对话框组件
 */
export function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = '确认',
  cancelText = '取消',
  color = 'primary',
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  color?: keyof UITheme['colors'];
}) {
  return (
    <Dialog
      title={title}
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmText={confirmText}
      cancelText={cancelText}
      color={color}
    >
      <Text>{message}</Text>
    </Dialog>
  );
}

/**
 * 警告对话框组件
 */
export function AlertDialog({
  title,
  message,
  onClose,
  color = 'warning',
}: {
  title: string;
  message: string;
  onClose: () => void;
  color?: keyof UITheme['colors'];
}) {
  return (
    <Dialog title={title} onCancel={onClose} color={color} confirmText="确定">
      <Text>{message}</Text>
    </Dialog>
  );
}

/**
 * 错误对话框组件
 */
export function ErrorDialog({
  title,
  message,
  onClose,
  color = 'error',
}: {
  title: string;
  message: string;
  onClose: () => void;
  color?: keyof UITheme['colors'];
}) {
  return (
    <Dialog title={title} onCancel={onClose} color={color} confirmText="确定">
      <Text>{message}</Text>
    </Dialog>
  );
}

export default Dialog;

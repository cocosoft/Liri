/**
 * Ink对话框组件
 * 用于在终端中显示模态对话框
 */

import React from 'react';
import { Box, Text } from './Box';

export interface DialogProps {
  /** 是否显示对话框 */
  isOpen: boolean;
  /** 对话框标题 */
  title?: string;
  /** 对话框内容 */
  children: React.ReactNode;
  /** 确认按钮文本 */
  confirmText?: string;
  /** 取消按钮文本 */
  cancelText?: string;
  /** 是否显示取消按钮 */
  showCancel?: boolean;
  /** 确认回调 */
  onConfirm?: () => void;
  /** 取消回调 */
  onCancel?: () => void;
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  title,
  children,
  confirmText = 'OK',
  cancelText = 'Cancel',
  showCancel = true,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const handleKeyDown = (key: string) => {
    if (key === 'enter') {
      onConfirm?.();
    } else if (key === 'escape') {
      onCancel?.();
    }
  };

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      onKeyDown={handleKeyDown}
    >
      <Box
        borderStyle="single"
        paddingX={2}
        paddingY={1}
        backgroundColor="gray"
        width="max-content"
      >
        {title && (
          <Box paddingY={1} borderBottomStyle="single">
            <Text bold color="white">{title}</Text>
          </Box>
        )}
        <Box paddingY={2} paddingX={4}>
          {children}
        </Box>
        <Box
          flexDirection="row"
          justifyContent="flex-end"
          gap={2}
          paddingY={1}
          borderTopStyle="single"
        >
          {showCancel && (
            <Box
              borderStyle="single"
              paddingX={2}
              paddingY={0.5}
              onClick={onCancel}
              onKeyDown={(key) => key === 'enter' && onCancel?.()}
            >
              <Text>{cancelText}</Text>
            </Box>
          )}
          <Box
            borderStyle="single"
            paddingX={2}
            paddingY={0.5}
            backgroundColor="blue"
            onClick={onConfirm}
            onKeyDown={(key) => key === 'enter' && onConfirm?.()}
          >
            <Text color="white">{confirmText}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

/**
 * 创建对话框组件
 */
export function createDialog(props: DialogProps): React.ReactElement {
  return <Dialog {...props} />;
}

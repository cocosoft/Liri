//
/**
 * Ink模态框组件
 * 用于在终端中显示模态窗口
 */

import React from 'react';
import Box from './Box';
import Text from './Text';

export interface ModalProps {
  /** 是否显示模态框 */
  isOpen: boolean;
  /** 模态框标题 */
  title?: string;
  /** 模态框内容 */
  children: React.ReactNode;
  /** 是否可关闭 */
  isClosable?: boolean;
  /** 关闭回调 */
  onClose?: () => void;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  title,
  children,
  isClosable = true,
  onClose,
}) => {
  if (!isOpen) return null;

  const handleKeyDown = (key: string) => {
    if (key === 'escape' && isClosable) {
      onClose?.();
    }
  };

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      backgroundColor="black"
      onKeyDown={handleKeyDown}
    >
      <Box
        borderStyle="single"
        paddingX={2}
        paddingY={1}
        backgroundColor="gray"
        width="max-content"
        marginTop={-1}
      >
        <Box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
        >
          {title && (
            <Text bold color="white">
              {title}
            </Text>
          )}
          {isClosable && (
            <Box
              onClick={onClose}
              onKeyDown={(key: string) => key === 'enter' && onClose?.()}
            >
              <Text color="white">×</Text>
            </Box>
          )}
        </Box>
        <Box paddingY={2} paddingX={4}>
          {children}
        </Box>
      </Box>
    </Box>
  );
};

/**
 * 创建模态框组件
 */
export function createModal(props: ModalProps): React.ReactElement {
  return <Modal {...props} />;
}

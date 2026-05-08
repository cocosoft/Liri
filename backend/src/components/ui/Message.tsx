//
/**
 * Message组件 - 消息提示
 */

import React, { useState, useEffect } from 'react';
import { Text, Box } from '../ink.js';

type MessageType = 'info' | 'success' | 'warning' | 'error';

export interface MessageProps {
  type?: MessageType;
  content: string;
  duration?: number;
  onClose?: () => void;
}

const MESSAGE_CONFIG: Record<MessageType, { icon: string; color: string }> = {
  info: { icon: 'ℹ', color: 'cyan' },
  success: { icon: '✓', color: 'green' },
  warning: { icon: '⚠', color: 'yellow' },
  error: { icon: '✗', color: 'red' },
};

export function Message({
  type = 'info',
  content,
  duration = 3000,
  onClose,
}: MessageProps): React.ReactNode {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        onClose?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  if (!visible) return null;

  const config = MESSAGE_CONFIG[type];

  return (
    <Box>
      <Text color={config.color}>{config.icon} </Text>
      <Text>{content}</Text>
    </Box>
  );
}

export interface MessageInstance {
  info: (content: string, duration?: number) => void;
  success: (content: string, duration?: number) => void;
  warning: (content: string, duration?: number) => void;
  error: (content: string, duration?: number) => void;
}

let messageQueue: Array<{ type: MessageType; content: string; duration: number }> = [];

export function createMessage(): MessageInstance {
  const show = (type: MessageType, content: string, duration = 3000) => {
    messageQueue.push({ type, content, duration });
  };

  return {
    info: (content, duration) => show('info', content, duration),
    success: (content, duration) => show('success', content, duration),
    warning: (content, duration) => show('warning', content, duration),
    error: (content, duration) => show('error', content, duration),
  };
}

export const message = createMessage();

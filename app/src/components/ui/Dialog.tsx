/**
 * Dialog组件 - 确认/提示对话框
 */

import React from 'react';
import { Text, Box } from '../ink.js';

export type DialogType = 'confirm' | 'prompt' | 'alert' | 'custom';

export interface DialogAction {
  label: string;
  value: string;
  color?: string;
  key?: string;
}

export interface DialogProps {
  type?: DialogType;
  title: string;
  message: string;
  visible: boolean;
  actions?: DialogAction[];
  onSelect?: (value: string) => void;
  width?: number;
  borderColor?: string;
}

const DEFAULT_ACTIONS: Record<DialogType, DialogAction[]> = {
  confirm: [
    { label: 'Yes', value: 'yes', color: 'green', key: 'y' },
    { label: 'No', value: 'no', color: 'red', key: 'n' },
  ],
  alert: [
    { label: 'OK', value: 'ok', color: 'cyan', key: 'enter' },
  ],
  prompt: [
    { label: 'Confirm', value: 'confirm', color: 'green', key: 'enter' },
    { label: 'Cancel', value: 'cancel', color: 'red', key: 'esc' },
  ],
  custom: [],
};

function getDialogIcon(type: DialogType): string {
  switch (type) {
    case 'confirm':
      return '?';
    case 'alert':
      return '!';
    case 'prompt':
      return '>';
    default:
      return ' ';
  }
}

function getDialogColor(type: DialogType): string {
  switch (type) {
    case 'confirm':
      return 'yellow';
    case 'alert':
      return 'cyan';
    case 'prompt':
      return 'green';
    default:
      return 'white';
  }
}

export function Dialog({
  type = 'confirm',
  title,
  message,
  visible,
  actions,
  onSelect,
  width = 60,
  borderColor,
}: DialogProps): React.ReactNode {
  if (!visible) return null;

  const displayActions = actions || DEFAULT_ACTIONS[type];
  const color = borderColor || getDialogColor(type);
  const icon = getDialogIcon(type);

  const border = '─'.repeat(width);
  const padding = 2;

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{' '.repeat(padding)}</Text>
        <Text color={color}>┌{border}┐</Text>
      </Box>
      <Box>
        <Text dimColor>{' '.repeat(padding)}</Text>
        <Text color={color}>
          │{' '.repeat(width)}│
        </Text>
      </Box>
      <Box>
        <Text dimColor>{' '.repeat(padding)}</Text>
        <Text color="white">
          │  <Text color={color} bold>[{icon}]</Text> <Text bold>{title}</Text>
          {' '.repeat(Math.max(0, width - title.length - 8))}│
        </Text>
      </Box>
      <Box>
        <Text dimColor>{' '.repeat(padding)}</Text>
        <Text color={color}>
          │{' '.repeat(width)}│
        </Text>
      </Box>
      <Box>
        <Text dimColor>{' '.repeat(padding)}</Text>
        <Text color={color}>│  </Text>
        <Text>{message}</Text>
        <Text color={color}>
          {' '.repeat(Math.max(0, width - message.length - 2))}│
        </Text>
      </Box>
      <Box>
        <Text dimColor>{' '.repeat(padding)}</Text>
        <Text color={color}>
          │{' '.repeat(width)}│
        </Text>
      </Box>
      <Box>
        <Text dimColor>{' '.repeat(padding)}</Text>
        <Text color={color}>├{border}┤</Text>
      </Box>
      <Box>
        <Text dimColor>{' '.repeat(padding)}</Text>
        <Text color={color}>│  </Text>
        {displayActions.map((action, i) => (
          <Text key={action.value}>
            {i > 0 && <Text>  </Text>}
            <Text color={action.color || 'white'} bold>
              [{action.key || action.label[0]}]{' '}
            </Text>
            <Text>{action.label}</Text>
          </Text>
        ))}
        <Text color={color}>
          {' '.repeat(Math.max(0, width - displayActions.reduce((acc, a) => acc + a.label.length + 6, 0)))}│
        </Text>
      </Box>
      <Box>
        <Text dimColor>{' '.repeat(padding)}</Text>
        <Text color={color}>└{border}┘</Text>
      </Box>
    </Box>
  );
}

export type ConfirmDialogProps = Omit<DialogProps, 'type'>;
export type AlertDialogProps = Omit<DialogProps, 'type'>;

export function ConfirmDialog(props: ConfirmDialogProps): React.ReactNode {
  return <Dialog type="confirm" {...props} />;
}

export function AlertDialog(props: AlertDialogProps): React.ReactNode {
  return <Dialog type="alert" {...props} />;
}

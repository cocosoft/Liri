//
/**
 * UI组件导出文件
 */

export * from './MessageBubble';
export * from './Messages';
export * from './Input';
export * from './Button';
export * from './Tabs';

export { MessageBubble } from './MessageBubble';
export { Messages, createMessages } from './Messages';
export { Input } from './Input';
export { Button } from './Button';
export { Tabs } from './Tabs';

export type { MessageBubbleProps } from './MessageBubble';
export type { Message, MessagesProps } from './Messages';
export type {
  InputProps,
  ButtonProps,
  TabsProps,
  TabItem,
} from '../types/UITypes';

// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * UI组件模块
 */

export { Spinner, LoadingSpinner } from './Spinner.js';
export { ProgressBar } from './ProgressBar.js';
export { LoadingDots } from './LoadingDots.js';
export { Badge } from './Badge.js';
export { Divider } from './Divider.js';
export { Confirm, Select } from './Interactive.js';
export { BorderBox } from './renderBorder.js';
export {
  highlightText,
  searchHighlightLines,
  findSearchMatches,
} from './searchHighlight.js';
export {
  CodeBlock,
  DiffBlock,
  TableBlock,
  StatsBar,
  MarkdownRenderer,
} from './markdown.js';
export { ThinkingBlock, RedactedThinkingBlock } from './ThinkingBlock.js';
export {
  registerToolUI,
  getToolUI,
  hasToolUI,
  getRegisteredToolNames,
  initDefaultToolUIRegistry,
  type ToolUIRenderer,
} from './ToolUIRegistry.js';

export { Table, type TableColumn, type TableProps } from './Table.js';
export { Tree, type TreeNode, type TreeProps } from './Tree.js';
export { Tabs, type TabItem, type TabsProps } from './Tabs.js';
export { Modal, type ModalProps } from './Modal.js';
export { Dropdown, type DropdownItem, type DropdownProps } from './Dropdown.js';
export {
  Checkbox,
  CheckboxGroup,
  type CheckboxProps,
  type CheckboxGroupProps,
} from './Checkbox.js';
export { Radio, type RadioItem, type RadioProps } from './Radio.js';
export { Slider, type SliderProps } from './Slider.js';
export { Switch, type SwitchProps } from './Switch.js';
export { Tag, TagGroup, type TagProps, type TagGroupProps } from './Tag.js';
export { Avatar, type AvatarProps } from './Avatar.js';
export { Tooltip, type TooltipProps } from './Tooltip.js';
export { Alert, type AlertProps } from './Alert.js';
export {
  Message,
  message,
  createMessage,
  type MessageProps,
  type MessageInstance,
} from './Message.js';
export {
  Notification,
  notification,
  createNotification,
  type NotificationProps,
  type NotificationItem,
} from './Notification.js';
export {
  ChatMessage,
  createChatMessage,
  type ChatMessageProps,
  type MessageSender,
  type ToolCallInfo,
  type ToolResultInfo,
} from './ChatMessage.js';
export {
  ChatMessages,
  createChatMessages,
  type ChatMessagesProps,
  type ChatMessageData,
} from './ChatMessages.js';
export {
  TagTabs,
  FilterableTagTabs,
  type TagTabItem,
  type TagTabsProps,
  type FilterableTagTabsProps,
} from './TagTabs.js';
export {
  Stats,
  TokenStats,
  createStats,
  type StatsItem,
  type StatsProps,
  type TokenStatsProps,
} from './Stats.js';
export { ExitFlow, createExitFlow, type ExitFlowProps } from './ExitFlow.js';
export {
  Dialog,
  ConfirmDialog,
  AlertDialog,
  type DialogProps,
  type DialogAction,
  type DialogType,
  type ConfirmDialogProps,
  type AlertDialogProps,
} from './Dialog.js';
export {
  Wizard,
  type WizardProps,
  type WizardStep,
} from './Wizard.js';
export {
  Card,
  type CardProps,
} from './Card.js';
export {
  EmptyState,
  type EmptyStateProps,
  type EmptyStateVariant,
} from './EmptyState.js';
export {
  Steps,
  type StepsProps,
  type Step,
  type StepStatus,
} from './Steps.js';
export {
  Accordion,
  type AccordionProps,
  type AccordionItem,
} from './Accordion.js';

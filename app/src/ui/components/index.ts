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

export { SettingsPanel, createSettingsPanel } from './SettingsPanel';
export type { SettingsPanelProps } from './SettingsPanel';

export { AppearanceSettings } from './settings/AppearanceSettings';
export { AISettings } from './settings/AISettings';
export { AgentSettings } from './settings/AgentSettings';
export { FeatureSettings } from './settings/FeatureSettings';
export { ChannelSettings } from './settings/ChannelSettings';
export { CompanionSettings } from './settings/CompanionSettings';
export { NotificationSettings } from './settings/NotificationSettings';
export { SystemSettings } from './settings/SystemSettings';
export { SettingRow } from './settings/SettingRow';

export type { MessageBubbleProps } from './MessageBubble';
export type { Message, MessagesProps } from './Messages';
export type {
  InputProps,
  ButtonProps,
  TabsProps,
  TabItem,
} from '../types/UITypes';

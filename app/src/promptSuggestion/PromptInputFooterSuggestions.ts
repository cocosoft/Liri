/**
 * PromptInputFooterSuggestions 建议显示组件
 * 基于CC源码设计
 */

import type { SuggestionItem, SuggestionType } from './types';

export const OVERLAY_MAX_ITEMS = 5;

function getIcon(itemId: string): string {
  if (itemId.startsWith('file-')) return '+';
  if (itemId.startsWith('mcp-resource-')) return '◇';
  if (itemId.startsWith('agent-')) return '*';
  if (itemId.startsWith('command-')) return '/';
  return '+';
}

function isUnifiedSuggestion(itemId: string): boolean {
  return (
    itemId.startsWith('file-') ||
    itemId.startsWith('mcp-resource-') ||
    itemId.startsWith('agent-') ||
    itemId.startsWith('command-')
  );
}

function truncateMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const ellipsis = '...';
  const charsToShow = maxLength - ellipsis.length;
  const frontChars = Math.ceil(charsToShow / 2);
  const backChars = Math.floor(charsToShow / 2);
  return (
    text.substring(0, frontChars) +
    ellipsis +
    text.substring(text.length - backChars)
  );
}

interface SuggestionItemRowProps {
  item: SuggestionItem;
  maxColumnWidth: number;
  isSelected: boolean;
  columns: number;
}

export function SuggestionItemRow({
  item,
  maxColumnWidth,
  isSelected,
  columns,
}: SuggestionItemRowProps): string {
  const isUnified = isUnifiedSuggestion(item.id);
  if (!isUnified) {
    return item.displayText;
  }

  const icon = getIcon(item.id);
  const textColor = isSelected ? 'suggestion' : undefined;
  const dimColor = !isSelected;
  const isFile = item.id.startsWith('file-');

  const separatorWidth = item.description ? 3 : 0;
  const maxPathLength = columns - 2 - 4 - separatorWidth - maxColumnWidth;
  const displayText = truncateMiddle(item.displayText, maxPathLength);

  let result = `${icon} ${displayText}`;
  if (item.description) {
    result += ` - ${item.description}`;
  }

  return result;
}

interface PromptInputFooterSuggestionsProps {
  items: SuggestionItem[];
  selectedIndex: number;
  columns: number;
  visible: boolean;
}

export function renderSuggestions({
  items,
  selectedIndex,
  columns,
  visible,
}: PromptInputFooterSuggestionsProps): string[] {
  if (!visible || items.length === 0) {
    return [];
  }

  const maxColumnWidth = Math.min(
    ...items.map((item) => (item.description ? item.description.length : 0))
  );
  const displayItems = items.slice(0, OVERLAY_MAX_ITEMS);

  return displayItems.map((item, index) => {
    return SuggestionItemRow({
      item,
      maxColumnWidth,
      isSelected: index === selectedIndex,
      columns,
    });
  });
}

export function getSuggestionType(itemId: string): SuggestionType {
  if (itemId.startsWith('file-')) return 'file';
  if (itemId.startsWith('mcp-resource-')) return 'directory';
  if (itemId.startsWith('agent-')) return 'agent';
  if (itemId.startsWith('command-')) return 'command';
  return 'none';
}

export function isSelectableSuggestion(itemId: string): boolean {
  return itemId !== 'none';
}

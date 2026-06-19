/**
 * DOM 类型定义 — 从 dom.ts 中提取，避免模块间循环依赖。
 *
 * 仅包含类型定义，不引用任何可能形成循环依赖的模块。
 * 本文件中的类型引用 FocusManager 时使用占位接口，
 * 实际类型在 dom.ts 中通过类型合并（intersection）补全。
 */

export interface FocusManagerLike {}

export type TextName = '#text';
export type ElementNames =
  | 'ink-root'
  | 'ink-box'
  | 'ink-text'
  | 'ink-virtual-text'
  | 'ink-link'
  | 'ink-progress'
  | 'ink-raw-ansi';

export type NodeNames = ElementNames | TextName;

export type DOMNodeAttribute = boolean | string | number;

export type DOMElement = {
  nodeName: ElementNames;
  attributes: Record<string, DOMNodeAttribute>;
  childNodes: DOMNode[];
  textStyles?: import('./styles.js').TextStyles;

  // Internal properties
  onComputeLayout?: () => void;
  onRender?: () => void;
  onImmediateRender?: () => void;
  hasRenderedContent?: boolean;

  dirty: boolean;
  isHidden?: boolean;
  _eventHandlers?: Record<string, unknown>;

  scrollTop?: number;
  pendingScrollDelta?: number;
  scrollClampMin?: number;
  scrollClampMax?: number;
  scrollHeight?: number;
  scrollViewportHeight?: number;
  scrollViewportTop?: number;
  stickyScroll?: boolean;
  scrollAnchor?: { el: DOMElement; offset: number };

  parentNode: DOMElement | undefined;

  focusManager?: FocusManagerLike;

  debugOwnerChain?: string[];
};

export type TextNode = {
  nodeName: TextName;
  nodeValue: string;
  parentNode: DOMElement | undefined;
};

export type DOMNode<T = { nodeName: NodeNames }> = T extends {
  nodeName: infer U;
}
  ? U extends '#text'
    ? TextNode
    : DOMElement
  : never;

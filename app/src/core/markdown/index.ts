export type {
  MarkdownStyle,
  MarkdownStyleSpan,
  MarkdownLinkSpan,
  MarkdownIR,
  MarkdownTableData,
  MarkdownTableMeta,
} from './types.js';

export type {
  RenderStyleMarker,
  RenderStyleMap,
  RenderLink,
  RenderOptions,
} from './render.js';
export { renderMarkdownWithMarkers } from './render.js';

export type {
  RenderedMarkdownChunk,
  RenderMarkdownIRChunksWithinLimitOptions,
} from './chunk.js';
export { renderMarkdownIRChunksWithinLimit } from './chunk.js';

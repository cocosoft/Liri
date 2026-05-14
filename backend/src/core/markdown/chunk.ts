import type { MarkdownIR } from "./types.js";

export type RenderedMarkdownChunk<TRendered> = {
  rendered: TRendered;
  source: MarkdownIR;
};

export type RenderMarkdownIRChunksWithinLimitOptions<TRendered> = {
  ir: MarkdownIR;
  limit: number;
  measureRendered: (rendered: TRendered) => number;
  renderChunk: (ir: MarkdownIR) => TRendered;
};

function sliceMarkdownIR(ir: MarkdownIR, start: number, end: number): MarkdownIR {
  const sliceText = ir.text.slice(start, end);

  const sliceStyles = ir.styles
    .filter((s) => s.start < end && s.end > start)
    .map((s) => ({
      start: Math.max(0, s.start - start),
      end: Math.min(sliceText.length, s.end - start),
      style: s.style,
    }))
    .filter((s) => s.start < s.end);

  const sliceLinks = ir.links
    .filter((l) => l.start < end && l.end > start)
    .map((l) => ({
      start: Math.max(0, l.start - start),
      end: Math.min(sliceText.length, l.end - start),
      href: l.href,
    }))
    .filter((l) => l.start < l.end);

  return { text: sliceText, styles: sliceStyles, links: sliceLinks };
}

function chunkMarkdownIR(
  ir: MarkdownIR,
  limit: number,
): MarkdownIR[] {
  const text = ir.text;
  if (!text || text.length === 0) {
    return [];
  }
  if (text.length <= limit) {
    return [ir];
  }

  const chunks: MarkdownIR[] = [];
  let offset = 0;

  while (offset < text.length) {
    const end = Math.min(offset + limit, text.length);
    let breakAt = end;

    const newlineIdx = text.lastIndexOf("\n", end - 1);
    if (newlineIdx > offset) {
      breakAt = newlineIdx + 1;
    } else {
      const spaceIdx = text.lastIndexOf(" ", end - 1);
      if (spaceIdx > offset) {
        breakAt = spaceIdx + 1;
      }
    }

    chunks.push(sliceMarkdownIR(ir, offset, breakAt));
    offset = breakAt;
  }

  return chunks;
}

function coalesceWhitespaceOnlyMarkdownIRChunks<TRendered>(
  chunks: MarkdownIR[],
  limit: number,
  options: {
    measureRendered: (rendered: TRendered) => number;
    renderChunk: (ir: MarkdownIR) => TRendered;
  },
): MarkdownIR[] {
  if (chunks.length <= 1) {
    return chunks;
  }

  const result: MarkdownIR[] = [chunks[0]];
  for (let i = 1; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk.text || chunk.text.trim().length === 0) {
      const last = result[result.length - 1];
      if (last) {
        const merged = sliceMarkdownIR(
          {
            text: last.text + chunk.text,
            styles: [...last.styles, ...chunk.styles],
            links: [...last.links, ...chunk.links],
          },
          0,
          last.text.length + chunk.text.length,
        );
        const mergedRendered = options.renderChunk(merged);
        if (options.measureRendered(mergedRendered) <= limit) {
          result[result.length - 1] = merged;
          continue;
        }
      }
    }
    result.push(chunk);
  }

  return result;
}

export function renderMarkdownIRChunksWithinLimit<TRendered>(
  options: RenderMarkdownIRChunksWithinLimitOptions<TRendered>,
): RenderedMarkdownChunk<TRendered>[] {
  if (!options.ir.text) {
    return [];
  }

  const normalizedLimit = Math.max(1, Math.floor(options.limit));
  const pending = chunkMarkdownIR(options.ir, normalizedLimit);
  const finalized: MarkdownIR[] = [];

  while (pending.length > 0) {
    const chunk = pending.shift();
    if (!chunk) {
      continue;
    }

    const rendered = options.renderChunk(chunk);
    if (
      options.measureRendered(rendered) <= normalizedLimit ||
      chunk.text.length <= 1
    ) {
      finalized.push(chunk);
      continue;
    }

    const mid = Math.floor(chunk.text.length / 2);
    const left = sliceMarkdownIR(chunk, 0, mid);
    const right = sliceMarkdownIR(chunk, mid, chunk.text.length);

    if (left.text.length > 0) {
      pending.unshift(right);
      pending.unshift(left);
    } else {
      finalized.push(chunk);
    }
  }

  return coalesceWhitespaceOnlyMarkdownIRChunks(
    finalized,
    normalizedLimit,
    options,
  ).map((source) => ({
    source,
    rendered: options.renderChunk(source),
  }));
}

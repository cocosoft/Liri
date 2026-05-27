export function getGraphemeSegmenter(): Intl.Segmenter {
  return new Intl.Segmenter(undefined, { granularity: 'grapheme' });
}

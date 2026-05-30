import { describe, it, expect } from 'bun:test';
import { getGraphemeSegmenter } from '../../src/utils/intl.js';

describe('getGraphemeSegmenter', () => {

  it('should return an object with a segment method', () => {
    const segmenter = getGraphemeSegmenter();
    expect(segmenter).toBeDefined();
    expect(typeof segmenter.segment).toBe('function');
  });

  it('should segment ASCII text character by character', () => {
    const segmenter = getGraphemeSegmenter();
    const result = segmenter.segment('abc');
    expect(result).toHaveLength(3);
    expect(result[0].segment).toBe('a');
    expect(result[1].segment).toBe('b');
    expect(result[2].segment).toBe('c');
  });

  it('should handle empty string', () => {
    const segmenter = getGraphemeSegmenter();
    const result = segmenter.segment('');
    expect(result).toHaveLength(0);
  });

  it('should handle Unicode characters', () => {
    const segmenter = getGraphemeSegmenter();
    const result = segmenter.segment('你好');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toBe('你');
    expect(result[1].segment).toBe('好');
  });

  it('should handle emoji characters by UTF-16 code units', () => {
    const segmenter = getGraphemeSegmenter();
    const result = segmenter.segment('a😀b');
    expect(result).toHaveLength(4);
    expect(result[0].segment).toBe('a');
    expect(result[3].segment).toBe('b');
  });

});

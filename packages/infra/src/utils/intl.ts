/**
 * 国际化工具
 */

/**
 * 获取 grapheme 分割器
 * @returns grapheme 分割器实例
 */
export function getGraphemeSegmenter() {
  // 简单实现，返回一个具有segment方法的对象
  return {
    segment: (text: string) => {
      const segments = [];
      for (let i = 0; i < text.length; i++) {
        segments.push({ segment: text[i] });
      }
      return segments;
    },
  };
}

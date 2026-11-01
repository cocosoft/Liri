/**
 * 生成彩虹颜色
 * @param index 索引值
 * @returns 彩虹颜色的字符串表示
 */
export function getRainbowColor(index: number): string {
  const colors = [
    '#ff0000', // 红色
    '#ff7f00', // 橙色
    '#ffff00', // 黄色
    '#00ff00', // 绿色
    '#0000ff', // 蓝色
    '#4b0082', // 靛色
    '#9400d3', // 紫色
  ];
  return colors[index % colors.length];
}

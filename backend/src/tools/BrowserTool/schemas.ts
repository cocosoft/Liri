import { z } from 'zod';

/**
 * BrowserTool 输入模式
 */
export const BrowserToolInputSchema = z.strictObject({
  action: z
    .enum([
      'open_tab',
      'click',
      'fill_form',
      'navigate',
      'screenshot',
      'get_tabs',
    ])
    .describe(
      '浏览器操作类型：open_tab 打开标签页，click 点击元素，fill_form 填写表单，navigate 导航，screenshot 截图，get_tabs 获取标签页列表'
    ),
  url: z
    .string()
    .optional()
    .describe('URL 地址（open_tab 和 navigate 操作必需）'),
  tab_id: z.string().optional().describe('标签页 ID'),
  selector: z
    .string()
    .optional()
    .describe('CSS 选择器（click 和 fill_form 操作必需）'),
  form_data: z
    .record(z.string())
    .optional()
    .describe('表单数据（fill_form 操作使用）'),
  text: z.string().optional().describe('操作文本（fill_form 操作使用）'),
});

/**
 * BrowserTool 输出模式
 */
export const BrowserToolOutputSchema = z.object({
  success: z.boolean().describe('操作是否成功'),
  message: z.string().describe('操作结果消息'),
  data: z.any().optional().describe('操作数据'),
  tabs: z.array(z.any()).optional().describe('标签页信息列表'),
  screenshot: z.string().optional().describe('截图数据（Base64 编码）'),
});

export type BrowserToolInput = z.infer<typeof BrowserToolInputSchema>;
export type BrowserToolOutput = z.infer<typeof BrowserToolOutputSchema>;

/**
 * 验证 BrowserTool 输入
 */
export function validateBrowserToolInput(input: unknown) {
  const result = BrowserToolInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `BrowserTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  const { action, url, selector } = result.data;
  if ((action === 'open_tab' || action === 'navigate') && !url) {
    return {
      success: false as const,
      error: `BrowserTool 输入验证失败: ${action} 操作需要提供 url 参数`,
    };
  }
  if ((action === 'click' || action === 'fill_form') && !selector) {
    return {
      success: false as const,
      error: `BrowserTool 输入验证失败: ${action} 操作需要提供 selector 参数`,
    };
  }
  return { success: true as const, data: result.data };
}

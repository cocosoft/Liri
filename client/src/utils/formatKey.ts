/**
 * 参数键名中文映射表
 *
 * 将英文/下划线命名的参数键转换为中文显示标签。
 * 用于 ToolCallBlock 参数展示。
 */

const KEY_LABEL_MAP: Record<string, string> = {
  url: "链接",
  query: "查询词",
  maxResults: "最大结果数",
  maxContentLength: "最大内容长度",
  timeout: "超时时间",
  retries: "重试次数",
  category: "分类",
  keywords: "关键词",
  date: "日期",
  startDate: "开始日期",
  endDate: "结束日期",
  limit: "限制数量",
  offset: "偏移量",
  page: "页码",
  pageSize: "每页数量",
  sortBy: "排序方式",
  filter: "过滤器",
  type: "类型",
  name: "名称",
  description: "描述",
  enabled: "启用",
  disabled: "禁用",
  async: "异步",
  recursive: "递归",
  verbose: "详细模式",
  force: "强制执行",
  dryRun: "试运行",
  output: "输出",
  input: "输入",
  path: "路径",
  file: "文件",
  directory: "目录",
  filename: "文件名",
  extension: "扩展名",
  mode: "模式",
  format: "格式",
  encoding: "编码",
  language: "语言",
  locale: "地区",
  timezone: "时区",
  currency: "货币",
  amount: "数量",
  price: "价格",
  title: "标题",
  content: "内容",
  body: "正文",
  message: "消息",
  text: "文本",
  html: "HTML内容",
  markdown: "Markdown内容",
  schema: "结构定义",
  options: "选项",
  params: "参数",
  args: "参数",
  arguments: "参数",
  callback: "回调函数",
  handler: "处理器",
  fn: "函数",
  endpoint: "接口地址",
  headers: "请求头",
  bodyType: "body类型",
  status: "状态",
  statusCode: "状态码",
  code: "代码",
  error: "错误",
  data: "数据",
  result: "结果",
  success: "成功",
  failure: "失败",
  count: "数量",
  total: "总计",
  hasMore: "还有更多",
  nextPage: "下一页",
  prevPage: "上一页",
  id: "ID",
  ids: "ID列表",
  uuid: "UUID",
  token: "令牌",
  secret: "密钥",
  key: "键",
  value: "值",
  env: "环境变量",
  version: "版本",
  tag: "标签",
  tags: "标签列表",
  author: "作者",
  createdAt: "创建时间",
  updatedAt: "更新时间",
  deletedAt: "删除时间",
  expiresAt: "过期时间",
  retryCount: "重试次数",
  attempt: "尝试次数",
};

/**
 * 将下划线/驼峰命名的参数键转换为中文显示标签
 */
export function formatKey(key: string): string {
  if (KEY_LABEL_MAP[key]) {
    return KEY_LABEL_MAP[key];
  }

  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}
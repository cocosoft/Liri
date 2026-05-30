import { http } from './httpClient';

export interface HelpArticle {
  id: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
  lastUpdated: string;
}

export interface HelpCategory {
  id: string;
  name: string;
  icon: string;
  articleCount: number;
}

export interface HelpService {
  getCategories(): Promise<HelpCategory[]>;
  getArticles(category?: string): Promise<HelpArticle[]>;
  searchArticles(query: string): Promise<HelpArticle[]>;
  getArticle(id: string): Promise<HelpArticle>;
}

export const helpService: HelpService = {
  async getCategories(): Promise<HelpCategory[]> {
    return http.get<HelpCategory[]>('/api/help/categories');
  },

  async getArticles(category?: string): Promise<HelpArticle[]> {
    return http.get<HelpArticle[]>('/api/help/articles', {
      params: category ? { category } : undefined,
    });
  },

  async searchArticles(query: string): Promise<HelpArticle[]> {
    return http.get<HelpArticle[]>('/api/help/search', {
      params: { q: query },
    });
  },

  async getArticle(id: string): Promise<HelpArticle> {
    return http.get<HelpArticle>(`/api/help/articles/${id}`);
  },
};

export const mockCategories: HelpCategory[] = [
  { id: 'getting-started', name: '入门指南', icon: '🚀', articleCount: 5 },
  { id: 'features', name: '功能介绍', icon: '✨', articleCount: 12 },
  { id: 'troubleshooting', name: '故障排除', icon: '🔧', articleCount: 8 },
  { id: 'api', name: 'API文档', icon: '📡', articleCount: 6 },
  { id: 'faq', name: '常见问题', icon: '❓', articleCount: 10 },
];

export const mockArticles: HelpArticle[] = [
  {
    id: '1',
    title: '快速开始',
    category: 'getting-started',
    content: `# 快速开始

欢迎使用 Liri！本指南将帮助您快速上手。

## 第一步：登录

1. 打开应用并点击登录按钮
2. 输入您的用户名和密码
3. 点击"登录"完成认证

## 第二步：配置AI

在"设置"页面中配置您的AI提供商和API密钥。

## 第三步：开始对话

现在您可以开始与AI对话了！`,
    tags: ['入门', '新手', '快速'],
    lastUpdated: '2024-05-28',
  },
  {
    id: '2',
    title: '如何管理记忆',
    category: 'features',
    content: `# 记忆管理

Liri 提供了强大的记忆管理功能。

## 查看记忆

访问"记忆"页面查看所有记忆条目。

## 搜索记忆

使用搜索框快速找到相关记忆。

## 调整权重

通过权重滑块调整记忆的重要性。`,
    tags: ['记忆', '管理', 'AI'],
    lastUpdated: '2024-05-27',
  },
  {
    id: '3',
    title: '连接失败怎么办',
    category: 'troubleshooting',
    content: `# 连接失败排查

如果您遇到连接问题，请尝试以下步骤：

1. 检查网络连接
2. 确认API密钥正确
3. 查看系统状态
4. 重启应用

如仍无法解决，请联系技术支持。`,
    tags: ['故障', '连接', '网络'],
    lastUpdated: '2024-05-26',
  },
];
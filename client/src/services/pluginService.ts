import { http } from './httpClient';

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  status: 'enabled' | 'disabled' | 'installing' | 'error';
  category: string;
  lastUpdated: string;
}

export interface PluginService {
  getPlugins(): Promise<Plugin[]>;
  enablePlugin(id: string): Promise<void>;
  disablePlugin(id: string): Promise<void>;
  installPlugin(id: string): Promise<void>;
  uninstallPlugin(id: string): Promise<void>;
}

export const pluginService: PluginService = {
  async getPlugins(): Promise<Plugin[]> {
    return http.get<Plugin[]>('/api/plugins');
  },

  async enablePlugin(id: string): Promise<void> {
    await http.post(`/api/plugins/${id}/enable`);
  },

  async disablePlugin(id: string): Promise<void> {
    await http.post(`/api/plugins/${id}/disable`);
  },

  async installPlugin(id: string): Promise<void> {
    await http.post(`/api/plugins/${id}/install`);
  },

  async uninstallPlugin(id: string): Promise<void> {
    await http.delete(`/api/plugins/${id}`);
  },
};

export const mockPlugins: Plugin[] = [
  { id: '1', name: 'Web Search', description: '网页搜索插件', version: '1.0.0', author: 'PY_APP', status: 'enabled', category: '搜索', lastUpdated: '2024-05-28' },
  { id: '2', name: 'File Reader', description: '文件读取插件', version: '1.1.0', author: 'PY_APP', status: 'enabled', category: '工具', lastUpdated: '2024-05-27' },
  { id: '3', name: 'Code Interpreter', description: '代码解释器', version: '2.0.0', author: 'PY_APP', status: 'disabled', category: '开发', lastUpdated: '2024-05-26' },
  { id: '4', name: 'Weather', description: '天气查询插件', version: '1.0.5', author: 'Third Party', status: 'enabled', category: '生活', lastUpdated: '2024-05-25' },
  { id: '5', name: 'Calculator', description: '计算器插件', version: '1.2.0', author: 'PY_APP', status: 'enabled', category: '工具', lastUpdated: '2024-05-24' },
  { id: '6', name: 'News', description: '新闻资讯插件', version: '1.0.0', author: 'Third Party', status: 'disabled', category: '资讯', lastUpdated: '2024-05-23' },
];
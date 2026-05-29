import { http } from './httpClient';

export interface CostRecord {
  id: string;
  date: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  currency: string;
}

export interface CostSummary {
  todayCost: number;
  weeklyCost: number;
  monthlyCost: number;
  yearlyCost: number;
  todayTokens: number;
  monthlyTokens: number;
  topProviders: { provider: string; cost: number; percentage: number }[];
  dailyBreakdown: { date: string; cost: number; tokens: number }[];
}

export interface CostService {
  getCostSummary(): Promise<CostSummary>;
  getCostRecords(page: number, limit: number): Promise<{ records: CostRecord[]; total: number }>;
  getCostByDateRange(startDate: string, endDate: string): Promise<CostRecord[]>;
}

export const costService: CostService = {
  async getCostSummary(): Promise<CostSummary> {
    return http.get<CostSummary>('/api/cost/summary');
  },

  async getCostRecords(page: number, limit: number): Promise<{ records: CostRecord[]; total: number }> {
    return http.get<{ records: CostRecord[]; total: number }>('/api/cost/records', {
      params: { page, limit },
    });
  },

  async getCostByDateRange(startDate: string, endDate: string): Promise<CostRecord[]> {
    return http.get<CostRecord[]>('/api/cost/range', {
      params: { startDate, endDate },
    });
  },
};

export const mockCostSummary: CostSummary = {
  todayCost: 23.56,
  weeklyCost: 156.89,
  monthlyCost: 689.45,
  yearlyCost: 8234.12,
  todayTokens: 456789,
  monthlyTokens: 12345678,
  topProviders: [
    { provider: 'OpenAI', cost: 345.23, percentage: 50 },
    { provider: 'Anthropic', cost: 198.76, percentage: 29 },
    { provider: 'DeepSeek', cost: 89.45, percentage: 13 },
    { provider: 'Other', cost: 56.01, percentage: 8 },
  ],
  dailyBreakdown: [
    { date: '05-22', cost: 21.34, tokens: 389000 },
    { date: '05-23', cost: 24.56, tokens: 456000 },
    { date: '05-24', cost: 18.90, tokens: 345000 },
    { date: '05-25', cost: 27.89, tokens: 512000 },
    { date: '05-26', cost: 22.12, tokens: 401000 },
    { date: '05-27', cost: 20.45, tokens: 378000 },
    { date: '05-28', cost: 23.56, tokens: 456789 },
  ],
};

export const mockCostRecords: CostRecord[] = [
  { id: '1', date: '2024-05-28 14:30:00', provider: 'OpenAI', model: 'gpt-4o', promptTokens: 1234, completionTokens: 5678, totalTokens: 6912, cost: 0.0234, currency: 'USD' },
  { id: '2', date: '2024-05-28 14:25:00', provider: 'Anthropic', model: 'claude-3-sonnet', promptTokens: 2345, completionTokens: 6789, totalTokens: 9134, cost: 0.0189, currency: 'USD' },
  { id: '3', date: '2024-05-28 14:20:00', provider: 'OpenAI', model: 'gpt-4o-mini', promptTokens: 567, completionTokens: 1234, totalTokens: 1801, cost: 0.0023, currency: 'USD' },
  { id: '4', date: '2024-05-28 14:15:00', provider: 'DeepSeek', model: 'deepseek-chat', promptTokens: 3456, completionTokens: 8901, totalTokens: 12357, cost: 0.0089, currency: 'USD' },
  { id: '5', date: '2024-05-28 14:10:00', provider: 'OpenAI', model: 'gpt-4o', promptTokens: 4567, completionTokens: 9012, totalTokens: 13579, cost: 0.0456, currency: 'USD' },
];

export interface SettingsJson {
  theme?: string;
  language?: string;
  fontSize?: number;
  apiKey?: string;
  model?: string;
  [key: string]: unknown;
}

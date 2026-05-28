// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
export interface RemoteSetting {
  key: string;
  value: unknown;
  category: 'model' | 'security' | 'ui' | 'tools' | 'general';
  required: boolean;
  overridable: boolean;
  description?: string;
}

export interface RemoteSettingsPayload {
  settings: RemoteSetting[];
  version: number;
  timestamp: number;
}

export interface RemoteSettingsClientConfig {
  apiUrl: string;
  apiKey?: string;
  pollInterval: number;
  timeout: number;
  cacheTTL: number;
  enabled: boolean;
}

export const DEFAULT_REMOTE_SETTINGS_CONFIG: RemoteSettingsClientConfig = {
  apiUrl: process.env.REMOTE_SETTINGS_API_URL || '',
  apiKey: process.env.REMOTE_SETTINGS_API_KEY,
  pollInterval: parseInt(
    process.env.REMOTE_SETTINGS_POLL_INTERVAL || '300000',
    10
  ),
  timeout: 10000,
  cacheTTL: 600_000,
  enabled:
    process.env.REMOTE_SETTINGS_ENABLED === 'true' ||
    !!process.env.REMOTE_SETTINGS_API_URL,
};

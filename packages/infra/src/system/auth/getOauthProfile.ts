/**
 * OAuth Profile获取
 * 使用 Node.js 内置 https/http 模块实现
 */

import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import type { OAuthConfig, OAuthProfileResponse } from './oauth-types.js';

function httpGetJson(
  url: string,
  headers: Record<string, string> = {},
  timeout: number = 10000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const requester = isHttps ? httpsRequest : httpRequest;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers,
      timeout,
    };

    const req = requester(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(
            new Error(`HTTP ${res.statusCode}: ${res.statusMessage || data}`)
          );
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

export async function getOauthProfileFromOauthToken(
  config: OAuthConfig,
  accessToken: string
): Promise<OAuthProfileResponse> {
  const response = await httpGetJson(
    config.profileUrl,
    { Authorization: `Bearer ${accessToken}` },
    10000
  );
  return response as OAuthProfileResponse;
}

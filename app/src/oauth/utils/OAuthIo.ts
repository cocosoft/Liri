// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * OAuth 公共 IO 工具
 *
 * OAuthCliHelper.ts 和 OAuthRemoteAdapter.ts 均引用此模块，避免 readLineFromStdin 重复定义。
 */

import { createInterface } from 'readline';

/**
 * 从 stdin 读取一行输入
 */
export function readLineFromStdin(prompt: string = '> '): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    rl.question(prompt, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

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

/**
 * MCP Server 入口 —— 通过 stdio 运行。
 * 委托到 entrypoints/mcp.ts 的生产级实现。
 *
 * 用法（在 .mcp.json 中配置）:
 *   {
 *     "mcpServers": {
 *       "pyapp": {
 *         "command": "bun",
 *         "args": ["run", "app/src/mcp/server/entrypoint.ts"]
 *       }
 *     }
 *   }
 */
import { startMCPServer } from '../../entrypoints/mcp.js';

const cwd = process.cwd();

startMCPServer(cwd).catch((error: unknown) => {
  // eslint-disable-next-line no-console -- MCP server entrypoint, Logger may not be initialized yet
  console.error('MCP Server failed to start:', error);
  process.exit(1);
});

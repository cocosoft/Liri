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
 * 工具命令目录索引
 */

// 文件工具命令
export { default as write } from './file/write.js';
export { default as edit } from './file/edit.js';
export { default as glob } from './file/glob.js';

// 系统工具命令
export { default as bash } from './system/bash.js';
export { default as grep } from './system/grep.js';

// AI工具命令
export { default as agent } from './ai/agent.js';
export { default as agents } from './ai/agents.js';

// 网络工具命令
export { default as fetch } from './network/fetch.js';
export { default as websearch } from './network/websearch.js';

// 任务管理命令
export { todoCommand as todo } from './task/todo.js';
export { taskCommand as task } from './task/task.js';

// 开发工具命令
export { default as lsp } from './dev/lsp.js';
export { default as notebook } from './dev/notebook.js';

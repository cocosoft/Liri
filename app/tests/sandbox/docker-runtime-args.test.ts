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
 * D5 隔离档骨架：容器运行时参数构造
 *
 * 说明：本机无 docker/runsc（实测均不可用），故只验证**参数构造**这一可确定部分；
 * "新档跑通集成测试 / 逃逸用例被阻断"需真实 Docker + gVisor 环境，尚未验证。
 */

import { describe, expect, it } from 'bun:test';
import {
  buildDockerRuntimeArgs,
  DOCKER_CONFIG_KEYS,
} from '../../src/sandbox/docker/DockerSandbox';

describe('buildDockerRuntimeArgs（D5 gVisor 隔离档骨架）', () => {
  it('未配置 runtime → 不产生额外参数（默认 runc，现有行为不变）', () => {
    expect(buildDockerRuntimeArgs({})).toEqual([]);
  });

  it('配置 runsc → 产生 --runtime runsc（gVisor 隔离档）', () => {
    expect(
      buildDockerRuntimeArgs({ [DOCKER_CONFIG_KEYS.RUNTIME]: 'runsc' })
    ).toEqual(['--runtime', 'runsc']);
  });

  it('显式空串 → 回退默认（runc），不产生参数', () => {
    expect(
      buildDockerRuntimeArgs({ [DOCKER_CONFIG_KEYS.RUNTIME]: '' })
    ).toEqual([]);
  });

  it('其它 runtime（如 kata）同样透传', () => {
    expect(
      buildDockerRuntimeArgs({ [DOCKER_CONFIG_KEYS.RUNTIME]: 'kata-runtime' })
    ).toEqual(['--runtime', 'kata-runtime']);
  });
});

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
 * Permission Module
 * 权限系统增强模块，统一导出
 */

export {
  PermissionContextBuilder,
  type PermissionContext,
  type UserIdentity,
  type ActionIntent,
  type ResourceIdentifier,
  type EnvironmentalContext,
  type PermissionDecision,
  type PermissionConstraint,
  type DecisionRecord,
} from './PermissionContext.js';

export {
  PermissionAuditLogger,
  globalAuditLogger,
  type AuditLogEntry,
  type AuditEventType,
  type AuditQuery,
} from './logging/PermissionAuditLogger.js';

export {
  InteractiveHandler,
  type InteractiveRequest,
  type InteractiveResponse,
  type InteractiveHandlerOptions,
} from './handler/InteractiveHandler.js';

export {
  CoordinatorHandler,
  type CoordinatedDecision,
  type WeightedDecision,
  type DecisionSource,
  type CoordinatorHandlerOptions,
} from './handler/CoordinatorHandler.js';

export {
  SwarmWorkerHandler,
  type SwarmWorkerIdentity,
  type SwarmPermissionContext,
} from './handler/SwarmWorkerHandler.js';

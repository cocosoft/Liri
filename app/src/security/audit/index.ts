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
 * 安全审计模块导出
 */

export type {
  AuditSeverity,
  AuditCategory,
  SecurityAuditFinding,
  SecurityAuditSummary,
  DeepAuditResults,
  SecurityAuditReport,
  SecurityAuditOptions,
  SecurityAuditContext,
} from './AuditTypes';

export {
  AuditEngine,
  runSecurityAudit,
  createDefaultAuditContext,
} from './AuditEngine';
export { auditConfig } from './AuditConfig';
export { auditPlugins } from './AuditPlugins';
export { auditModelHygiene } from './AuditModelHygiene';
export { auditFilesystem } from './AuditFilesystem';
export { auditContextVisibility } from './ContextVisibility';
export {
  buildAuditReport,
  buildAuditSummary,
  formatAuditReport,
} from './AuditReport';
export { AuditTrailQuery, getAuditTrail } from './AuditTrailQuery';
export type {
  AuditTrailFilter,
  AuditTrailResult,
  AuditTrailResponse,
} from './AuditTrailQuery';
export {
  generateDeliveryAuditReport,
  printAuditReport,
} from './DeliveryAuditReport';
export type {
  AuditDimension,
  DeliveryAuditReport,
} from './DeliveryAuditReport';

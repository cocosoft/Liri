declare module 'bidi-js' {
  const bidiFactory: () => {
    resolveEmbeddingLevels(text: string): {
      paragraphs: Array<{ level: number }>;
      explicitEmbeddingLevels: number[];
      resolvedLevels: number[];
    };
    getReorderSegments(
      levels: number[],
      line: { start: number; end: number }
    ): Array<{ start: number; end: number; level: number }>;
  };
  export default bidiFactory;
}

declare module 'supports-hyperlinks' {
  const supportsHyperlinks: { stdout: boolean; stderr: boolean };
  export default supportsHyperlinks;
}

declare module 'yoga-layout' {
  export function getYogaCounters(): { nodes: number; configs: number; dealloced: number };

  const Yoga: {
    Node: {
      create(): YogaNode;
      createDefault(): YogaNode;
    };
    Config: {
      create(): YogaConfig;
    };
    DIRECTION_LTR: number;
    DIRECTION_RTL: number;
    FLEX_DIRECTION_COLUMN: number;
    FLEX_DIRECTION_ROW: number;
    JUSTIFY_FLEX_START: number;
    JUSTIFY_CENTER: number;
    JUSTIFY_FLEX_END: number;
    JUSTIFY_SPACE_BETWEEN: number;
    JUSTIFY_SPACE_AROUND: number;
    JUSTIFY_SPACE_EVENLY: number;
    ALIGN_FLEX_START: number;
    ALIGN_CENTER: number;
    ALIGN_FLEX_END: number;
    ALIGN_STRETCH: number;
    ALIGN_BASELINE: number;
    ALIGN_AUTO: number;
    WRAP_NO_WRAP: number;
    WRAP_WRAP: number;
    WRAP_WRAP_REVERSE: number;
    OVERFLOW_VISIBLE: number;
    OVERFLOW_HIDDEN: number;
    OVERFLOW_SCROLL: number;
    POSITION_TYPE_RELATIVE: number;
    POSITION_TYPE_ABSOLUTE: number;
    EDGE_LEFT: number;
    EDGE_TOP: number;
    EDGE_RIGHT: number;
    EDGE_BOTTOM: number;
    EDGE_START: number;
    EDGE_END: number;
    EDGE_ALL: number;
    UNIT_PERCENT: number;
    UNIT_POINT: number;
    UNIT_AUTO: number;
  };
  export default Yoga;
}

interface YogaNode {
  setConfig(config: YogaConfig): void;
  setWidth(width: number): void;
  setHeight(height: number): void;
  setMinWidth(width: number): void;
  setMinHeight(height: number): void;
  setMaxWidth(width: number): void;
  setMaxHeight(height: number): void;
  setFlexGrow(grow: number): void;
  setFlexShrink(shrink: number): void;
  setFlexBasis(basis: number): void;
  setFlexDirection(direction: number): void;
  setJustifyContent(justify: number): void;
  setAlignItems(align: number): void;
  setAlignSelf(align: number): void;
  setAlignContent(align: number): void;
  setPosition(position: number): void;
  setPosition(edge: number, value: number): void;
  setMargin(edge: number, value: number): void;
  setPadding(edge: number, value: number): void;
  setBorder(edge: number, value: number): void;
  setDisplay(display: number): void;
  setOverflow(overflow: number): void;
  setGrow(grow: number): void;
  setDirection(direction: number): void;
  setFlex(flex: number): void;
  setWrap(wrap: number): void;
  insertChild(child: YogaNode, index: number): void;
  removeChild(child: YogaNode): void;
  setChildOrder(child: YogaNode, order: number): void;
  calculateLayout(width?: number, height?: number, direction?: number): void;
  getComputedLeft(): number;
  getComputedTop(): number;
  getComputedWidth(): number;
  getComputedHeight(): number;
  getComputedMargin(edge: number): number;
  getComputedPadding(edge: number): number;
  getComputedBorder(edge: number): number;
  getChildCount(): number;
  getChild(index: number): YogaNode;
  getParent(): YogaNode | null;
  markDirty(): void;
  isDirty(): boolean;
  hasNewLayout(): boolean;
  markLayoutSeen(): void;
  unsetWidth(): void;
  unsetHeight(): void;
  unsetFlexBasis(): void;
  unsetPosition(edge: number): void;
  unsetMargin(edge: number): void;
  unsetPadding(edge: number): void;
  unsetBorder(edge: number): void;
  setAspectRatio(ratio: number): void;
  getFlexDirection(): number;
  getJustifyContent(): number;
  getAlignItems(): number;
  getAlignSelf(): number;
  getAlignContent(): number;
  getPositionType(): number;
  getOverflow(): number;
  getDisplay(): number;
  getFlexGrow(): number;
  getFlexShrink(): number;
  getFlexBasis(): number;
  getWidth(): number;
  getHeight(): number;
  getMinWidth(): number;
  getMinHeight(): number;
  getMaxWidth(): number;
  getMaxHeight(): number;
  getFlex(): number;
  getWrap(): number;
  getComputedRight(): number;
  getComputedBottom(): number;
  getComputedMargin(): number;
}

interface YogaConfig {
  free(): void;
  useWebDefaults(): void;
  setPointScaleFactor(factor: number): void;
}

declare module '@opentelemetry/exporter-prometheus' {
  export class PrometheusExporter {
    constructor(options?: Record<string, unknown>);
    start(): Promise<void>;
    shutdown(): Promise<void>;
  }
}

declare module '@opentelemetry/sdk-metrics' {
  export class View {
    constructor(config?: Record<string, unknown>);
  }
  export abstract class Aggregation {
    static Sum(): Aggregation;
    static LastValue(): Aggregation;
    static Count(): Aggregation;
    static ExplicitBucketHistogram(boundaries: number[]): Aggregation;
  }
  export class MeterProvider {
    constructor(config?: Record<string, unknown>);
    getMeter(name: string, version?: string): unknown;
  }
  export class PeriodicExportingMetricReader {
    constructor(config?: Record<string, unknown>);
  }
  export class ConsoleMetricExporter {
    constructor(config?: Record<string, unknown>);
    export(metrics: unknown): void;
    shutdown(): Promise<void>;
  }
}

declare module '@opentelemetry/exporter-trace-otlp-grpc' {
  export class OTLPTraceExporter {
    constructor(options?: Record<string, unknown>);
    shutdown(): Promise<void>;
  }
}

declare module '@opentelemetry/sdk-trace-node' {
  import type { SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base';
  export class NodeTracerProvider {
    constructor(config?: Record<string, unknown>);
    addSpanProcessor(processor: SpanProcessor): void;
    register(): void;
    getTracer(name: string, version?: string): {
      startSpan(name: string, options?: Record<string, unknown>): unknown;
    };
  }
  export class BatchSpanProcessor {
    constructor(exporter: SpanExporter, config?: Record<string, unknown>);
  }
  export class SimpleSpanProcessor {
    constructor(exporter: SpanExporter);
  }
  export class ConsoleSpanExporter implements SpanExporter {
    export(spans: unknown[], callback: (result: unknown) => void): void;
    shutdown(): Promise<void>;
  }
}

declare module '*/AnalyticsService.js' {
  import type { AnalyticsSink } from '../analytics/types.js';
  export const AnalyticsService: new () => AnalyticsSink;
  export const analyticsService: AnalyticsSink;
}

declare module 'vitest' {
  export function describe(name: string, fn: () => void): void;
  export function describe(name: string, options: Record<string, unknown>, fn: () => void): void;
  export namespace describe {
    function skip(name: string, fn: () => void): void;
    function only(name: string, fn: () => void): void;
    function each(cases: unknown[]): (name: string, fn: (...args: unknown[]) => void) => void;
  }
  export function it(name: string, fn: () => void | Promise<void>, timeout?: number): void;
  export namespace it {
    function skip(name: string, fn: () => void | Promise<void>): void;
    function only(name: string, fn: () => void | Promise<void>): void;
    function each(cases: unknown[]): (name: string, fn: (...args: unknown[]) => void) => void;
  }
  export function test(name: string, fn: () => void | Promise<void>, timeout?: number): void;
  export function expect<T>(actual: T): Expect<T>;
  export namespace expect {
    function objectContaining(expected: Record<string, unknown>): Record<string, unknown>;
  }
  export interface Expect<T> {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeNaN(): void;
    toBeInstanceOf(expected: new (...args: unknown[]) => unknown): void;
    toBeLessThan(expected: number): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toContain(item: unknown): void;
    toContainEqual(item: unknown): void;
    toHaveLength(expected: number): void;
    toHaveProperty(propertyPath: string, value?: unknown): void;
    toMatch(expected: string | RegExp): void;
    toMatchObject(expected: Record<string, unknown>): void;
    toThrow(error?: string | Error | RegExp): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledWith(...args: unknown[]): void;
    toHaveBeenCalledTimes(expected: number): void;
    toHaveBeenCalledExactly(...args: unknown[]): void;
    resolves: Expect<T>;
    rejects: Expect<T>;
    not: Expect<T>;
  }
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export const vi: {
    fn: <T extends (...args: unknown[]) => unknown = (...args: unknown[]) => unknown>(implementation?: T) => MockInstance;
    spy: () => { fn: () => unknown; spy: () => unknown };
  };
  export type Expect<T> = import('./global').Expect<T>;
}

declare module '../session/SessionManager.js' {
  const SessionManager: unknown;
  export default SessionManager;
}

declare module '*.json' {
  const value: Record<string, unknown>;
  export default value;
}

declare module 'react/compiler-runtime' {
  export function c(size?: number): any;
}

declare module 'react-reconciler' {
  import type { ReactReconciler } from 'react-reconciler';
  const reconciler: ReactReconciler;
  export default reconciler;
}

declare module 'react-reconciler/constants.js' {
  export const Default: number;
  export const NoContext: number;
  export const ConcurrentMode: number;
  export const BatchedContext: number;
  export const LegacyMode: number;
  export const BlockingMode: number;
  export const NoMode: number;
  export const NoFlags: number;
  export const PerformedWork: number;
  export const Placement: number;
  export const Update: number;
  export const Deletion: number;
  export const ContentReset: number;
  export const Snapshot: number;
  export const Callback: number;
  export const Ref: number;
  export const Passive: number;
  export const PlacementAndUpdate: number;
  export const RefStatic: number;
  export const LayoutMask: number;
  export const PassiveMask: number;
  export const MutationMask: number;
  export const ContinuousEventPriority: number;
  export const DefaultEventPriority: number;
  export const DiscreteEventPriority: number;
  export const NoEventPriority: number;
  export const ConcurrentRoot: number;
  export const LegacyRoot: number;
}

declare module 'stack-utils' {
  interface StackUtilsOptions {
    cwd?: string;
    internals?: RegExp[];
    ignoreStackOverflow?: boolean;
    wrapCallSite?: (site: unknown) => unknown;
  }
  class StackUtils {
    constructor(options?: StackUtilsOptions);
    clean(stack: string): string;
    capture(limit?: number, fn?: (...args: unknown[]) => unknown): CallSite[];
    captureString(limit?: number, fn?: (...args: unknown[]) => unknown): string;
  }
  interface CallSite {
    getThis(): unknown;
    getTypeName(): string | null;
    getFunction(): ((...args: unknown[]) => unknown) | null;
    getFunctionName(): string | null;
    getMethodName(): string | null;
    getFileName(): string | null;
    getLineNumber(): number | null;
    getColumnNumber(): number | null;
    getEvalOrigin(): string | null;
    isToplevel(): boolean;
    isEval(): boolean;
    isNative(): boolean;
    isConstructor(): boolean;
  }
  export default StackUtils;
}

declare module 'semver' {
  export function satisfies(version: string, range: string): boolean;
  export function valid(version: string): string | null;
  export function clean(version: string): string | null;
  export function parse(version: string): SemVer | null;
  export function coerce(version: string): SemVer | null;
  export class SemVer {
    major: number;
    minor: number;
    patch: number;
    version: string;
    constructor(version: string);
  }
}

declare module 'lodash-es/noop.js' {
  const noop: () => void;
  export default noop;
}

declare module 'lodash-es/throttle.js' {
  function throttle<T extends (...args: unknown[]) => unknown>(func: T, wait?: number, options?: { leading?: boolean; trailing?: boolean }): T;
  export default throttle;
}

declare module '../../ink.js' {
  export { default } from '../ink.js';
}

declare module '../../diagnostics/DiagnosticsService.js' {
  export * from '../diagnostics/DiagnosticsService.js';
}

declare module '../parse-keypress.js' {
  export const INITIAL_STATE: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean; key: string };
  export interface ParsedInput {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    key: string;
    sequence?: string;
    name?: string;
    code?: string;
  }
  export interface ParsedKey {
    name: string;
    code?: string;
    sequence?: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
    isCharacter: boolean;
  }
  export interface ParsedMouse {
    name: string;
    action: string;
    row: number;
    col: number;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
  }
  export function parseMultipleKeypresses(data: string, callback: (key: ParsedKey) => void): void;
  export const nonAlphanumericKeys: Record<string, string>;
  export type TerminalResponse = string;
}

declare module '../../frontmatterParser' {
  export function parseFrontmatter(content: string): Record<string, unknown>;
}

declare module '@modules/tools/types' {
  export type ToolCall = any;
}

declare module '../miniagent/types.js' {
  export type MiniAgent = any;
}

declare module '@modules/bridge' {
  const Bridge: any;
  export { Bridge };
}

declare module '../../plugins/PluginLoader' {
  export function loadPluginAgents(): Promise<unknown[]>;
}

declare module '../../types/ids.js' {
  export type AgentId = string;
}

declare module '../../plugins/utils/pluginSettings.js' {
  export function getPluginSettings(pluginId: string): Promise<Record<string, unknown>>;
  export function savePluginSettings(pluginId: string, settings: Record<string, unknown>): Promise<void>;
}

declare module '@modules/oauth' {
  export function generateCodeVerifier(): string;
  export function generateCodeChallenge(verifier: string): string;
  export function generateState(): string;
  export class OAuthClient {
    constructor(config: any);
    getAuthorizationUrl(params: any): string;
    exchangeCode(params: any): Promise<any>;
    refreshToken(params: any): Promise<any>;
    getClientInfo(): any;
  }
  export function createOAuthStorage(storage: any): any;
  export interface UserInfo {
    sub: string;
    name?: string;
    email?: string;
    picture?: string;
  }
  export class OAuthDiscovery {
    discover(url: string): Promise<any>;
  }
  export class OAuthProvider {
    constructor(config: OAuthProviderConfig);
    authorize(options: AuthorizeOptions): Promise<OAuthToken>;
  }
  export interface OAuthProviderConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes?: string[];
  }
  export interface AuthorizeOptions {
    userId: string;
    state?: string;
  }
  export interface OAuthToken {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scope?: string;
  }
}

declare module '../../cronJitterConfig' {
  export function isTaskExpired(task: unknown): boolean;
}

declare module '../cronJitterConfig' {
  export function isTaskExpired(task: unknown): boolean;
}

declare module './cronJitterConfig' {
  export function isTaskExpired(task: unknown): boolean;
}

declare module '../../envUtils.js' {
  export function gte(version: string, minVersion: string): boolean;
}

declare module '../envUtils.js' {
  export function gte(version: string, minVersion: string): boolean;
}

declare module './envUtils.js' {
  export function gte(version: string, minVersion: string): boolean;
}

declare module '../../parse-keypress.js' {
  export const INITIAL_STATE: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean; key: string };
  export interface ParsedInput {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    key: string;
    sequence?: string;
    name?: string;
    code?: string;
  }
  export interface ParsedKey {
    name: string;
    code?: string;
    sequence?: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
    isCharacter: boolean;
  }
  export interface ParsedMouse {
    name: string;
    action: string;
    row: number;
    col: number;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
  }
  export function parseMultipleKeypresses(data: string, callback: (key: ParsedKey) => void): void;
  export const nonAlphanumericKeys: Record<string, string>;
  export type TerminalResponse = string;
}

declare module './components/AlternateScreen' {
  const AlternateScreen: unknown;
  export default AlternateScreen;
}

declare module './components/NoSelect' {
  const NoSelect: unknown;
  export default NoSelect;
}

declare module './components/RawAnsi' {
  const RawAnsi: unknown;
  export default RawAnsi;
}

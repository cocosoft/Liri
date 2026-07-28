/**
 * 解析器自动注册
 *
 * 一次性注册所有已知的工具调用解析器，供 parseFallback 使用。
 * 在 App 启动时调用一次即可。
 */
import { parserRegistry } from './ParserRegistry';
import { HermesXmlParser } from './HermesXmlParser';
import { DeepSeekV3Parser } from './DeepSeekV3Parser';
import { DeepSeekV31Parser } from './DeepSeekV31Parser';
import { Glm45Parser } from './Glm45Parser';
import { LlamaJsonParser } from './LlamaJsonParser';
import { InvokeXmlParser } from './InvokeXmlParser';

let _registered = false;

export function registerAllParsers(): void {
  if (_registered) return;
  _registered = true;

  parserRegistry.register(new HermesXmlParser());
  parserRegistry.register(new DeepSeekV3Parser());
  parserRegistry.register(new DeepSeekV31Parser());
  parserRegistry.register(new Glm45Parser());
  parserRegistry.register(new LlamaJsonParser());
  parserRegistry.register(new InvokeXmlParser());
}

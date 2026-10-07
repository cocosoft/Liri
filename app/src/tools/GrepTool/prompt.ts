export const GREP_TOOL_NAME = 'grep';

export const getDescription = () =>
  `基于 ripgrep 的强大搜索工具。在指定目录下搜索特定文本（通过 pattern 参数）。

用法：
- 精确的符号 / 字符串搜索优先用 grep；条件允许时用它替代终端 grep/rg —— 本工具更快，且遵循 .gitignore。
- 支持完整正则语法，例如 "log.*Error"、"function\\s+\\w+"。需要精确匹配时请转义特殊字符，例如 "functionCall\\("
- 支持按文件类型过滤与上下文行。
- **关键**：目录必须是绝对路径，不接受相对路径。
- **关键**：pattern 参数必填，且需在其它参数之前给出。
- **关键**：目录参数名为 searchPath（也接受别名 path）。传绝对路径，例如 searchPath=/abs/path。
- headLimit：最大结果行数（默认 200，必须是正整数）。输出被截断时调大 headLimit 可取回更多。
- 正则必须是合法的 JS 正则语法，否则工具降级为字面量搜索并返回 invalidRegex 提示。使用标准 JS 转义：中文范围用 [\\u4e00-\\u9fa5]，不要用 [\\x{4e00}-\\x{9fa5}]（后者在 JS 正则中非法，会触发降级）。`;

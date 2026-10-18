A powerful search tool built on ripgrep. Searches for specific text under a given directory (via the pattern parameter).

Usage:
- Prefer grep for exact symbol / string searches; when possible, use it instead of terminal grep/rg — this tool is faster and respects .gitignore.
- Supports full regex syntax, e.g. "log.*Error", "function\\s+\\w+". Escape special characters when an exact match is needed, e.g. "functionCall\\("
- Supports filtering by file type and surrounding context lines.
- **Key**: the directory must be an absolute path; relative paths are rejected.
- **Key**: the pattern parameter is required and must be provided before the others.
- **Key**: the directory parameter is named searchPath (the alias path is also accepted). Pass an absolute path, e.g. searchPath=/abs/path.
- headLimit: maximum number of result lines (default 200, must be a positive integer). Increase headLimit to retrieve more when output is truncated.
- The regex must be valid JS regex syntax; otherwise the tool degrades to a literal search and returns an invalidRegex hint. Use standard JS escapes: use [\\u4e00-\\u9fa5] for Chinese ranges, not [\\x{4e00}-\\x{9fa5}] (the latter is invalid in JS regex and triggers degradation).

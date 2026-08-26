"""type hints → JSON Schema（PY-2 参数 schema 生成，轻量实现，零运行时依赖）

设计文档标注：TS 靠编译器、Python 靠 type hints。首版 vendored 无 pip 依赖，
用自研轻量解析（inspect + typing），覆盖常见类型；后续如需 pydantic 语义再迁移。
"""
import inspect
import typing
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Union, get_args, get_origin

# Python → JSON Schema type 映射
_PY_TYPE_TO_JSON = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    dict: "object",
    list: "array",
}


def _is_optional(tp: Any) -> bool:
    origin = get_origin(tp)
    return origin is Union and type(None) in get_args(tp)


def _resolve_type(tp: Any) -> str:
    """解析类型注解为 JSON Schema type；Optional[X] 取其内层"""
    if _is_optional(tp):
        args = [a for a in get_args(tp) if a is not type(None)]
        tp = args[0] if args else str
    if tp in _PY_TYPE_TO_JSON:
        return _PY_TYPE_TO_JSON[tp]
    if tp is Any or tp is inspect.Parameter.empty:
        return "string"
    origin = get_origin(tp)
    if origin in (list, List):
        return "array"
    if origin in (dict, Dict):
        return "object"
    # 未识别类型保守降级为 string
    return "string"


def schema_from_callable(
    fn: Callable[..., Any],
    *,
    param_descriptions: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """从函数签名生成 JSON Schema（properties 风格，对齐 ToolRegistration.parameters）

    :param fn: 目标函数
    :param param_descriptions: 可选：参数名 → 描述（装饰器 description 传入）
    :returns: {"<name>": {"type": ..., "description": ..., "required": bool, ...}}
    """
    sig = inspect.signature(fn)
    hints = typing.get_type_hints(fn)
    descriptions = param_descriptions or {}
    properties: Dict[str, Any] = {}
    required: List[str] = []

    for name, param in sig.parameters.items():
        if name in ("self", "cls", "ctx"):
            # ctx 为可选上下文注入参数（适配器注入白名单字段），不进工具参数 schema
            continue
        tp = hints.get(name, str)
        prop: Dict[str, Any] = {
            "type": _resolve_type(tp),
        }
        desc = descriptions.get(name)
        if desc:
            prop["description"] = desc
        if param.default is not inspect.Parameter.empty:
            prop["default"] = param.default
        else:
            required.append(name)
        properties[name] = prop

    # 对齐 ToolRegistration.parameters：仅 properties，required 由各 prop 携带
    for name in required:
        properties[name]["required"] = True

    return properties

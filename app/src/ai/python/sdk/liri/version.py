"""liri SDK 版本（与主进程桥接协议版本 BRIDGE_PROTOCOL_VERSION 对齐）"""
__version__ = "0.1.0"
# 桥接协议版本（PY-1 版本协商：initialize 响应带此版本，主进程校验 major 兼容）
PROTOCOL_VERSION = 1

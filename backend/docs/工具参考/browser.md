# Browser - 浏览器控制工具

## 描述

控制浏览器执行操作，支持页面导航、点击、输入等交互。

## 功能特性

- 页面导航与刷新
- 元素点击与输入
- 表单填写
- 屏幕截图
- 控制台日志获取
- 网络请求监控

## 使用示例

```javascript
// 打开页面
navigate({ url: "https://example.com" })

// 点击元素
click({ uid: "element-uid" })

// 填写输入框
fill({ uid: "input-uid", value: "Hello" })

// 获取页面截图
screenshot()
```

## 安全配置

- 沙箱环境运行
- 受限的网络访问
- 下载文件安全检查

## 注意事项

- 浏览器操作需要等待页面完全加载
- 某些网站可能检测并阻止自动化操作
- 建议配合 web_fetch 使用

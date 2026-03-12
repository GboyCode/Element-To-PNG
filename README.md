# Element To PNG | 网页元素转PNG

该项目实现了一个 Manifest V3 的 Chrome 扩展，支持在任意网页中“点选页面元素”，并将该元素截图为 PNG 后写入系统剪贴板。

## 功能说明

- 点击扩展弹窗中的“开始选择元素”
- 回到页面后，鼠标移动会高亮当前元素
- 单击目标元素后自动截图并复制为 PNG
- 按 `Esc` 可退出选择模式

## 文件结构

- `manifest.json`：扩展配置与权限声明
- `background.js`：后台截图与裁剪逻辑
- `content.js`：页面元素选择、高亮、复制剪贴板逻辑
- `popup.html` / `popup.css` / `popup.js`：扩展弹窗 UI 与交互
- `generate_icons.html`：图标生成工具（用于生成 PNG 图标）
- `icons/`：存放图标资源

## 安装方式（开发者模式）

> **注意**：首次安装前，请先双击打开 `generate_icons.html`，点击“下载所有图标”，并将下载的 `icon16.png`、`icon32.png`、`icon48.png`、`icon128.png` 放入 `icons` 目录中。

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前项目目录

## 使用步骤

1. 打开任意网页
2. 点击工具栏中的扩展图标，打开弹窗
3. 点击“开始选择元素”
4. 回到网页，点击目标元素
5. 在聊天工具、文档或画图工具中粘贴，验证 PNG 是否成功复制

## 权限说明

- `activeTab`：获取当前活动标签页上下文
- `tabs`：调用 `captureVisibleTab` 截取可视区域
- `scripting`：在必要时动态注入内容脚本
- `host_permissions: <all_urls>`：允许在任意网页执行元素选择与截图流程

## 已完成的基本自测流程

在本地代码层面完成以下自查（人工流程）：

1. 检查 `manifest.json` 是否声明了 popup、background 与 content script
2. 检查 popup 点击后是否向内容脚本发送启动选择消息
3. 检查内容脚本是否能：
   - 高亮 hover 元素
   - 点击后发送裁剪请求到后台
   - 收到 PNG 后写入剪贴板
4. 检查后台是否执行：
   - 可视区域截图
   - 按元素矩形与 DPR 裁剪
   - 返回裁剪后的 PNG DataURL

## 注意事项

- 当前实现基于 `captureVisibleTab`，仅能截取“当前可视区域”内元素。若元素超出可视区域，请先滚动到可见后再点击。
- 某些受限页面（如 Chrome Web Store、`chrome://` 页面）不允许执行内容脚本，属于浏览器安全限制。

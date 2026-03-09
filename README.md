# next-ai-test-cases

使用 `LangChain.js + shadcn/ui + simple-mind-map` 构建的测试用例生成助手。

## 功能

- 左右布局：左侧脑图，右侧对话
- 右侧上下布局：上方对话记录，下方输入区
- 仅通过“发送”按钮触发流程：
  - 首次发送：根据输入需求生成脑图
  - 后续发送：通过对话增删改脑图
- 输入区支持模板 tag（登录/注册/搜索/支付）快速插入需求
- 支持导入 `.xmind`（读取 `content.json`）并加载到脑图
- 支持导出 `.xmind`（可在 XMind 中继续编辑）
- 支持导出 CSV（测试用例标准列）

## 技术栈

- Next.js 15 (App Router)
- LangChain.js + OpenAI
- shadcn/ui 组件风格
- simple-mind-map

## 本地运行

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

打开 `http://localhost:3000`。

## 环境变量

- `OPENAI_API_KEY`: OpenAI API Key
- `OPENAI_MODEL`: 可选，默认 `gpt-5.1`
- `OPENAI_BASE_URL`: 可选，自定义 OpenAI 兼容网关地址

## CSV 导出格式

CSV 使用 UTF-8 BOM，列固定为：

- `测试名称`
- `优先级`
- `前置条件`
- `测试步骤`
- `期望结果`

其中 `测试名称 = category + "-" + topic`。

## 目录结构

- `src/app/page.tsx`: 主界面（左脑图 + 右对话）
- `src/app/api/test-case-agent/route.ts`: 首次生成 API
- `src/app/api/test-case-agent/chat/route.ts`: 连续对话更新脑图 API
- `src/app/api/test-case-agent/import-xmind/route.ts`: 导入 XMind API
- `src/app/api/test-case-agent/export-xmind/route.ts`: 导出 XMind API
- `src/lib/agent/testCaseAgent.ts`: LangChain 生成逻辑
- `src/components/mindmap/mindmap-view.tsx`: simple-mind-map 渲染

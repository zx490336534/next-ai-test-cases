# next-ai-test-cases

测试用例生成助手（Next.js + LangChain + shadcn/ui + simple-mind-map）。

左侧是脑图编辑区，右侧是 AI 对话区。首次发送生成脑图，后续连续对话增删改脑图。

## 核心功能

- 连续对话生成/修改测试用例脑图
- 脑图结构：类别 -> 前置条件 -> 用例 -> 测试步骤 -> 期望结果
- 测试步骤与期望结果按父子结构组织
- 导出 CSV（含优先级、步骤、期望结果）
- 导出 XMind（优先级使用 XMind 任务优先级图标）
- 支持 MCP（从 `mcp.json` 自动加载并作为工具供 Agent 调用）

## 界面截图

### 生成

![生成](doc/img/生成.png)

### 用例展示

![用例展示](doc/img/部分用例展示.png)

### 对话修改

![对话修改](doc/img/修改.png)

### 导出 CSV

![导出 CSV](doc/img/导出csv.png)

### 导出 XMind

![导出 XMind](doc/img/导出xmind.png)

## 技术栈

- Next.js 16（App Router）
- React 19
- LangChain.js 1.x
- @langchain/mcp-adapters
- shadcn/ui
- simple-mind-map

## 快速开始

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

访问：`http://localhost:3000`

## 环境变量

`.env.example`：

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.1
OPENAI_BASE_URL=
```

说明：

- `OPENAI_API_KEY` 必填
- `OPENAI_MODEL` 选填
- `OPENAI_BASE_URL` 选填（OpenAI 兼容网关，如 oneapi）

## MCP 配置

项目会在运行时读取根目录 `mcp.json`。

```bash
cp mcp.json.example mcp.json
```

然后按你的 MCP Server 实际信息修改 `mcp.json`。

当前支持：

- `stdio`
- `http`
- `sse`

加载位置：`src/lib/agent/testCaseAgent.ts`

## 导出说明

### CSV 列结构

- `测试名称`
- `优先级`
- `前置条件`
- `测试步骤`
- `期望结果`

### XMind 结构

- 根节点：`@测试用例`
- 二级：`@类别`
- 三级：`!前置条件`
- 四级：测试用例节点
- 五级：`测试步骤`
- 六级：`期望结果`

优先级会写入 XMind marker（`priority-1` 到 `priority-4`），不是文本前缀。

## 主要目录

- `src/app/page.tsx`：主页面（脑图 + 对话）
- `src/lib/agent/testCaseAgent.ts`：Agent、提示词、MCP 加载
- `src/app/api/test-case-agent/route.ts`：首次生成接口
- `src/app/api/test-case-agent/chat/route.ts`：连续对话更新接口
- `src/app/api/test-case-agent/export-xmind/route.ts`：导出 XMind
- `mcp.json.example`：MCP 配置模板

## 常用命令

```bash
pnpm dev
pnpm lint
pnpm build
```

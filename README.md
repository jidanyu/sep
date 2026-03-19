# SEP Agent Workspace

中文 | [English](#english)

## 中文

### 项目简介

`SEP Agent Workspace` 是一个桌面优先的 Agent 工作台原型，面向编码、编排和低开销本地执行场景。

当前版本为 `v0.1`，重点是先把单会话、多 Provider、基础工具面板、基础 MCP 状态和基础 transcript 体验搭起来，并保持：

- 本地优先
- 增量渲染，尽量避免闪烁
- 轻量、直接、易于继续迭代
- 兼容 Claude 风格和 Codex 风格的使用习惯

这个仓库目前使用：

- `Tauri 2` 作为桌面壳
- `React 18 + TypeScript` 构建前端界面
- `Vite` 作为前端开发与构建工具
- `Rust` 负责桌面侧命令调用和流式请求转发

### 当前已实现

- **单会话工作流**
  - 当前只聚焦一个会话窗口，不引入多会话管理复杂度。
  - 新建会话时可直接选择任意系统目录作为会话根目录，Shell 与 Editor 工具会围绕该目录工作。
- **多 Provider 配置界面**
  - UI 中包含 `OpenAI`、`Anthropic`、`Google`、`OpenCode Bridge` 的接入入口。
  - 支持模型选择、推理强度选择、启用/连接状态切换。
- **双语界面基础**
  - 内置中文和英文文案。
- **主题切换**
  - 提供深色主题和 `Rust light` 浅色主题。
- **Transcript 面板**
  - 展示 `system / user / assistant / tool` 消息流。
  - 保持增量更新与自动滚动。
- **本地状态持久化**
  - 会话状态、Provider 配置、主题和语言通过本地 Rust tool 进程持久化到 SQLite。
- **桌面端流式对话**
  - Tauri 后端已接入流式请求与事件回传。
  - 当前真正打通的 Provider 是 `OpenAI` 和 `Anthropic`。
- **基础 Tools / MCP 展示**
  - UI 中已提供内建工具与 MCP 状态区，便于后续扩展。
  - 当前对模型默认暴露的工具分为 `Shell`、`Editor` 和 `Web Fetch`；`Shell` 负责命令、依赖、测试、构建、搜索和 Git，`Editor` 负责直接读写和修改文件内容。
- **OpenAI JSON 配置编辑**
  - 可直接在界面中编辑 OpenAI 风格配置 JSON，并同步模型预设。

### 当前限制

这是一个 `v0.1` 原型，已有清晰方向，但还不是完整产品。当前限制包括：

- **未实现多会话**
  - 目前只有单会话流程。
- **未实现高级子代理工作流**
  - Subagents、Fork、A2A 等仍属于后续版本目标。
- **MCP 仍是基础占位**
  - 目前主要是状态展示和结构预留，不是完整 MCP 编排系统。
- **部分 Provider 仅完成 UI 预留**
  - `Google` 和 `OpenCode Bridge` 已有界面与配置结构，但桌面端真实请求当前未打通。
- **本地存储为主**
  - 当前配置主要由本地 Rust tool 进程保存在 SQLite 中，适合原型开发和本地试验。
- **浏览器模式能力有限**
  - 仅运行前端开发服务器时，可以查看界面，但无法完整替代桌面端能力。

### 适合做什么

这个项目当前更适合用于：

- 试验桌面优先 Agent 工作台的交互形态
- 验证多 Provider 接入和模型画像展示
- 迭代 transcript、设置页、主题和流式渲染体验
- 为后续 MCP、工具系统、子代理与兼容层打基础

### 快速启动

#### 依赖

建议本地准备：

- `Node.js`
- `npm`
- `Rust`
- `Tauri` 开发环境

#### 安装

```bash
npm install
```

#### 启动前端开发模式

```bash
npm run dev
```

或者：

```bash
just dev
```

这会启动纯前端开发服务器，适合查看界面，但不等同于完整桌面运行模式。

#### 启动桌面应用开发模式

```bash
npm run tauri -- dev
```

或者：

```bash
just desktop
```

这是更符合当前项目定位的运行方式，可以使用 Tauri 桌面侧能力。

#### 构建

```bash
npm run build
```

### 项目结构

```text
.
├─ src/                 # React + TypeScript 前端
├─ src-tauri/           # Tauri / Rust 桌面端
├─ scripts/             # 辅助脚本
├─ index.html           # Vite 入口
├─ package.json         # 前端依赖与脚本
├─ justfile             # 本地快捷命令
└─ README.md
```

### 代码结构说明

- `src/App.tsx`
  - 主界面，负责布局、设置页、transcript、provider 切换、主题与本地状态管理。
- `src/data/mock.ts`
  - 当前的 provider、tools、MCP、默认 transcript 和模型预设数据。
- `src/types.ts`
  - 前端核心类型定义。
- `src-tauri/src/main.rs`
  - Tauri 后端入口，负责接收前端请求并将 OpenAI / Anthropic 的流式响应转成前端事件。

### 当前版本定位

`v0.1` 的目标不是一次性做全，而是先把下面几件事做稳：

- 单会话
- 多 Provider
- 基础内建工具
- 基础 MCP
- 基础 transcript UI 与本地存储

后续版本会继续推进：

- `v0.2`：子代理、Fork 会话、资源控制、初步压缩与 handoff
- `v0.3`：外部客户端桥接、A2A、更多权限能力、模型画像路由
- `v0.4`：工作区、模板、观测能力、崩溃恢复、导入导出

---

## English

### Overview

`SEP Agent Workspace` is a desktop-first agent workspace prototype for coding, orchestration, and low-overhead local execution.

The current milestone is `v0.1`. Its goal is to establish a simple but solid foundation for:

- single-session workflow
- multi-provider access
- basic built-in tool panels
- basic MCP status
- basic transcript UX

The project aims to stay:

- local-first
- incrementally rendered with minimal flicker
- lightweight and practical
- compatible with Claude-style and Codex-style workflows

This repository currently uses:

- `Tauri 2` for the desktop shell
- `React 18 + TypeScript` for the UI
- `Vite` for frontend development and build
- `Rust` for desktop commands and streaming request plumbing

### What is implemented now

- **Single-session workflow**
  - The current app intentionally focuses on one session only.
  - Creating a new session lets you choose any system directory as the session root for Shell and Editor tools.
- **Multi-provider settings UI**
  - The UI includes entries for `OpenAI`, `Anthropic`, `Google`, and `OpenCode Bridge`.
  - It supports model selection, reasoning variant selection, and enabled/connected toggles.
- **Basic bilingual UI**
  - Chinese and English copy are built in.
- **Theme switching**
  - Includes a dark theme and a `Rust light` theme.
- **Transcript panel**
  - Displays `system / user / assistant / tool` entries.
  - Uses incremental updates and auto-scroll behavior.
- **Local persistence**
  - Session state, provider settings, theme, and locale are persisted to SQLite by the local Rust tool process.
- **Desktop streaming chat**
  - The Tauri backend already supports streaming requests and event forwarding.
  - The providers currently wired end-to-end are `OpenAI` and `Anthropic`.
- **Basic Tools / MCP presentation**
  - The UI already exposes built-in tool and MCP sections for future expansion.
  - The model-facing toolset is split into `Shell`, `Editor`, and `Web Fetch`; `Shell` handles commands, dependencies, tests, builds, search, and git, while `Editor` handles direct file reads and edits.
- **OpenAI JSON config editing**
  - The app can edit OpenAI-style config JSON and derive model presets from it.

### Current limitations

This is a `v0.1` prototype, so some parts are intentionally incomplete:

- **No multi-session management yet**
  - The app currently supports a single session flow only.
- **No advanced subagent workflows yet**
  - Subagents, forked sessions, and A2A are part of later milestones.
- **MCP is still basic**
  - The current implementation is mostly structure and status display, not a full MCP orchestration system.
- **Some providers are UI placeholders for now**
  - `Google` and `OpenCode Bridge` are represented in the UI and state model, but are not fully wired in the desktop backend yet.
- **Local storage first**
  - Configuration is currently persisted locally through the Rust tool process and SQLite, which is good for prototyping and local experimentation.
- **Browser-only mode is limited**
  - Running only the frontend dev server is useful for UI work, but does not replace the full desktop runtime.

### Good fit for

At its current stage, this project is best suited for:

- exploring a desktop-first agent workspace UX
- validating multi-provider configuration flows
- iterating on transcript, settings, themes, and streaming behavior
- building the foundation for MCP, tools, subagents, and compatibility layers

### Getting started

#### Requirements

You will typically want:

- `Node.js`
- `npm`
- `Rust`
- a working `Tauri` development environment

#### Install

```bash
npm install
```

#### Run frontend-only development mode

```bash
npm run dev
```

or:

```bash
just dev
```

This starts the frontend dev server only. It is useful for UI iteration, but it is not the full desktop runtime.

#### Run desktop development mode

```bash
npm run tauri -- dev
```

or:

```bash
just desktop
```

This is the recommended mode for the current project because it enables the Tauri desktop side.

#### Build

```bash
npm run build
```

### Project structure

```text
.
├─ src/                 # React + TypeScript frontend
├─ src-tauri/           # Tauri / Rust desktop layer
├─ scripts/             # Helper scripts
├─ index.html           # Vite entry
├─ package.json         # Frontend dependencies and scripts
├─ justfile             # Local shortcut commands
└─ README.md
```

### Code map

- `src/App.tsx`
  - Main UI, including layout, settings, transcript, provider switching, theming, and local state handling.
- `src/data/mock.ts`
  - Provider, tool, MCP, default transcript, and model preset data.
- `src/types.ts`
  - Core frontend type definitions.
- `src-tauri/src/main.rs`
  - Tauri backend entrypoint that receives chat requests and converts OpenAI / Anthropic streaming responses into frontend events.

### Version positioning

The purpose of `v0.1` is not to do everything at once. It focuses on getting these pieces in place first:

- single session
- multi-provider adapters
- basic built-in tools
- basic MCP
- basic transcript UI and storage

Planned next steps:

- `v0.2`: subagents, forked sessions, resource controls, initial compaction and handoff
- `v0.3`: external client bridge, A2A, expanded permissions, model-profile-aware routing
- `v0.4`: workspaces, templates, observability, crash recovery, import/export

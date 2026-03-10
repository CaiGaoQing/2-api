# ALL-2-API 🚀

一个强大的 API 代理服务，通过 Kiro API 和 Gemini Antigravity API 免费使用 Claude/Gemini 顶级模型，并封装为标准 OpenAI 兼容接口。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![GitHub stars](https://img.shields.io/github/stars/CaiGaoQing/2-api?style=social)](https://github.com/CaiGaoQing/2-api)

[中文](#) | [English](#)

---

ALL-2-API 是一个突破客户端限制的 API 代理服务，将原本仅限客户端使用的免费大模型（如 Kiro、Gemini Antigravity）转换为标准 OpenAI 兼容接口，可被任意应用调用。基于 Node.js 构建，支持 OpenAI 和 Claude 协议智能转换，让 Cherry-Studio、NextChat、Cline 等工具能够自由使用 Claude Opus 4.5、Gemini 3 Pro 等高级模型。项目内置账号池管理、智能轮询、自动故障转移和健康检查机制，确保服务高可用。

---

## � 功能大纲

### 🔌 API 通道（13 个 Provider）

| 通道 | 路径前缀 | 说明 |
|------|---------|------|
| **Kiro** | `/v1/messages`, `/v1/chat/completions` | Claude 全系列模型，OAuth 授权 |
| **Gemini Antigravity** | `/gemini-antigravity/v1/messages` | Gemini 3 Pro/Flash，Google OAuth |
| **Orchids** | `/orchids/v1/messages` | Orchids 代理，内置负载均衡器 |
| **Warp** | `/w/v1/messages` | Warp 服务，支持多智能体 |
| **Vertex AI** | `/vertex/v1/messages` | Google Cloud Vertex AI |
| **Bedrock** | `/bedrock/v1/messages` | AWS Bedrock |
| **AMI** | `/am/v1/messages` | AMI 服务 |
| **Codex** | `/codex/v1/messages` | Codex 服务 |
| **Flow** | `/flow/v1/chat/completions` | Flow Token 池 |
| **DigitalOcean** | `/do/v1/chat/completions` | DigitalOcean GenAI |
| **Grok** | `/grok/v1/chat/completions` | xAI Grok，SSO Token 池 |
| **Krater** | `/k/v1/chat/completions`, `/k/v1/messages` | Krater API Key 池 |
| **Direct** | `/direct/...` | 通用转发，自定义上游地址 |

### 🖥️ Web UI 管理

- **仪表盘** — 系统概览、实时统计
- **账号池管理** — 每个 Provider 独立管理，支持批量导入/OAuth 登录
- **API Key 管理** — 创建/禁用/配额/限额/用量统计
- **通道管理** — 通道配置、模型映射、定价设置
- **使用统计** — Token 用量、费用分析、排行榜
- **实时日志** — 请求/响应全链路记录，支持筛选和清理
- **聊天测试** — 内置聊天界面，直接测试 API
- **图片生成** — 多模态图片生成能力
- **Outlook 邮箱** — 邮箱账号池管理
- **兑换码/套餐** — 套餐管理与兑换码发放
- **代理设置** — HTTP/HTTPS/SOCKS 代理配置
- **站点设置** — 自定义站点名称、Logo 等

### ⚡ 技术特性

- **协议兼容** — 同时支持 OpenAI (`/v1/chat/completions`) 和 Claude (`/v1/messages`) 协议
- **流式/非流式** — 全通道支持 SSE 流式输出和一次性响应
- **Token 自动刷新** — 过期前自动刷新，失败自动重试
- **智能负载均衡** — 账号池轮询、最少使用优先、自动故障转移
- **多模态输入** — 支持图片、文档等多种输入类型
- **Docker 部署** — 一键 Docker Compose 部署，支持内置/外部数据库
- **集群模式** — 支持多实例水平扩展

---

## �📑 快速导航

- [💡 核心优势](#-核心优势)
- [🚀 快速开始](#-快速开始)
- [🐳 Docker 部署](#-docker-部署)
- [📋 核心功能](#-核心功能)
- [📖 支持的模型](#-支持的模型)
- [🔐 认证配置指南](#-认证配置指南)
- [🔧 API 接口文档](#-api-接口文档)
- [⚙️ 高级配置](#️-高级配置)
- [❓ 常见问题](#-常见问题)
- [📄 开源许可](#-开源许可)

---

## 💡 核心优势

### 🎯 统一接入，一站式管理
- **多模型统一接口**：通过标准 OpenAI 兼容协议，一次配置即可接入 Claude、Gemini 等主流大模型
- **灵活切换机制**：支持通过请求头动态切换模型提供商，满足不同场景需求
- **零成本迁移**：完全兼容 OpenAI API 规范，Cherry-Studio、NextChat、Cline 等工具无需修改即可使用
- **多协议智能转换**：支持 OpenAI、Claude 协议智能转换，实现跨协议模型调用

### 🚀 突破限制，提升效率
- **突破官方限制**：利用 OAuth 授权机制
- **免费高级模型**：通过 Kiro API 免费使用 Claude Opus 4.5，通过 Gemini Antigravity 使用 Gemini 3 Pro，降低使用成本
- **智能账号池调度**：支持多账号轮询、自动故障转移，确保服务高可用

### 🛡️ 安全可控，数据透明
- **全链路日志记录**：捕获所有请求和响应数据，支持审计和调试
- **费用统计**：实时统计 Token 用量和费用，便于成本控制
- **系统提示管理**：支持覆盖和追加模式，实现统一基础指令与个性化扩展的完美结合

### 🔧 开发者友好，易于扩展
- **Web UI 管理控制台**：实时配置管理、健康状态监控、API 测试和日志查看
- **模块化架构**：基于策略和适配器模式，添加新模型提供商仅需 3 步
- **容器化部署**：提供 Docker 支持，一键部署，跨平台运行

---

## 🚀 快速开始


### 方式二：手动启动

```bash
# 安装依赖
npm install

# 启动服务
npm run server
```

### 访问控制台

服务启动后，打开浏览器访问：👉 **http://localhost:13003**

**默认账号密码**：`admin` / `admin123`

---

## 🐳 Docker 部署

### Docker Compose 部署（推荐）

#### 使用内置 MySQL

```bash
# 复制环境变量配置
cp .env.example .env

# 启动服务（包含 MySQL）
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

#### 使用外部数据库

```bash
# 复制并编辑环境变量
cp .env.example .env
# 编辑 .env，设置外部数据库地址

# 启动服务（不启动内置 MySQL）
docker-compose -f docker-compose.external-db.yml up -d
```

### 环境变量说明

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `13003` | API 服务端口 |
| `MYSQL_HOST` | `mysql` | 数据库地址 |
| `MYSQL_PORT` | `3306` | 数据库端口 |
| `MYSQL_USER` | `root` | 数据库用户 |
| `MYSQL_PASSWORD` | `kiro123456` | 数据库密码 |
| `MYSQL_DATABASE` | `kiro_api` | 数据库名称 |
| `MYSQL_EXTERNAL_PORT` | `13306` | MySQL 外部访问端口 |

---

## 📋 核心功能

### Web UI 管理控制台

功能完善的 Web 管理界面，包括：

- 📊 **仪表盘**：系统概览、使用统计、费用分析
- ⚙️ **配置管理**：实时参数修改，支持 Kiro 和 Gemini 提供商配置
- 🔗 **凭据池管理**：监控活跃连接、健康状态统计、启用/禁用管理
- 📁 **账号管理**：集中式 OAuth 凭据管理，支持批量导入
- 📜 **实时日志**：实时显示系统和请求日志，带管理控制
- 🔐 **登录验证**：默认密码 `admin123`，可在控制台修改

### 多模态输入能力

支持图片、文档等多种输入类型，提供更丰富的交互体验和更强大的应用场景。

### 最新模型支持

无缝支持以下最新大模型：

- **Claude Opus 4.5** - Anthropic 最强模型，通过 Kiro 支持
- **Claude Sonnet 4/4.5** - 高性价比选择，通过 Kiro 支持
- **Gemini 3 Pro** - Google 下一代架构预览，通过 Gemini Antigravity 支持
- **Gemini 3 Flash** - 快速响应模型，通过 Gemini Antigravity 支持

---

### 交流群


![ba4727e62d27bb8fe24719bf7ae43a6d](https://github.com/user-attachments/assets/48a3e1a0-85f1-4d8d-837a-183aac0d1c7e)

---
### 联系群主
![030584c322cd8683fad1ddcc43051550](https://github.com/user-attachments/assets/708841bb-41f8-4e27-9e1a-e9a4a8ed0c00)

### 界面截图

#### 首页概览
![首页](images/home.png)

#### Kiro 账号管理
![Kiro](images/kiro.png)

#### OAuth 认证
![OAuth](images/oauth.png)

#### Gemini 管理
![Gemini](images/gemini.png)

#### Orchids 管理
![Orchids](images/Orchids%20.png)

#### AMI 管理
![AMI](images/Ami.png)

#### Vertex 管理
![Vertex](images/vertx.png)

#### Bedrock 管理
![Bedrock](images/Bedrock.png)

#### Codex 管理
![Codex](images/codex.png)

#### Grok 管理
![Grok](images/grok.png)

#### Krater 管理
![Krater](images/krater.png)

#### Direct 转发
![Direct](images/Direct.png)

#### 通道管理
![Channels](images/channels.png)

#### 邮箱管理
![Mail](images/mail.png)

#### 图片生成
![Image Gen](images/image-gen.png)

#### 使用统计
![Usage](images/usage.png)

#### 排行榜
![Ranking](images/ranking.png)

---

## 📖 支持的模型

### Kiro (Claude) 模型

| 模型名称 | 内部映射名称 | 说明 |
|---------|-------------|------|
| `claude-opus-4-5-20251101` | `claude-opus-4.5` | Anthropic 最强模型 |
| `claude-sonnet-4-20250514` | `CLAUDE_SONNET_4_20250514_V1_0` | 高性价比选择 |
| `claude-sonnet-4-5-20250929` | `CLAUDE_SONNET_4_5_20250929_V1_0` | 最新 Sonnet 版本 |
| `claude-3-7-sonnet-20250219` | `CLAUDE_3_7_SONNET_20250219_V1_0` | Claude 3.7 Sonnet |
| `claude-haiku-4-5` | `claude-haiku-4.5` | 快速响应模型 |

### Gemini 模型 (Antigravity)

| 模型名称 | 内部映射名称 | 说明 |
|---------|-------------|------|
| `gemini-3-pro-preview` | `gemini-3-pro-high` | Google 最新旗舰 |
| `gemini-3-pro-image-preview` | `gemini-3-pro-image` | 图像生成版本 |
| `gemini-3-flash-preview` | `gemini-3-flash` | 快速响应版本 |
| `gemini-2.5-flash-preview` | `gemini-2.5-flash` | 2.5 Flash 版本 |
| `gemini-2.5-computer-use-preview-10-2025` | `rev19-uic3-1p` | 计算机使用预览 |
| `gemini-claude-sonnet-4-5` | `claude-sonnet-4-5` | Claude via Gemini |
| `gemini-claude-sonnet-4-5-thinking` | `claude-sonnet-4-5-thinking` | 思考模式 |
| `gemini-claude-opus-4-5-thinking` | `claude-opus-4-5-thinking` | Opus 思考模式 |

### 模型定价参考

#### Kiro (Claude) 模型

| 模型 | 输入价格 ($/M tokens) | 输出价格 ($/M tokens) |
|------|----------------------|----------------------|
| Claude Opus 4.5 | $15 | $75 |
| Claude Sonnet 4/4.5 | $3 | $15 |
| Claude 3.7 Sonnet | $3 | $15 |
| Claude Haiku 4.5 | $0.80 | $4 |

#### Gemini 模型

| 模型 | 输入价格 ($/M tokens) | 输出价格 ($/M tokens) |
|------|----------------------|----------------------|
| Gemini 3 Pro | $1.25 | $5 |
| Gemini 3 Flash | $0.075 | $0.30 |
| Gemini 2.5 Flash | $0.075 | $0.30 |
| Gemini Claude Sonnet 4.5 | $3 | $15 |
| Gemini Claude Opus 4.5 Thinking | $15 | $75 |

---

## 🔐 认证配置指南

<details>
<summary>点击展开详细认证配置步骤</summary>

### 1. Social Auth (Google/GitHub)

使用 PKCE 流程，通过本地 HTTP 回调服务器（端口 19876-19880）完成认证。

**Web 界面认证流程：**
1. 访问 Web 管理界面 http://localhost:13003
2. 进入「Kiro 账号」页面
3. 点击「添加账号」->「OAuth 登录」
4. 选择 Google 或 GitHub 登录
5. 授权成功后自动保存凭据

**CLI 认证：**
```bash
node src/auth-cli.js
```

### 2. Builder ID

使用 Device Code Flow，通过 OIDC 轮询完成认证。

### 3. IAM Identity Center (IdC)

使用 `client_id` 和 `client_secret` 进行认证。

### 4. Gemini Antigravity OAuth

通过 Google OAuth 2.0 认证访问 Gemini Antigravity API。

**Web 界面认证流程：**
1. 访问 Web 管理界面 http://localhost:13003
2. 进入「Gemini 账号」页面
3. 点击「添加账号」->「OAuth 登录」
4. 在弹出的 Google 登录页面完成授权
5. 授权成功后自动保存凭据

**OAuth 配置信息：**

| 配置项 | 值 |
|-------|-----|
| Client ID | `1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com` |
| Scope | `https://www.googleapis.com/auth/cloud-platform` |
| 回调端口 | `8086` |
| Token 端点 | `https://oauth2.googleapis.com/token` |

</details>

---

## 🔧 API 接口文档

### 外部 API 端点（需要 API Key 认证）

通过 `X-API-Key` 或 `Authorization: Bearer <key>` 请求头传递 API 密钥。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/v1/models` | 获取模型列表（OpenAI 格式） |
| POST | `/v1/messages` | Claude API 兼容接口（支持流式） |
| POST | `/v1/chat/completions` | OpenAI API 兼容接口（支持流式） |
| POST | `/gemini-antigravity/v1/messages` | Gemini Antigravity API（Claude 格式） |

**Model-Provider 路由：** 可通过 `Model-Provider` 请求头指定 Provider：
- `gemini` 或 `gemini-antigravity`：路由到 Gemini Antigravity
- 默认：使用 Kiro/Claude Provider

### API 调用示例

**OpenAI 兼容接口：**

```bash
curl -X POST 'http://localhost:13003/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

**Claude 兼容接口：**

```bash
curl -X POST 'http://localhost:13003/v1/messages' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**Gemini Antigravity 接口：**

```bash
curl -X POST 'http://localhost:13003/gemini-antigravity/v1/messages' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{
    "model": "gemini-3-pro-preview",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

<details>
<summary>点击展开完整 API 接口列表</summary>

### 认证 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/status` | 检查系统是否需要初始化 |
| POST | `/api/auth/setup` | 初始化管理员账户 |
| POST | `/api/auth/login` | 用户登录 |
| POST | `/api/auth/logout` | 用户登出 |
| GET | `/api/auth/me` | 获取当前用户信息 |

### API 密钥管理（需要登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/keys` | 获取 API 密钥列表 |
| POST | `/api/keys` | 创建 API 密钥 |
| GET | `/api/keys/:id` | 获取单个密钥详情 |
| DELETE | `/api/keys/:id` | 删除 API 密钥 |
| POST | `/api/keys/:id/toggle` | 启用/禁用密钥 |
| PUT | `/api/keys/:id/limits` | 更新密钥限制配置 |
| GET | `/api/keys/:id/limits-status` | 获取密钥用量状态 |
| GET | `/api/keys/:id/usage` | 获取密钥用量统计 |
| GET | `/api/keys/:id/cost` | 获取密钥费用统计 |

### Kiro 凭据管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/credentials` | 获取所有凭据 |
| GET | `/api/credentials/:id` | 获取单个凭据 |
| DELETE | `/api/credentials/:id` | 删除凭据 |
| POST | `/api/credentials/:id/activate` | 设为活跃凭据 |
| POST | `/api/credentials/:id/refresh` | 手动刷新 Token |
| POST | `/api/credentials/:id/test` | 测试凭据有效性 |
| GET | `/api/credentials/:id/models` | 获取可用模型 |
| GET | `/api/credentials/:id/usage` | 获取使用量 |
| POST | `/api/credentials/import` | 从文件导入凭据 |
| POST | `/api/credentials/batch-import` | 批量导入 Social 账号 |

### Gemini 凭证管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/gemini/credentials` | 获取所有 Gemini 凭证 |
| GET | `/api/gemini/credentials/:id` | 获取单个凭证 |
| POST | `/api/gemini/credentials` | 添加凭证 |
| PUT | `/api/gemini/credentials/:id` | 更新凭证 |
| DELETE | `/api/gemini/credentials/:id` | 删除凭证 |
| POST | `/api/gemini/credentials/:id/activate` | 激活凭证 |
| POST | `/api/gemini/credentials/:id/refresh` | 刷新 Token |
| POST | `/api/gemini/credentials/:id/test` | 测试凭证 |
| GET | `/api/gemini/credentials/:id/usage` | 获取用量 |
| POST | `/api/gemini/credentials/batch-import` | 批量导入凭证 |
| POST | `/api/gemini/oauth/start` | 启动 Gemini OAuth 登录 |
| GET | `/api/gemini/models` | 获取 Gemini 模型列表 |

### API 日志管理（需要管理员权限）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logs` | 获取日志列表（分页） |
| GET | `/api/logs/:requestId` | 获取单条日志详情 |
| DELETE | `/api/logs/:id` | 删除单条日志 |
| POST | `/api/logs/cleanup` | 清理旧日志 |
| GET | `/api/error-logs` | 获取错误日志列表 |
| GET | `/api/logs-stats` | 获取日志统计信息 |
| GET | `/api/logs-stats/cost` | 获取费用统计汇总 |

### 代理配置（需要登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/proxy/config` | 获取代理配置 |
| POST | `/api/proxy/config` | 保存代理配置 |
| POST | `/api/proxy/test` | 测试代理连接 |

### 公开 API（无需登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/models` | 获取可用模型列表 |
| GET | `/api/usage` | 获取活跃凭据使用限额 |
| POST | `/api/public/usage` | 通过 API Key 查询用量 |

</details>

---

## ⚙️ 高级配置

<details>
<summary>点击展开代理配置、编程接口等高级设置</summary>

### 代理设置

系统支持 HTTP/HTTPS 代理，用于在网络受限环境下访问 API。

**通过 Web 界面配置：**
1. 访问 Web 管理界面 http://localhost:13003
2. 进入「代理设置」页面
3. 输入代理地址并启用

**支持的代理格式：**
```
# 标准 URL 格式
http://host:port
http://username:password@host:port

# ISP 格式（自动转换）
host:port:username:password
host:port
```

**环境变量代理：**
```bash
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
```

### 编程接口

```javascript
import { KiroClient, KiroAPI } from '2-api';

// 方式1: 从凭据文件创建客户端
const client = await KiroClient.fromCredentialsFile();

// 方式2: 直接创建客户端
const client = new KiroClient({
    accessToken: 'your-access-token',
    refreshToken: 'your-refresh-token',
    profileArn: 'your-profile-arn',
    region: 'us-east-1'
});

// 发送消息（流式）
const stream = await client.chatStream([
    { role: 'user', content: '你好' }
]);

for await (const chunk of stream) {
    process.stdout.write(chunk);
}

// 发送消息（非流式）
const response = await client.chat([
    { role: 'user', content: '你好' }
]);
console.log(response);
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `13003` | API 服务端口 |
| `MYSQL_HOST` | `127.0.0.1` | MySQL 主机地址 |
| `MYSQL_PORT` | `13306` | MySQL 端口 |
| `MYSQL_USER` | `root` | MySQL 用户名 |
| `MYSQL_PASSWORD` | - | MySQL 密码 |
| `MYSQL_DATABASE` | `kiro_api` | 数据库名称 |
| `LOG_DIR` | `./logs` | 日志文件目录 |
| `LOG_LEVEL` | `INFO` | 日志级别 |
| `LOG_ENABLED` | `true` | 是否启用日志 |
| `LOG_CONSOLE` | `true` | 是否输出到控制台 |

### 项目结构

```
src/
├── index.js              # 主入口，导出所有模块
├── client.js             # KiroClient 类 - API 客户端
├── api.js                # KiroAPI 类 - 无状态 API 服务
├── auth.js               # KiroAuth 类 - OAuth 认证
├── auth-cli.js           # 交互式 CLI 登录工具
├── constants.js          # 常量配置
├── db.js                 # 数据库连接和表管理
├── logger.js             # 日志模块
├── proxy.js              # 代理配置模块
├── server.js             # Express Web 服务器
├── kiro-service.js       # Kiro 服务封装
├── gemini/
│   └── antigravity-core.js  # Gemini Antigravity API 核心
└── public/               # Web 前端文件
```

</details>

---

## ❓ 常见问题

<details>
<summary>点击展开常见问题及解决方案</summary>

### 1. 端口被占用怎么办？

修改环境变量 `PORT` 或在 `.env` 文件中设置其他端口。

### 2. Docker 启动失败？

检查 Docker 是否正确安装，确保端口未被占用，查看 `docker logs` 获取详细错误信息。

### 3. 遇到 429 错误（请求过多）？

这是由于请求频率过高导致的限制。建议：
- 添加更多账号到账号池
- 降低请求频率
- 等待一段时间后重试

### 4. Token 刷新失败？

- 检查网络连接是否正常
- 确认 refresh_token 是否有效
- 查看错误凭据列表，尝试手动刷新

### 5. 如何批量导入账号？

```bash
curl -X POST 'http://localhost:13003/api/credentials/batch-import' \
  -H 'Content-Type: application/json' \
  -d '{
    "accounts": [
      {"email": "user1@example.com", "refreshToken": "aorAAAAA..."},
      {"email": "user2@example.com", "refreshToken": "aorAAAAA..."}
    ],
    "region": "us-east-1"
  }'
```

</details>

---

## 📝 注意事项

- Token 会在过期前 10 分钟自动刷新
- 刷新失败的凭据会被移至错误凭据表，并定期重试
- 消息历史要求 user/assistant 角色交替，相邻同角色消息会自动合并
- 默认区域为 `us-east-1`

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=CaiGaoQing/2-api&type=date&legend=top-left)](https://www.star-history.com/#CaiGaoQing/2-api&type=date&legend=top-left)

---

## 🙏 特别鸣谢

- [AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) - 项目灵感来源

---

## 📄 开源许可

本项目遵循 [MIT](https://opensource.org/licenses/MIT) 许可证。

---

## ⚠️ 免责声明

本项目仅供学习和研究使用。使用本项目时，请遵守相关服务的使用条款和法律法规。开发者不对因使用本项目而产生的任何问题负责。

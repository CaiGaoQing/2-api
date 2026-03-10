# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kiro API Client - A Node.js client for accessing Claude models via AWS CodeWhisperer/Kiro API. Provides OAuth authentication (Google, GitHub, AWS Builder ID, AWS IAM Identity Center) and a web-based credential management interface.

## Commands

```bash
# Start the web management interface (port 3000)
npm run server

# Run API test script
npm test

# Direct entry point
npm start
```

## Architecture

### Core Modules

- **src/index.js** - Main entry point, exports: `KiroClient` (default), `KiroAuth`, `KiroAPI`, `KIRO_CONSTANTS`, `KIRO_MODELS`, `MODEL_MAPPING`, `KIRO_OAUTH_CONFIG`

- **src/client.js** - `KiroClient` class: Main API client for Claude model interactions
  - Handles chat requests (streaming and non-streaming)
  - AWS Event Stream parsing for responses
  - Automatic retry with exponential backoff (429, 5xx errors)
  - Factory methods: `fromCredentialsFile()`, `fromDatabase()`, `fromDatabaseById()`, `fromDatabaseByName()`

- **src/api.js** - `KiroAPI` class: Unified stateless API service
  - `refreshToken()` / `batchRefreshToken()` - Token refresh for all auth methods
  - `chat()` / `chatStream()` - Non-streaming and streaming chat
  - `getUsageLimits()` / `listModels()` - Usage and model queries
  - `isTokenExpiringSoon()` - Token expiration check (default 10 min threshold)

- **src/auth.js** - `KiroAuth` class: OAuth authentication
  - Social Auth (Google/GitHub): PKCE flow with local HTTP callback server (ports 19876-19880)
  - Builder ID: Device Code Flow with OIDC polling
  - Credentials saved to `~/.kiro/oauth_creds.json`

- **src/auth-cli.js** - Interactive CLI for OAuth login (`node src/auth-cli.js`)

- **src/db.js** - `CredentialStore` class: SQLite credential management (sql.js)
  - Database stored at `data/kiro.db`
  - Two tables: `credentials` (active) and `error_credentials` (failed refresh)
  - Automatic migration of failed credentials with retry mechanism

- **src/server.js** - Express web server for credential management
  - REST API at `/api/*` for CRUD operations
  - SSE streaming for chat endpoints (`/api/chat/:id`)
  - Background tasks: credential refresh every 5 min, error credential retry every 10 min

- **src/logger.js** - Unified logging module
  - Per-module log files: `logs/{module}-YYYY-MM-DD.log`
  - Modules: api, client, auth, db, server, token
  - Usage: `import { logger } from './logger.js'; logger.api.info('message')`

- **src/constants.js** - API endpoints, model mappings, OAuth config

### Authentication Methods

1. **Social Auth** (`authMethod: 'social'`): Uses `profileArn` for API calls, refreshes via Kiro auth service
2. **Builder ID** (`authMethod: 'builder-id'`): Uses `clientId`/`clientSecret`, refreshes via `oidc.amazonaws.com`
3. **IAM Identity Center** (`authMethod: 'IdC'`): Uses `clientId`/`clientSecret`, refreshes via `sso-oidc.amazonaws.com`

### Model Mapping

Models are mapped to internal CodeWhisperer names in `MODEL_MAPPING`:
- `claude-sonnet-4-20250514` → `CLAUDE_SONNET_4_20250514_V1_0`
- `claude-opus-4-5-20251101` → `claude-opus-4.5`
- etc.

### Web Server REST API

- `GET/POST/PUT/DELETE /api/credentials` - Credential CRUD
- `POST /api/credentials/:id/activate` - Set active credential
- `POST /api/credentials/:id/refresh` - Manual token refresh
- `POST /api/credentials/:id/test` - Test credential validity
- `POST /api/credentials/batch-import` - Batch import Google/Social accounts
- `GET /api/credentials/:id/models` - List available models
- `GET /api/credentials/:id/usage` - Get usage limits
- `POST /api/chat/:id` - SSE streaming chat
- `POST /api/chat/:id/sync` - Non-streaming chat
- `GET/DELETE /api/error-credentials` - Manage failed credentials
- `POST /api/error-credentials/:id/refresh` - Retry failed credential

### API Endpoints (configured in constants.js)

All endpoints use `{{region}}` placeholder (default: `us-east-1`):
- Chat: `https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse`
- Token refresh (Social): `https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken`
- Token refresh (Builder ID): `https://oidc.{{region}}.amazonaws.com/token`
- Token refresh (IdC): `https://sso-oidc.{{region}}.amazonaws.com/token`

### Token Refresh Examples

**Social Auth (Google/GitHub)** - 只需传递 `refreshToken`:
```bash
curl -X POST 'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"YOUR_REFRESH_TOKEN"}'
```

**Builder ID / IdC** - 需要 `client_id`, `client_secret`, `refresh_token`:
```bash
curl -X POST 'https://oidc.us-east-1.amazonaws.com/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=refresh_token&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&refresh_token=YOUR_REFRESH_TOKEN'
```

### Batch Import Example

批量导入 Google/Social 账号:
```bash
curl -X POST 'http://localhost:3000/api/credentials/batch-import' \
  -H 'Content-Type: application/json' \
  -d '{
    "accounts": [
      {"email": "user1@example.com", "refreshToken": "aorAAAAA..."},
      {"email": "user2@example.com", "refreshToken": "aorAAAAA..."}
    ],
    "region": "us-east-1"
  }'
```

## Key Implementation Details

- ES Modules (`"type": "module"` in package.json)
- Message history requires alternating user/assistant roles; adjacent same-role messages are auto-merged
- AWS Event Stream responses parsed with bracket-counting JSON extraction
- Credentials with failed token refresh are moved to `error_credentials` table and retried periodically
- Token auto-refresh triggers 10 minutes before expiration

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_DIR` | `./logs` | Log file directory |
| `LOG_LEVEL` | `INFO` | Log level: DEBUG, INFO, WARN, ERROR |
| `LOG_ENABLED` | `true` | Set to `false` to disable logging |
| `LOG_CONSOLE` | `true` | Set to `false` to disable console output |

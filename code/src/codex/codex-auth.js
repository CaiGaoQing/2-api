/**
 * Codex OAuth 认证模块
 * 实现 OAuth2 + PKCE 流程
 */
import http from 'http';
import crypto from 'crypto';
import axios from 'axios';
import { logger } from '../logger.js';
import { getAxiosProxyConfig } from '../proxy.js';

const log = logger.server;

/**
 * Codex OAuth 配置
 */
export const CODEX_OAUTH_CONFIG = {
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    redirectUri: 'http://localhost:1455/auth/callback',
    port: 1455,
    scopes: 'openid email profile offline_access',
    logPrefix: '[Codex Auth]'
};

// 活动的服务器实例管理
const activeServers = new Map();

/**
 * 关闭指定端口的活动服务器
 */
async function closeActiveServer(provider, port = null) {
    const existing = activeServers.get(provider);
    if (existing) {
        await new Promise((resolve) => {
            existing.server.close(() => {
                activeServers.delete(provider);
                log.info(`${CODEX_OAUTH_CONFIG.logPrefix} 已关闭提供商 ${provider} 的旧服务器`);
                resolve();
            });
        });
    }

    if (port) {
        for (const [p, info] of activeServers.entries()) {
            if (info.port === port) {
                await new Promise((resolve) => {
                    info.server.close(() => {
                        activeServers.delete(p);
                        log.info(`${CODEX_OAUTH_CONFIG.logPrefix} 已关闭端口 ${port} 上的旧服务器`);
                        resolve();
                    });
                });
            }
        }
    }
}

/**
 * Codex OAuth 认证类
 */
export class CodexAuth {
    constructor(proxyConfig = null) {
        const axiosConfig = { timeout: 30000 };

        if (proxyConfig) {
            axiosConfig.httpAgent = proxyConfig.httpAgent;
            axiosConfig.httpsAgent = proxyConfig.httpsAgent;
            log.info(`${CODEX_OAUTH_CONFIG.logPrefix} 代理已启用`);
        }

        this.httpClient = axios.create(axiosConfig);
        this.server = null;
    }

    /**
     * 生成 PKCE 代码
     */
    generatePKCECodes() {
        const verifier = crypto.randomBytes(96).toString('base64url');
        const challenge = crypto.createHash('sha256')
            .update(verifier)
            .digest('base64url');
        return { verifier, challenge };
    }

    /**
     * 生成授权 URL
     */
    async generateAuthUrl() {
        const pkce = this.generatePKCECodes();
        const state = crypto.randomBytes(16).toString('hex');

        log.info(`${CODEX_OAUTH_CONFIG.logPrefix} 生成授权 URL...`);

        const server = await this.startCallbackServer();
        this.server = server;

        const authUrl = new URL(CODEX_OAUTH_CONFIG.authUrl);
        authUrl.searchParams.set('client_id', CODEX_OAUTH_CONFIG.clientId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', CODEX_OAUTH_CONFIG.redirectUri);
        authUrl.searchParams.set('scope', CODEX_OAUTH_CONFIG.scopes);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', pkce.challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('prompt', 'login');

        return { authUrl: authUrl.toString(), state, pkce, server };
    }

    /**
     * 启动回调服务器
     */
    async startCallbackServer() {
        await closeActiveServer('codex-oauth', CODEX_OAUTH_CONFIG.port);

        return new Promise((resolve, reject) => {
            const server = http.createServer();

            server.on('request', (req, res) => {
                if (req.url.startsWith('/auth/callback')) {
                    const url = new URL(req.url, `http://localhost:${CODEX_OAUTH_CONFIG.port}`);
                    const code = url.searchParams.get('code');
                    const state = url.searchParams.get('state');
                    const error = url.searchParams.get('error');

                    if (error) {
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(`<h1>认证失败</h1><p>${error}</p>`);
                        server.emit('auth-error', new Error(error));
                    } else if (code && state) {
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(`<h1>认证成功!</h1><p>您可以关闭此窗口。</p>`);
                        server.emit('auth-success', { code, state });
                    }
                }
            });

            server.listen(CODEX_OAUTH_CONFIG.port, () => {
                log.info(`${CODEX_OAUTH_CONFIG.logPrefix} 回调服务器启动在端口 ${CODEX_OAUTH_CONFIG.port}`);
                activeServers.set('codex-oauth', { server, port: CODEX_OAUTH_CONFIG.port });
                resolve(server);
            });

            server.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    reject(new Error(`端口 ${CODEX_OAUTH_CONFIG.port} 已被占用`));
                } else {
                    reject(error);
                }
            });
        });
    }

    /**
     * 用授权码换取 tokens
     */
    async exchangeCodeForTokens(code, codeVerifier) {
        log.info(`${CODEX_OAUTH_CONFIG.logPrefix} 交换授权码...`);

        try {
            const response = await this.httpClient.post(
                CODEX_OAUTH_CONFIG.tokenUrl,
                new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: CODEX_OAUTH_CONFIG.clientId,
                    code: code,
                    redirect_uri: CODEX_OAUTH_CONFIG.redirectUri,
                    code_verifier: codeVerifier
                }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            log.error(`${CODEX_OAUTH_CONFIG.logPrefix} Token 交换失败:`, error.message);
            throw new Error(`Token 交换失败: ${error.response?.data?.error_description || error.message}`);
        }
    }

    /**
     * 刷新 tokens
     */
    async refreshTokens(refreshToken) {
        log.info(`${CODEX_OAUTH_CONFIG.logPrefix} 刷新 Token...`);

        try {
            const response = await this.httpClient.post(
                CODEX_OAUTH_CONFIG.tokenUrl,
                new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: CODEX_OAUTH_CONFIG.clientId,
                    refresh_token: refreshToken
                }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    }
                }
            );

            const tokens = response.data;
            const claims = this.parseJWT(tokens.id_token);

            return {
                idToken: tokens.id_token,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token || refreshToken,
                accountId: claims['https://api.openai.com/auth']?.chatgpt_account_id || claims.sub,
                email: claims.email,
                expiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000)
            };
        } catch (error) {
            log.error(`${CODEX_OAUTH_CONFIG.logPrefix} Token 刷新失败:`, error.message);
            throw new Error(`Token 刷新失败: ${error.response?.data?.error_description || error.message}`);
        }
    }

    /**
     * 解析 JWT token
     */
    parseJWT(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) {
                throw new Error('无效的 JWT 格式');
            }
            const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
            return JSON.parse(payload);
        } catch (error) {
            log.error(`${CODEX_OAUTH_CONFIG.logPrefix} JWT 解析失败:`, error.message);
            throw new Error(`JWT 解析失败: ${error.message}`);
        }
    }

    /**
     * 完成 OAuth 流程
     */
    async completeOAuthFlow(code, state, expectedState, pkce) {
        if (state !== expectedState) {
            throw new Error('State 不匹配，可能存在 CSRF 攻击');
        }

        const tokens = await this.exchangeCodeForTokens(code, pkce.verifier);
        const claims = this.parseJWT(tokens.id_token);

        const credentials = {
            idToken: tokens.id_token,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            accountId: claims['https://api.openai.com/auth']?.chatgpt_account_id || claims.sub,
            email: claims.email,
            expiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000)
        };

        if (this.server) {
            this.server.close();
            this.server = null;
        }

        log.info(`${CODEX_OAUTH_CONFIG.logPrefix} 认证成功! Email: ${credentials.email}`);
        return credentials;
    }
}

// OAuth 会话存储
const oauthSessions = new Map();

/**
 * 启动 Codex OAuth 流程
 */
export async function startCodexOAuth(proxyConfig = null) {
    const auth = new CodexAuth(proxyConfig);

    try {
        // 清理旧会话
        for (const [sessionId, session] of oauthSessions.entries()) {
            if (session.pollTimer) clearInterval(session.pollTimer);
            oauthSessions.delete(sessionId);
        }

        const { authUrl, state, pkce, server } = await auth.generateAuthUrl();

        const session = { auth, state, pkce, server, createdAt: Date.now() };
        oauthSessions.set(state, session);

        // 监听回调成功事件，自动完成 OAuth 流程并保存凭证
        server.on('auth-success', async ({ code, state: callbackState }) => {
            try {
                log.info(`${CODEX_OAUTH_CONFIG.logPrefix} 收到回调，正在完成 OAuth 流程...`);
                const credentials = await completeCodexOAuth(code, callbackState);

                // 延迟导入避免循环依赖
                const { CodexCredentialStore } = await import('../db.js');

                // 保存到数据库
                const store = await CodexCredentialStore.create();
                const name = credentials.email || `codex-${Date.now()}`;

                // 检查是否已存在
                let existing = await store.getByEmail(credentials.email);
                if (existing) {
                    await store.updateTokens(existing.id, credentials);
                    log.info(`${CODEX_OAUTH_CONFIG.logPrefix} 凭证已更新: ${credentials.email}`);
                } else {
                    const id = await store.create({
                        name,
                        email: credentials.email,
                        accountId: credentials.accountId,
                        accessToken: credentials.accessToken,
                        refreshToken: credentials.refreshToken,
                        idToken: credentials.idToken,
                        expiresAt: credentials.expiresAt
                    });
                    log.info(`${CODEX_OAUTH_CONFIG.logPrefix} 凭证已保存: ${credentials.email}, ID: ${id}`);
                }
            } catch (error) {
                log.error(`${CODEX_OAUTH_CONFIG.logPrefix} 自动保存凭证失败:`, error.message);
            }
        });

        // 设置超时清理
        setTimeout(() => {
            if (oauthSessions.has(state)) {
                oauthSessions.delete(state);
                if (server) server.close();
            }
        }, 10 * 60 * 1000); // 10 分钟超时

        return {
            success: true,
            authUrl,
            sessionId: state,
            port: CODEX_OAUTH_CONFIG.port
        };
    } catch (error) {
        log.error(`${CODEX_OAUTH_CONFIG.logPrefix} 启动 OAuth 失败:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * 完成 Codex OAuth 回调
 */
export async function completeCodexOAuth(code, state) {
    const session = oauthSessions.get(state);
    if (!session) {
        throw new Error('无效或过期的 OAuth 会话');
    }

    try {
        const credentials = await session.auth.completeOAuthFlow(
            code, state, session.state, session.pkce
        );
        oauthSessions.delete(state);
        return credentials;
    } catch (error) {
        oauthSessions.delete(state);
        throw error;
    }
}

/**
 * 刷新 Codex Token（带重试）
 */
export async function refreshCodexToken(refreshToken, proxyConfig = null, maxRetries = 3) {
    const auth = new CodexAuth(proxyConfig);
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await auth.refreshTokens(refreshToken);
        } catch (error) {
            lastError = error;
            log.warn(`${CODEX_OAUTH_CONFIG.logPrefix} 重试 ${i + 1}/${maxRetries} 失败:`, error.message);
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
            }
        }
    }
    throw lastError;
}

export default CodexAuth;
/**
 * Outlook 邮件操作模块
 * 
 * 通过 OAuth2 + IMAP 连接 Outlook 邮箱，支持：
 * - 获取邮件列表
 * - 查看邮件内容
 * - 删除单封邮件
 * - 删除全部邮件
 * 
 * 认证方式：refresh_token → access_token → XOAUTH2 IMAP
 */

import { ImapFlow } from 'imapflow';
import axios from 'axios';

const DEFAULT_CLIENT_ID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';

/**
 * 用 refresh_token 换取 access_token（Microsoft OAuth2）
 */
async function getAccessToken(refreshToken, clientId = DEFAULT_CLIENT_ID) {
    const resp = await axios.post(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
        }).toString(),
        {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000,
        }
    );
    return resp.data.access_token;
}

/**
 * 创建 IMAP 连接（XOAUTH2 认证）
 */
async function createImapClient(email, accessToken) {
    const client = new ImapFlow({
        host: 'outlook.office365.com',
        port: 993,
        secure: true,
        auth: {
            user: email,
            accessToken: accessToken,
        },
        logger: false,
    });
    await client.connect();
    return client;
}

/**
 * 解析邮件地址
 */
function parseAddress(addrList) {
    if (!addrList || !Array.isArray(addrList)) return '';
    return addrList.map(a => {
        if (a.name && a.address) return `${a.name} <${a.address}>`;
        return a.address || a.name || '';
    }).join(', ');
}

/**
 * 获取邮件列表
 * @param {string} email - 邮箱地址
 * @param {string} refreshToken - OAuth2 refresh token
 * @param {string} clientId - OAuth2 client ID
 * @param {string} folder - 文件夹（INBOX / Junk）
 * @param {number} limit - 最多返回条数
 * @returns {Array} 邮件列表
 */
export async function fetchMailList(email, refreshToken, clientId, folder = 'INBOX', limit = 50) {
    const accessToken = await getAccessToken(refreshToken, clientId || DEFAULT_CLIENT_ID);
    const client = await createImapClient(email, accessToken);

    try {
        await client.mailboxOpen(folder);

        // 获取邮箱状态
        const status = await client.status(folder, { messages: true, unseen: true });

        const mails = [];
        const totalMessages = status.messages || 0;
        if (totalMessages === 0) {
            return { mails: [], total: 0, unseen: 0 };
        }

        // 从最新的开始取，取 limit 条
        const startSeq = Math.max(1, totalMessages - limit + 1);
        const range = `${startSeq}:${totalMessages}`;

        for await (const msg of client.fetch(range, {
            envelope: true,
            flags: true,
            bodyStructure: true,
            uid: true,
        })) {
            const env = msg.envelope || {};
            mails.push({
                uid: msg.uid,
                seq: msg.seq,
                subject: env.subject || '(无主题)',
                from: parseAddress(env.from),
                to: parseAddress(env.to),
                date: env.date ? new Date(env.date).toISOString() : null,
                flags: Array.from(msg.flags || []),
                seen: msg.flags?.has('\\Seen') || false,
            });
        }

        // 按日期倒序
        mails.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        return { mails, total: totalMessages, unseen: status.unseen || 0 };
    } finally {
        await client.logout();
    }
}

/**
 * 获取邮件内容
 * @param {string} email - 邮箱地址
 * @param {string} refreshToken - OAuth2 refresh token
 * @param {string} clientId - OAuth2 client ID
 * @param {number} uid - 邮件 UID
 * @param {string} folder - 文件夹
 * @returns {Object} 邮件详情
 */
export async function fetchMailContent(email, refreshToken, clientId, uid, folder = 'INBOX') {
    const accessToken = await getAccessToken(refreshToken, clientId || DEFAULT_CLIENT_ID);
    const client = await createImapClient(email, accessToken);

    try {
        await client.mailboxOpen(folder);

        const msg = await client.fetchOne(uid, {
            envelope: true,
            source: true,
            flags: true,
        }, { uid: true });

        if (!msg) {
            throw new Error('邮件不存在');
        }

        const env = msg.envelope || {};
        let body = '';
        let htmlBody = '';

        if (msg.source) {
            const raw = msg.source.toString('utf-8');
            // 简单提取文本内容
            body = extractTextFromSource(raw);
            htmlBody = extractHtmlFromSource(raw);
        }

        return {
            uid: msg.uid,
            subject: env.subject || '(无主题)',
            from: parseAddress(env.from),
            to: parseAddress(env.to),
            date: env.date ? new Date(env.date).toISOString() : null,
            flags: Array.from(msg.flags || []),
            body: body,
            html: htmlBody,
        };
    } finally {
        await client.logout();
    }
}

/**
 * 从邮件原始内容提取纯文本
 */
function extractTextFromSource(source) {
    // 尝试提取 text/plain 部分
    const plainMatch = source.match(/Content-Type:\s*text\/plain[^]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\n\.\r\n|$)/i);
    if (plainMatch) {
        return decodeContent(plainMatch[1], source);
    }
    // 如果只有 HTML，去标签
    const htmlMatch = source.match(/Content-Type:\s*text\/html[^]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\n\.\r\n|$)/i);
    if (htmlMatch) {
        return stripHtml(decodeContent(htmlMatch[1], source));
    }
    // 兜底：取 body 部分
    const bodyStart = source.indexOf('\r\n\r\n');
    if (bodyStart > -1) {
        const rawBody = source.substring(bodyStart + 4, bodyStart + 5000);
        return stripHtml(rawBody).substring(0, 2000);
    }
    return '';
}

/**
 * 从邮件原始内容提取 HTML
 */
function extractHtmlFromSource(source) {
    const htmlMatch = source.match(/Content-Type:\s*text\/html[^]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\n\.\r\n|$)/i);
    if (htmlMatch) {
        return decodeContent(htmlMatch[1], source);
    }
    return '';
}

/**
 * 解码 MIME 内容（处理 base64 和 quoted-printable）
 */
function decodeContent(content, fullSource) {
    // 检查是否是 base64
    if (/Content-Transfer-Encoding:\s*base64/i.test(fullSource)) {
        try {
            return Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf-8');
        } catch { }
    }
    // 检查是否是 quoted-printable
    if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(fullSource)) {
        return content
            .replace(/=\r?\n/g, '')
            .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
    return content;
}

/**
 * 去除 HTML 标签
 */
function stripHtml(html) {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 删除单封邮件
 * @param {string} email - 邮箱地址
 * @param {string} refreshToken - OAuth2 refresh token
 * @param {string} clientId - OAuth2 client ID
 * @param {number} uid - 邮件 UID
 * @param {string} folder - 文件夹
 */
export async function deleteMail(email, refreshToken, clientId, uid, folder = 'INBOX') {
    const accessToken = await getAccessToken(refreshToken, clientId || DEFAULT_CLIENT_ID);
    const client = await createImapClient(email, accessToken);

    try {
        await client.mailboxOpen(folder);
        await client.messageDelete(uid, { uid: true });
        return { success: true };
    } finally {
        await client.logout();
    }
}

/**
 * 删除全部邮件
 * @param {string} email - 邮箱地址
 * @param {string} refreshToken - OAuth2 refresh token
 * @param {string} clientId - OAuth2 client ID
 * @param {string} folder - 文件夹
 */
export async function deleteAllMails(email, refreshToken, clientId, folder = 'INBOX') {
    const accessToken = await getAccessToken(refreshToken, clientId || DEFAULT_CLIENT_ID);
    const client = await createImapClient(email, accessToken);

    try {
        await client.mailboxOpen(folder);
        const status = await client.status(folder, { messages: true });

        if (status.messages === 0) {
            return { success: true, deleted: 0 };
        }

        // 删除所有邮件
        await client.messageDelete('1:*', { uid: false });
        return { success: true, deleted: status.messages };
    } finally {
        await client.logout();
    }
}

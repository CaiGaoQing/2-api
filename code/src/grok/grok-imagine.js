/**
 * Grok Imagine WebSocket 图片生成服务
 * 移植自 grok2api-main/app/services/reverse/ws_imagine.py
 * 
 * 通过 WebSocket 连接 wss://grok.com/ws/imagine/listen 生成图片
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const WS_IMAGINE_URL = 'wss://grok.com/ws/imagine/listen';

// 图片质量阈值（字节）
const MEDIUM_MIN_BYTES = 30000;
const FINAL_MIN_BYTES = 100000;

/**
 * 构建 WebSocket 请求消息
 */
function buildRequestMessage(requestId, prompt, aspectRatio, enableNsfw) {
    return {
        type: 'conversation.item.create',
        timestamp: Date.now(),
        item: {
            type: 'message',
            content: [{
                requestId,
                text: prompt,
                type: 'input_text',
                properties: {
                    section_count: 0,
                    is_kids_mode: false,
                    enable_nsfw: enableNsfw,
                    skip_upsampler: false,
                    is_initial: false,
                    aspect_ratio: aspectRatio,
                },
            }],
        },
    };
}

/**
 * 解析图片 URL 中的 ID 和扩展名
 */
function parseImageUrl(url) {
    if (!url) return { imageId: null, ext: null };
    const match = url.match(/\/images\/([a-f0-9-]+)\.(png|jpg|jpeg)/);
    if (!match) return { imageId: crypto.randomUUID().replace(/-/g, ''), ext: null };
    return { imageId: match[1], ext: match[2].toLowerCase() };
}

/**
 * 判断是否为最终高质量图片
 */
function isFinalImage(url, blobSize) {
    const urlLower = (url || '').toLowerCase();
    if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) return true;
    return blobSize > FINAL_MIN_BYTES;
}

/**
 * 分类图片质量
 */
function classifyImage(url, blob) {
    if (!url || !blob) return null;
    const { imageId, ext } = parseImageUrl(url);
    const blobSize = blob.length;
    const final = isFinalImage(url, blobSize);
    const stage = final ? 'final' : (blobSize > MEDIUM_MIN_BYTES ? 'medium' : 'preview');

    return {
        type: 'image',
        imageId: imageId || crypto.randomUUID().replace(/-/g, ''),
        ext,
        stage,
        blob,
        blobSize,
        url,
        isFinal: final,
    };
}

/**
 * 去除 base64 前缀
 */
function stripBase64(blob) {
    if (!blob) return '';
    if (blob.includes(',') && blob.split(',', 1)[0].includes('base64')) {
        return blob.split(',').slice(1).join(',');
    }
    return blob;
}

/**
 * 通过 Python 脚本执行 WebSocket 图片生成
 * 因为 Node.js ws 库也会被 Cloudflare TLS 指纹检测拦截
 * 使用 Python aiohttp + curl_cffi cookies 来绕过
 */
export async function generateImage(ssoToken, prompt, options = {}) {
    const {
        aspectRatio = '1:1',
        n = 1,
        enableNsfw = true,
        timeout = 60,
        proxyUrl = '',
        cfClearance = '',
        userAgent = '',
        browser = 'chrome136',
    } = options;

    const pythonBin = process.env.GROK_PYTHON_PATH || 'python3';
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const scriptPath = path.join(__dirname, 'grok_imagine.py');

    const input = JSON.stringify({
        sso_token: ssoToken,
        prompt,
        aspect_ratio: aspectRatio,
        n,
        enable_nsfw: enableNsfw,
        timeout,
        proxy: proxyUrl,
        cf_clearance: cfClearance,
        user_agent: userAgent,
        browser,
    });

    return new Promise((resolve, reject) => {
        const proc = spawn(pythonBin, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        proc.stdin.write(input);
        proc.stdin.end();

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        proc.on('error', (err) => {
            reject(new Error(`Python grok_imagine 进程错误: ${err.message}`));
        });

        proc.on('close', (code) => {
            if (code !== 0 && !stdout) {
                return reject(new Error(`Python grok_imagine 退出码 ${code}: ${stderr.substring(0, 300)}`));
            }

            let result;
            try {
                result = JSON.parse(stdout);
            } catch (e) {
                return reject(new Error(`Python grok_imagine 输出解析失败: ${stdout.substring(0, 300)}`));
            }

            if (result.error) {
                const error = new Error(result.error);
                error.status = result.status || 502;
                error.errorCode = result.error_code || 'upstream_error';
                return reject(error);
            }

            // result.images = [{ blob, url, image_id, is_final, ext }]
            resolve(result.images || []);
        });

        // 超时保护
        setTimeout(() => {
            try { proc.kill('SIGTERM'); } catch (e) { /* ignore */ }
        }, (timeout + 30) * 1000);
    });
}

/**
 * 将 size 字符串转为 aspect_ratio
 */
export function sizeToAspectRatio(size) {
    if (!size) return '1:1';
    const map = {
        '1024x1024': '1:1',
        '1:1': '1:1',
        '1024x1792': '9:16',
        '9:16': '9:16',
        '1792x1024': '16:9',
        '16:9': '16:9',
        '2:3': '2:3',
        '3:2': '3:2',
        '4:3': '4:3',
        '3:4': '3:4',
    };
    return map[size] || '1:1';
}

export default { generateImage, sizeToAspectRatio };

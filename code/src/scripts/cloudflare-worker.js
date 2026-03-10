// Firebase Auth 代理 Worker
// 解决国内无法直连 Firebase 的问题

const FIREBASE_BASE_URL = 'https://identitytoolkit.googleapis.com/v1/accounts';

export default {
  async fetch(request, env, ctx) {
    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Firebase-Action, X-Firebase-Api-Key',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    try {
      // 获取请求头中的 Firebase 配置
      const action = request.headers.get('X-Firebase-Action') || 'signInWithPassword';
      const apiKey = request.headers.get('X-Firebase-Api-Key');

      if (!apiKey) {
        return new Response(JSON.stringify({ error: { message: 'Missing X-Firebase-Api-Key header' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 构建 Firebase URL
      const firebaseUrl = `${FIREBASE_BASE_URL}:${action}?key=${apiKey}`;

      // 转发请求到 Firebase
      const body = await request.text();
      const response = await fetch(firebaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: body,
      });

      // 返回 Firebase 响应
      const responseData = await response.text();
      return new Response(responseData, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: { message: error.message } }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
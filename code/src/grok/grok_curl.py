#!/usr/bin/env python3
"""
Grok curl_cffi 桥接脚本
Node.js 通过子进程调用此脚本发送 HTTP 请求，绕过 Cloudflare TLS 指纹检测

用法: echo '{"url":"...","headers":{...},"body":"..."}' | python3 grok_curl.py
输入: JSON（stdin），包含 url, headers, body, proxy(可选), timeout(可选)
输出: JSON（stdout），包含 status, body, error(可选)
"""

import sys
import json

def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"status": 0, "body": "", "error": f"Invalid input: {e}"}))
        sys.exit(1)

    url = input_data.get("url", "")
    headers = input_data.get("headers", {})
    body = input_data.get("body", "")
    proxy = input_data.get("proxy", "")
    timeout = input_data.get("timeout", 120)
    impersonate = input_data.get("impersonate", "chrome136")

    try:
        from curl_cffi.requests import Session

        proxies = {"http": proxy, "https": proxy} if proxy else None

        with Session(impersonate=impersonate) as s:
            r = s.post(
                url,
                headers=headers,
                data=body.encode("utf-8") if isinstance(body, str) else body,
                timeout=timeout,
                proxies=proxies,
            )

        print(json.dumps({
            "status": r.status_code,
            "body": r.text,
        }))

    except Exception as e:
        print(json.dumps({
            "status": 0,
            "body": "",
            "error": str(e),
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()

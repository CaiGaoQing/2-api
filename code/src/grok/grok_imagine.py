#!/usr/bin/env python3
"""
Grok Imagine WebSocket 图片生成桥接脚本
Node.js 通过子进程调用此脚本，连接 wss://grok.com/ws/imagine/listen 生成图片

用法: echo '{"sso_token":"...","prompt":"..."}' | python3 grok_imagine.py
输入: JSON（stdin）
输出: JSON（stdout），包含 images 数组或 error
"""

import sys
import json
import asyncio
import time
import uuid
import re

WS_IMAGINE_URL = "wss://grok.com/ws/imagine/listen"
MEDIUM_MIN_BYTES = 30000
FINAL_MIN_BYTES = 100000


def build_ws_headers(sso_token, cf_clearance="", user_agent=""):
    if not user_agent:
        user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"

    cookie = f"sso={sso_token}; sso-rw={sso_token}"
    if cf_clearance:
        cookie += f"; cf_clearance={cf_clearance}"

    return {
        "Origin": "https://grok.com",
        "User-Agent": user_agent,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Cookie": cookie,
    }


def build_request_message(request_id, prompt, aspect_ratio, enable_nsfw):
    return {
        "type": "conversation.item.create",
        "timestamp": int(time.time() * 1000),
        "item": {
            "type": "message",
            "content": [{
                "requestId": request_id,
                "text": prompt,
                "type": "input_text",
                "properties": {
                    "section_count": 0,
                    "is_kids_mode": False,
                    "enable_nsfw": enable_nsfw,
                    "skip_upsampler": False,
                    "is_initial": False,
                    "aspect_ratio": aspect_ratio,
                },
            }],
        },
    }


def parse_image_url(url):
    if not url:
        return None, None
    match = re.search(r"/images/([a-f0-9-]+)\.(png|jpg|jpeg)", url)
    if not match:
        return None, None
    return match.group(1), match.group(2).lower()


def is_final_image(url, blob_size):
    url_lower = (url or "").lower()
    if url_lower.endswith((".jpg", ".jpeg")):
        return True
    return blob_size > FINAL_MIN_BYTES


def classify_image(url, blob):
    if not url or not blob:
        return None
    image_id, ext = parse_image_url(url)
    image_id = image_id or uuid.uuid4().hex
    blob_size = len(blob)
    final = is_final_image(url, blob_size)
    stage = "final" if final else ("medium" if blob_size > MEDIUM_MIN_BYTES else "preview")
    return {
        "type": "image",
        "image_id": image_id,
        "ext": ext,
        "stage": stage,
        "blob": blob,
        "blob_size": blob_size,
        "url": url,
        "is_final": final,
    }


def pick_best(existing, incoming):
    if not existing:
        return incoming
    if incoming.get("is_final") and not existing.get("is_final"):
        return incoming
    if existing.get("is_final") and not incoming.get("is_final"):
        return existing
    if incoming.get("blob_size", 0) > existing.get("blob_size", 0):
        return incoming
    return existing


async def generate_images(config):
    import aiohttp

    sso_token = config["sso_token"]
    prompt = config["prompt"]
    aspect_ratio = config.get("aspect_ratio", "1:1")
    n = config.get("n", 1)
    enable_nsfw = config.get("enable_nsfw", True)
    timeout_sec = config.get("timeout", 60)
    proxy = config.get("proxy", "")
    cf_clearance = config.get("cf_clearance", "")
    user_agent = config.get("user_agent", "")

    headers = build_ws_headers(sso_token, cf_clearance, user_agent)
    request_id = str(uuid.uuid4())

    connector = None
    if proxy:
        try:
            from aiohttp_socks import ProxyConnector
            connector = ProxyConnector.from_url(proxy)
        except ImportError:
            connector = aiohttp.TCPConnector()
    else:
        connector = aiohttp.TCPConnector()

    client_timeout = aiohttp.ClientTimeout(total=timeout_sec)
    session = aiohttp.ClientSession(connector=connector, timeout=client_timeout)

    try:
        ws = await session.ws_connect(
            WS_IMAGINE_URL,
            headers=headers,
            heartbeat=20,
            receive_timeout=timeout_sec,
        )
    except Exception as e:
        await session.close()
        status = getattr(e, "status", None)
        return {
            "error": f"WebSocket connect failed: {e}",
            "error_code": "rate_limit_exceeded" if status == 429 else "connection_failed",
            "status": status or 502,
        }

    try:
        message = build_request_message(request_id, prompt, aspect_ratio, enable_nsfw)
        await ws.send_json(message)

        images = {}
        final_ids = set()
        completed = 0
        start_time = last_activity = time.monotonic()
        medium_received_time = None
        final_timeout = 15.0
        blocked_grace = min(10.0, final_timeout)

        while time.monotonic() - start_time < timeout_sec:
            try:
                ws_msg = await asyncio.wait_for(ws.receive(), timeout=5.0)
            except asyncio.TimeoutError:
                now = time.monotonic()
                if medium_received_time and completed == 0 and now - medium_received_time > blocked_grace:
                    break
                if completed > 0 and now - last_activity > 10:
                    break
                continue

            if ws_msg.type == aiohttp.WSMsgType.TEXT:
                last_activity = time.monotonic()
                try:
                    msg = json.loads(ws_msg.data)
                except json.JSONDecodeError:
                    continue

                msg_type = msg.get("type")

                if msg_type == "image":
                    info = classify_image(msg.get("url", ""), msg.get("blob", ""))
                    if not info:
                        continue

                    image_id = info["image_id"]
                    if info["stage"] == "medium" and medium_received_time is None:
                        medium_received_time = time.monotonic()

                    if info["is_final"] and image_id not in final_ids:
                        final_ids.add(image_id)
                        completed += 1

                    images[image_id] = pick_best(images.get(image_id), info)

                elif msg_type == "error":
                    err_msg = msg.get("err_msg", "") or msg.get("error", "")
                    err_code = msg.get("err_code", "") or msg.get("error_code", "")
                    await ws.close()
                    await session.close()
                    return {
                        "error": err_msg or "Upstream error",
                        "error_code": err_code or "upstream_error",
                        "status": 502,
                    }

                if completed >= n:
                    break

                if medium_received_time and completed == 0 and time.monotonic() - medium_received_time > final_timeout:
                    break

            elif ws_msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                break

        await ws.close()

    except Exception as e:
        await session.close()
        return {"error": str(e), "error_code": "ws_stream_failed", "status": 502}

    await session.close()

    # 选择最佳图片
    sorted_images = sorted(
        images.values(),
        key=lambda x: (x.get("is_final", False), x.get("blob_size", 0)),
        reverse=True,
    )[:n]

    # 去除 base64 前缀，只返回纯 base64 数据
    result_images = []
    for img in sorted_images:
        blob = img.get("blob", "")
        if "," in blob and "base64" in blob.split(",", 1)[0]:
            blob = blob.split(",", 1)[1]
        result_images.append({
            "b64_json": blob,
            "image_id": img.get("image_id", ""),
            "is_final": img.get("is_final", False),
            "ext": img.get("ext", "png"),
        })

    return {"images": result_images}


def main():
    try:
        config = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"error": f"Invalid input: {e}", "status": 400}))
        sys.exit(1)

    result = asyncio.run(generate_images(config))
    print(json.dumps(result))


if __name__ == "__main__":
    main()

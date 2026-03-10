#!/bin/bash
# 端点健康监控脚本 - 定时检测所有 API 端点状态
# 用法: ./endpoint_monitor.sh [间隔秒数] [基础URL]
# 示例: ./endpoint_monitor.sh 300 http://localhost:13003
#       nohup ./endpoint_monitor.sh 300 &  # 后台运行

INTERVAL="${1:-300}"  # 默认5分钟
BASE_URL="${2:-http://localhost:13003}"
API_KEY="sk-f0b54f06e8a91eaf4c24d3d622920ce0e131a7b1bef5d47a3baf68c749f4f305"
LOG_DIR="$(dirname "$0")/../logs"
LOG_FILE="${LOG_DIR}/endpoint_monitor.log"
TIMEOUT=15  # 单个请求超时(秒)

mkdir -p "$LOG_DIR"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo -e "$msg"
    echo "$msg" | sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_FILE"
}

# ============================================================
# 端点定义: 名称|方法|路径|类型(health/models/chat)
# 类型说明:
#   health - 不需要认证的健康检查 (GET)
#   models - 需要 API Key 的模型列表 (GET)
#   chat   - 需要 API Key 的 OpenAI chat 格式 (POST)
#   claude - 需要 API Key 的 Claude messages 格式 (POST)
# ============================================================
ENDPOINTS=(
    # --- 健康检查 (无需认证) ---
    "全局健康检查|GET|/health|health"
    "Windsurf 健康|GET|/windsurf/health|health"

    # --- 模型列表 (GET, 部分需认证) ---
    "Kiro 模型列表|GET|/v1/models|models"
    "Warp 模型列表|GET|/w/v1/models|models"
    "Windsurf 模型列表|GET|/windsurf/v1/models|models"
    "Krater 模型列表|GET|/k/v1/models|models"
    "Codex 模型列表|GET|/codex/v1/models|models"
    "AMI 模型列表|GET|/ami/v1/models|models"
    "Flow 模型列表|GET|/flow/v1/models|models"

    # --- Chat Completions (POST, OpenAI 格式) ---
    "Kiro Chat|POST|/v1/chat/completions|chat|claude-sonnet-4-20250514"
    "Warp Chat|POST|/w/v1/chat/completions|chat|claude-sonnet-4-20250514"
    "Windsurf Chat|POST|/windsurf/v1/chat/completions|chat|claude-sonnet-4-20250514"
    "Krater Chat|POST|/k/v1/chat/completions|chat|anthropic/claude-3.7-sonnet:thinking"
    "Codex Chat|POST|/codex/v1/chat/completions|chat|gpt-5.2-codex"
    "Flow Chat|POST|/flow/v1/chat/completions|chat|claude-sonnet-4-20250514"

    # --- Claude Messages (POST, Claude 格式) ---
    "Kiro Claude|POST|/v1/messages|claude|claude-sonnet-4-20250514"
    "Warp Claude|POST|/w/v1/messages|claude|claude-sonnet-4-20250514"
    "Windsurf Claude|POST|/windsurf/v1/messages|claude|claude-sonnet-4-20250514"
    "Krater Claude|POST|/k/v1/messages|claude|anthropic/claude-3.7-sonnet:thinking"
    "AMI Claude|POST|/am/v1/messages|claude|claude-sonnet-4-20250514"

    # --- 特殊端点 ---
    "Orchids Claude|POST|/orchids/v1/messages|claude|claude-sonnet-4-20250514"
    "Orchids Claude2|POST|/v1/orchids/messages|claude|claude-sonnet-4-20250514"
    "Gemini Antigravity|POST|/gemini-antigravity/v1/messages|claude|claude-sonnet-4-20250514"
    "Codex Responses|POST|/codex/responses|codex_resp|gpt-5.2-codex"
)

# 检测单个端点
check_endpoint() {
    local name="$1"
    local method="$2"
    local path="$3"
    local type="$4"
    local model="${5:-claude-sonnet-4-20250514}"
    local url="${BASE_URL}${path}"
    local http_code
    local response
    local start_time
    local end_time
    local duration

    start_time=$(date +%s%N 2>/dev/null || python3 -c "import time; print(int(time.time()*1e9))")

    case "$type" in
        health)
            response=$(curl -s -o /dev/null -w "%{http_code}" \
                --max-time "$TIMEOUT" "$url" 2>/dev/null)
            ;;
        models)
            response=$(curl -s -o /dev/null -w "%{http_code}" \
                --max-time "$TIMEOUT" \
                -H "Authorization: Bearer ${API_KEY}" \
                "$url" 2>/dev/null)
            ;;
        chat)
            # OpenAI chat 格式 - 发送最小请求，用 max_tokens=1 快速验证
            response=$(curl -s -o /dev/null -w "%{http_code}" \
                --max-time "$TIMEOUT" \
                -H "Authorization: Bearer ${API_KEY}" \
                -H "Content-Type: application/json" \
                -d "{\"model\":\"${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":1,\"stream\":false}" \
                "$url" 2>/dev/null)
            ;;
        claude)
            # Claude messages 格式
            response=$(curl -s -o /dev/null -w "%{http_code}" \
                --max-time "$TIMEOUT" \
                -H "x-api-key: ${API_KEY}" \
                -H "Content-Type: application/json" \
                -H "anthropic-version: 2023-06-01" \
                -d "{\"model\":\"${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":1,\"stream\":false}" \
                "$url" 2>/dev/null)
            ;;
        codex_resp)
            # Codex responses 格式
            response=$(curl -s -o /dev/null -w "%{http_code}" \
                --max-time "$TIMEOUT" \
                -H "Authorization: Bearer ${API_KEY}" \
                -H "Content-Type: application/json" \
                -d "{\"model\":\"${model}\",\"input\":\"hi\",\"max_output_tokens\":1,\"stream\":false}" \
                "$url" 2>/dev/null)
            ;;
    esac

    end_time=$(date +%s%N 2>/dev/null || python3 -c "import time; print(int(time.time()*1e9))")
    duration=$(( (end_time - start_time) / 1000000 ))  # 毫秒

    http_code="${response:-000}"

    # 判断状态: 2xx=成功, 401/403=认证问题, 429=限流, 5xx=服务端错误, 000=无法连接
    local status_icon
    local status_text
    case "$http_code" in
        2[0-9][0-9])
            status_icon="${GREEN}✓${NC}"
            status_text="OK"
            ;;
        401|403)
            # 认证失败但服务可达 - 对于 chat/claude 端点可能说明没有可用凭据但端点正常
            status_icon="${YELLOW}⚠${NC}"
            status_text="AUTH(${http_code})"
            ;;
        429)
            status_icon="${YELLOW}⚠${NC}"
            status_text="RATE_LIMIT"
            ;;
        000)
            status_icon="${RED}✗${NC}"
            status_text="UNREACHABLE"
            ;;
        *)
            status_icon="${RED}✗${NC}"
            status_text="ERR(${http_code})"
            ;;
    esac

    printf "  ${status_icon} %-28s %-6s %-35s %s ${duration}ms\n" \
        "$name" "$method" "$path" "$status_text"
}

# ============================================================
# 主监控循环
# ============================================================
log "${CYAN}================================================${NC}"
log "${CYAN}  API 端点健康监控${NC}"
log "${CYAN}================================================${NC}"
log "基础URL:   ${BASE_URL}"
log "API Key:   ${API_KEY:0:12}...${API_KEY: -6}"
log "检测间隔:  ${INTERVAL}s"
log "日志文件:  ${LOG_FILE}"
log "${CYAN}------------------------------------------------${NC}"

round=0
while true; do
    round=$((round + 1))
    log ""
    log "${CYAN}[第 ${round} 轮] $(date '+%Y-%m-%d %H:%M:%S')${NC}"
    log ""

    total=0
    ok=0
    warn=0
    fail=0

    # 先检查服务是否可达
    health_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${BASE_URL}/health" 2>/dev/null)
    if [ "$health_code" = "000" ]; then
        log "${RED}  ✗ 服务不可达 (${BASE_URL})，跳过本轮检测${NC}"
        sleep "$INTERVAL"
        continue
    fi

    log "${GREEN}--- 健康检查端点 ---${NC}"
    for ep in "${ENDPOINTS[@]}"; do
        IFS='|' read -r name method path type model <<< "$ep"
        if [ "$type" = "health" ]; then
            result=$(check_endpoint "$name" "$method" "$path" "$type" "")
            echo -e "$result"
            echo "$result" | sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_FILE"
            total=$((total + 1))
            if echo "$result" | grep -q "OK"; then ok=$((ok + 1));
            elif echo "$result" | grep -q "AUTH\|RATE"; then warn=$((warn + 1));
            else fail=$((fail + 1)); fi
        fi
    done

    log ""
    log "${GREEN}--- 模型列表端点 ---${NC}"
    for ep in "${ENDPOINTS[@]}"; do
        IFS='|' read -r name method path type model <<< "$ep"
        if [ "$type" = "models" ]; then
            result=$(check_endpoint "$name" "$method" "$path" "$type" "")
            echo -e "$result"
            echo "$result" | sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_FILE"
            total=$((total + 1))
            if echo "$result" | grep -q "OK"; then ok=$((ok + 1));
            elif echo "$result" | grep -q "AUTH\|RATE"; then warn=$((warn + 1));
            else fail=$((fail + 1)); fi
        fi
    done

    log ""
    log "${GREEN}--- Chat/Messages 端点 ---${NC}"
    for ep in "${ENDPOINTS[@]}"; do
        IFS='|' read -r name method path type model <<< "$ep"
        if [ "$type" = "chat" ] || [ "$type" = "claude" ] || [ "$type" = "codex_resp" ]; then
            result=$(check_endpoint "$name" "$method" "$path" "$type" "$model")
            echo -e "$result"
            echo "$result" | sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_FILE"
            total=$((total + 1))
            if echo "$result" | grep -q "OK"; then ok=$((ok + 1));
            elif echo "$result" | grep -q "AUTH\|RATE"; then warn=$((warn + 1));
            else fail=$((fail + 1)); fi
        fi
    done

    log ""
    log "汇总: 共 ${total} 个端点 | ${GREEN}正常: ${ok}${NC} | ${YELLOW}警告: ${warn}${NC} | ${RED}异常: ${fail}${NC}"
    log "${CYAN}------------------------------------------------${NC}"

    if [ "$fail" -gt 0 ]; then
        log "${RED}[告警] 有 ${fail} 个端点异常!${NC}"
    fi

    log "下次检测: $(date -v+${INTERVAL}S '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "+${INTERVAL} seconds" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "${INTERVAL}s 后")"

    sleep "$INTERVAL"
done

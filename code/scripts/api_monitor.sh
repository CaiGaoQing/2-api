#!/bin/bash
# API 监控脚本 - 监控工具调用异常和 API 错误
# 用法: ./api_monitor.sh [日志文件路径] [刷新间隔秒数]

LOG_FILE="${1:-./logs/server.log}"
INTERVAL="${2:-10}"

# 颜色定义
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 监控关键词
KEYWORDS=(
    "tool_call"
    "tool_use"
    "TokenGuard"
    "JSON解析错误"
    "truncated"
    "max_tokens"
    "401"
    "403"
    "429"
    "500"
    "error"
    "Error"
)

# 统计计数器
declare -A error_counts
declare -A last_errors

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  API 监控脚本 - 工具调用异常检测${NC}"
echo -e "${CYAN}========================================${NC}"
echo -e "日志文件: ${LOG_FILE}"
echo -e "刷新间隔: ${INTERVAL}s"
echo -e "${CYAN}----------------------------------------${NC}"

# 初始化计数器
for keyword in "${KEYWORDS[@]}"; do
    error_counts[$keyword]=0
done

# 监控循环
round=0
while true; do
    round=$((round + 1))
    echo -e "\n${CYAN}[轮次 $round] $(date '+%Y-%m-%d %H:%M:%S')${NC}"

    if [ ! -f "$LOG_FILE" ]; then
        echo -e "${YELLOW}警告: 日志文件不存在${NC}"
        sleep $INTERVAL
        continue
    fi

    # 获取最近的日志行（最近1000行）
    recent_logs=$(tail -n 1000 "$LOG_FILE" 2>/dev/null)

    # 统计各关键词出现次数
    echo -e "\n${GREEN}关键词统计:${NC}"
    total_issues=0

    for keyword in "${KEYWORDS[@]}"; do
        count=$(echo "$recent_logs" | grep -c "$keyword" 2>/dev/null || echo "0")

        if [ "$count" -gt 0 ]; then
            if [[ "$keyword" == "error" || "$keyword" == "Error" || "$keyword" == "500" || "$keyword" == "403" ]]; then
                echo -e "  ${RED}$keyword: $count${NC}"
            elif [[ "$keyword" == "tool_call" || "$keyword" == "tool_use" || "$keyword" == "TokenGuard" ]]; then
                echo -e "  ${YELLOW}$keyword: $count${NC}"
            else
                echo -e "  $keyword: $count"
            fi
            total_issues=$((total_issues + count))
        fi
    done

    if [ "$total_issues" -eq 0 ]; then
        echo -e "  ${GREEN}✓ 无异常${NC}"
    fi

    # 工具调用异常明细
    echo -e "\n${YELLOW}工具调用异常明细 (最近5条):${NC}"
    tool_errors=$(echo "$recent_logs" | grep -E "(tool_call|tool_use|TokenGuard|truncated)" | tail -n 5)

    if [ -n "$tool_errors" ]; then
        echo "$tool_errors" | while read -r line; do
            # 截取显示（避免过长）
            echo "  ${line:0:120}..."
        done
    else
        echo -e "  ${GREEN}✓ 无工具调用异常${NC}"
    fi

    # API 错误明细
    echo -e "\n${RED}API 错误明细 (最近5条):${NC}"
    api_errors=$(echo "$recent_logs" | grep -E "(401|403|429|500|error|Error)" | grep -v "errorCount" | tail -n 5)

    if [ -n "$api_errors" ]; then
        echo "$api_errors" | while read -r line; do
            echo "  ${line:0:120}..."
        done
    else
        echo -e "  ${GREEN}✓ 无 API 错误${NC}"
    fi

    echo -e "\n${CYAN}----------------------------------------${NC}"
    echo -e "按 Ctrl+C 退出监控"

    sleep $INTERVAL
done

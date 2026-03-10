#!/bin/bash

# ==============================================================================
# Mihomo (Clash.Meta) 自动安装与配置脚本
#
# 功能:
# 1. 自动检测系统架构 (amd64/arm64)
# 2. 从 GitHub 下载最新的 mihomo release 版本
# 3. 下载指定的 Clash 订阅配置文件
# 4. 配置并启用 systemd 服务，实现开机自启
# 5. 启动服务并检查状态
# ==============================================================================

# --- 用户配置 ---
# 请将下面的链接替换为你的 Clash 订阅链接
SUBSCRIPTION_URL="在这里粘贴你的Clash订阅链接"


# --- 脚本常量 ---
# 使用颜色输出，增加可读性
GREEN="\e[32m"
RED="\e[31m"
YELLOW="\e[33m"
NC="\e[0m" # No Color

MIHOMO_INSTALL_PATH="/usr/local/bin/mihomo"
MIHOMO_CONFIG_DIR="/etc/mihomo"
MIHOMO_CONFIG_FILE="${MIHOMO_CONFIG_DIR}/config.yaml"
SYSTEMD_SERVICE_FILE="/etc/systemd/system/mihomo.service"

# 脚本出错时立即退出
set -e

# --- 函数定义 (使用 printf 替代 echo) ---

info() {
    printf "${GREEN}[INFO]${NC} %s\n" "$*"
}

warn() {
    printf "${YELLOW}[WARN]${NC} %s\n" "$*"
}

error() {
    # 将错误信息输出到 stderr
    printf "${RED}[ERROR]${NC} %s\n" "$*" >&2
    exit 1
}

# --- 脚本主体 ---

# 1. 检查环境和权限
info "开始执行 Mihomo 自动安装和配置脚本..."

if [ "$(id -u)" -ne 0 ]; then
    error "此脚本需要以 root 权限运行。请使用 'sudo ./install_mihomo.sh'。"
fi

if [ "$SUBSCRIPTION_URL" = "在这里粘贴你的Clash订阅链接" ] || [ -z "$SUBSCRIPTION_URL" ]; then
    error "请先编辑此脚本，将 SUBSCRIPTION_URL 变量替换为你的有效订阅链接。"
fi

# 检查必要的命令
for cmd in curl wget gunzip; do
    if ! command -v $cmd > /dev/null 2>&1; then
        error "命令 '$cmd' 未找到。请先安装它 (例如: sudo apt update && sudo apt install $cmd)。"
    fi
done

# 2. 安装 mihomo
info "步骤 1: 安装 mihomo..."

# 检测系统架构
ARCH=""
case $(uname -m) in
    x86_64) ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    *) error "不支持的系统架构: $(uname -m)" ;;
esac
info "检测到系统架构: ${ARCH}"

# 查找本地 mihomo 文件 (支持 .gz 压缩包或已解压的二进制文件)
LOCAL_GZ=$(ls mihomo-linux-${ARCH}-*.gz 2>/dev/null | head -n 1)
LOCAL_BIN=$(ls mihomo-linux-${ARCH}-* 2>/dev/null | grep -v '\.gz$' | head -n 1)

if [ -n "$LOCAL_GZ" ]; then
    info "检测到本地文件: ${LOCAL_GZ}，使用本地文件安装..."
    gunzip -f "$LOCAL_GZ"
    LOCAL_BIN=$(ls mihomo-linux-${ARCH}-* 2>/dev/null | grep -v '\.gz$' | head -n 1)
    chmod +x "$LOCAL_BIN"
    mv "$LOCAL_BIN" "$MIHOMO_INSTALL_PATH"
elif [ -n "$LOCAL_BIN" ]; then
    info "检测到本地文件: ${LOCAL_BIN}，使用本地文件安装..."
    chmod +x "$LOCAL_BIN"
    mv "$LOCAL_BIN" "$MIHOMO_INSTALL_PATH"
else
    info "未检测到本地文件，从 GitHub 下载..."
    # 从 GitHub API 获取最新版本号
    LATEST_TAG=$(curl -sL "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
    if [ -z "$LATEST_TAG" ]; then
        error "无法从 GitHub API 获取最新版本号。请检查网络连接或 API 限制。"
    fi
    info "获取到最新版本: ${LATEST_TAG}"

    FILENAME="mihomo-linux-${ARCH}-${LATEST_TAG}.gz"

    # 构建下载链接并下载
    MIHOMO_DOWNLOAD_URL="https://github.com/MetaCubeX/mihomo/releases/download/${LATEST_TAG}/${FILENAME}"
    info "正在从以下链接下载: ${MIHOMO_DOWNLOAD_URL}"
    wget -q -O mihomo.gz "$MIHOMO_DOWNLOAD_URL"

    info "下载完成，正在解压..."
    gunzip -f mihomo.gz
    chmod +x mihomo
    mv mihomo "$MIHOMO_INSTALL_PATH"
fi

# 验证安装
if [ ! -x "$MIHOMO_INSTALL_PATH" ]; then
    error "mihomo 安装失败，文件未找到或没有执行权限。"
fi
info "mihomo 安装成功! 版本信息:"
"$MIHOMO_INSTALL_PATH" -v
echo ""


# 3. 下载 Clash 订阅配置
info "步骤 2: 下载订阅配置文件..."

info "创建配置目录: ${MIHOMO_CONFIG_DIR}"
mkdir -p "$MIHOMO_CONFIG_DIR"

info "正在下载订阅文件到 ${MIHOMO_CONFIG_FILE}..."
wget -q -O "$MIHOMO_CONFIG_FILE" "$SUBSCRIPTION_URL"

if [ ! -s "$MIHOMO_CONFIG_FILE" ]; then
    error "订阅文件下载失败或文件为空。请检查你的订阅链接是否正确以及网络是否通畅。"
fi
info "订阅文件下载成功。"
echo ""


# 4. 配置 mihomo 为 service
info "步骤 3: 创建并配置 systemd 服务..."

if command -v systemctl > /dev/null 2>&1 && [ -d /run/systemd/system ]; then
	info "检测到 systemd 环境,配置为systemd 服务"

	cat << EOF > "$SYSTEMD_SERVICE_FILE"
[Unit]
Description=Mihomo Daemon, A Clash Premium core implementation
After=network.target

[Service]
Type=simple
User=root
ExecStart=${MIHOMO_INSTALL_PATH} -d ${MIHOMO_CONFIG_DIR}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

	info "systemd 服务文件已创建: ${SYSTEMD_SERVICE_FILE}"
	echo ""


	# 5. 启动服务
	info "步骤 4: 启动 mihomo 服务..."
	
	info "重载 systemd 配置..."
	systemctl daemon-reload
	
	info "设置 mihomo 开机自启..."
	systemctl enable mihomo
	
	info "启动 mihomo 服务..."
	systemctl start mihomo
	
	# 稍等片刻让服务启动
	sleep 2
	
	info "脚本执行完毕！正在检查服务状态..."
	echo "=========================================================="
	systemctl status mihomo --no-pager
	echo "=========================================================="
	echo ""
	
	info "Mihomo 已成功安装并启动！"
	warn "要查看实时日志，请运行: journalctl -u mihomo -f"
	warn "要停止服务，请运行: sudo systemctl stop mihomo"
	warn "要重启服务，请运行: sudo systemctl restart mihomo"
else
	warn "未检测到 systemd，自动切换到 nohup 后台启动模式。"
    nohup ${MIHOMO_INSTALL_PATH} -d ${MIHOMO_CONFIG_DIR} > /var/log/mihomo.log 2>&1 &
    info "已使用 nohup 启动 mihomo，并输出日志到 /var/log/mihomo.log"
    info "Mihomo 已经安装并已后台启动！"
    warn "要查看日志请运行: tail -f /var/log/mihomo.log"
    warn "如需停止请使用: pkill -f '${MIHOMO_INSTALL_PATH} -d ${MIHOMO_CONFIG_DIR}'"
fi

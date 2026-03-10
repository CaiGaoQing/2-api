FROM node:22-alpine

  # 安装 Python 和 pip
RUN apk add --no-cache python3 py3-pip

  # 安装 Python 依赖（nest_asyncio, aiohttp 用于 grok_imagine）
RUN pip3 install --break-system-packages nest_asyncio aiohttp aiohttp_socks
WORKDIR /app
# 安装 Python3 + requests（orchids 注册脚本需要）
RUN apk add --no-cache python3 py3-pip && pip3 install --no-cache-dir --break-system-packages requests

# 复制 package.json
COPY package*.json ./

# 安装 Node 依赖
RUN npm install --production

# 复制源代码
COPY src ./src

# 暴露端口
EXPOSE 13003

# 启动命令
CMD ["node", "src/server.js"]


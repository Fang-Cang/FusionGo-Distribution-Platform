FROM node:24-alpine AS build

WORKDIR /app

# 1. 先单独拷贝依赖文件 (利用Docker缓存层)
COPY package.json package-lock.json ./
# 2. 安装依赖 (只要 package*.json 没变，这一步就会直接走缓存，不会重新下载)
RUN npm ci

# 3. 再拷贝所有业务源代码 (这一步经常变动，但它不会导致上一步的 npm ci 重新执行)
COPY . .

# 4. 执行打包编译
RUN npm run build


FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# 运行阶段同样遵循缓存原则：先拷依赖，再安装
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 从构建阶段拷贝编译好的产物
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/server/db/migrations ./dist-server/server/db/migrations

# 创建数据目录
RUN mkdir -p /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist-server/server/index.js"]
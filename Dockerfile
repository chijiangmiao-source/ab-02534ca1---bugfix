# syntax=docker/dockerfile:1

# ---- 依赖阶段 ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 构建阶段：仅产出静态文件，运行时无 Node、无业务后端 ----
FROM deps AS builder
COPY . .
RUN npm run build

# ---- verify 一次性服务镜像：测试 + 构建检查 + 场景断言 + HTTP 冒烟 ----
FROM deps AS verify
WORKDIR /app
COPY . .
RUN chmod +x scripts/verify.sh
# wget（busybox）供 HTTP 冒烟使用；node:alpine 已自带
CMD ["sh", "scripts/verify.sh"]

# ---- 运行阶段：nginx 托管纯静态页面 ----
FROM nginx:1.27-alpine AS runtime
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O- http://127.0.0.1/healthz || exit 1

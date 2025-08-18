# syntax=docker/dockerfile:1

FROM node:18-alpine AS deps
WORKDIR /app

# 1) copy package manager files for gateway
COPY services/gateway/package.json services/gateway/tsconfig.json ./

# 2) install dev deps to build
RUN npm i --production=false

# 3) copy source and shared lib (visible because context is repo root)
COPY services/gateway/src ./src
COPY shared ./shared

# 4) build
RUN npm run build

# ---------------- runtime ----------------
FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy built output and shared (if runtime needs it)
COPY --from=deps /app/dist ./dist
COPY --from=deps /app/shared ./shared

# copy package.json so we can install prod deps
COPY services/gateway/package.json ./
RUN npm i --omit=dev

ENV GATEWAY_PORT=8080
EXPOSE 8080
CMD ["node","dist/index.js"]

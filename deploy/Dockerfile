# Self-host build for ip.nalide.com (replaces the Cloudflare Workers deploy).
# Stage 1 builds the Vite frontend into dist/; stage 2 runs the worker
# code under the dependency-free Node adapter in deploy/server.mjs.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_BUILD_TIME=""
ENV VITE_BUILD_TIME=$VITE_BUILD_TIME
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/dist ./dist
COPY public/worker ./public/worker
COPY deploy/server.mjs ./deploy/server.mjs
USER node
EXPOSE 3000
CMD ["node", "deploy/server.mjs"]

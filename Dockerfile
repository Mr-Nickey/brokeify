# ==============================================================================
# STAGE 1: Builder (Debian glibc for Vite 8 Rolldown & Tailwind Oxide build tools)
#          This stage is discarded after compiling dist/ and server.js.
# ==============================================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /build

COPY package*.json .npmrc* ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# ==============================================================================
# STAGE 2: Ultra-Lean Production Runtime (~80 MB total, < 3.5 MB app payload)
#          Zero node_modules, zero C++ native .node addons (no exit code 139).
# ==============================================================================
FROM node:20-alpine AS runner

LABEL org.opencontainers.image.title="Brokeify"
LABEL org.opencontainers.image.description="Brokeify Standalone Music Server, Chokidar Watcher & Audio Streaming Engine"
LABEL org.opencontainers.image.source="https://github.com/Mr-Nickey/brokeify"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install only ffmpeg (for EBU R128 LUFS audio normalization) and ca-certificates
RUN apk add --no-cache ffmpeg ca-certificates

# Copy only the compiled production artifacts (< 3.5 MB total, no node_modules!)
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/server.js ./server.js
COPY --from=builder /build/version.json ./version.json
COPY --from=builder /build/package.json ./package.json

# Create persistent /data (/data/brokeify.db, /data/covers, /data/config.json) and /music directories
RUN mkdir -p /data /data/covers /music /app/data /app/downloads /tmp

ARG GIT_COMMIT_SHA=""
ARG BUILD_TIMESTAMP=""

ENV NODE_ENV=production
ENV PORT=3487
ENV BROKEIFY_DATA_DIR=/data
ENV BROKEIFY_MUSIC_DIR=/music
ENV BROKEIFY_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV BROKEIFY_BUILD_TIME=${BUILD_TIMESTAMP}

EXPOSE 3487

CMD ["node", "server.js"]

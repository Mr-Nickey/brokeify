FROM node:20-bookworm-slim

LABEL org.opencontainers.image.title="Brokeify"
LABEL org.opencontainers.image.description="Brokeify Standalone SQLite Music Server, Chokidar Watcher & Audio Streaming Engine"
LABEL org.opencontainers.image.source="https://github.com/Mr-Nickey/brokeify"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install ffmpeg (for EBU R128 LUFS audio normalization), python3, and C++ build tools on Debian glibc (avoids Alpine musl code 139 segfaults)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      make \
      g++ \
      ca-certificates \
      curl && \
    rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies (rebuilding better-sqlite3 cleanly against Debian glibc)
COPY package*.json .npmrc* ./
RUN npm install --legacy-peer-deps && npm rebuild better-sqlite3

# Copy full source code and build both Vite React frontend and Express/SQLite server.js bundle
COPY . .
RUN npm run build

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

# Start the standalone Brokeify Express + SQLite + Static Web Player server on Port 3487
CMD ["node", "server.js"]

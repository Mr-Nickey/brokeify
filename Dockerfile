# ==============================================================================
# Stage 1: Build Frontend (Vite + React) & Bundle Standalone Server (esbuild)
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests and install dependencies for building
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy source code and build both client (dist/) and standalone server.js
COPY . .
RUN npm run build

# ==============================================================================
# Stage 2: Lean Production Runtime (Zero native C++ addons = Zero SIGSEGV crashes)
# ==============================================================================
FROM node:22-alpine

# Install ffmpeg (EBU R128 LUFS audio analyzer), yt-dlp, and ca-certificates
RUN apk add --no-cache \
    ffmpeg \
    yt-dlp \
    ca-certificates \
    tzdata

WORKDIR /app

# Copy only the compiled frontend assets and self-contained server bundle
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/package.json ./package.json

# Create persistent directories for database (/data/brokeify.db), cover art (/data/covers),
# and mounted music library (/music), owned by the non-root `node` user (UID 1000 / GID 1000)
RUN mkdir -p /data/covers /music && \
    chown -R node:node /app /data /music

ENV NODE_ENV=production
ENV PORT=3487
ENV DATA_DIR=/data
ENV MUSIC_DIR=/music
ENV BROKEIFY_DATA_DIR=/data
ENV BROKEIFY_MUSIC_DIR=/music
ENV TRUST_PROXY=1
ENV ALLOW_SIGNUP=false

VOLUME ["/data", "/music"]

EXPOSE 3487

# Run as non-root user for internet-exposed container security
USER node

# Container healthcheck hitting the public handshake endpoint using Node's built-in fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3487/api/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

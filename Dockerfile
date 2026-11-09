FROM node:20-alpine

WORKDIR /app

# Install ffmpeg (for EBU R128 LUFS audio normalization), yt-dlp, python3, and build tools for better-sqlite3
RUN apk add --no-cache ffmpeg yt-dlp python3 make g++ || true

# Copy package files and install dependencies
COPY package*.json .npmrc* ./
RUN npm install --legacy-peer-deps

# Copy full source code and build both Vite React frontend and Express/SQLite server.js bundle
COPY . .
RUN npm run build

# Create persistent /data (/data/brokeify.db, /data/covers, /data/config.json) and /music directories
RUN mkdir -p /data /data/covers /music /app/data /app/downloads

ENV NODE_ENV=production
ENV PORT=3487
ENV BROKEIFY_DATA_DIR=/data
ENV BROKEIFY_MUSIC_DIR=/music

EXPOSE 3487

# Start the standalone Brokeify Express + SQLite + Static Web Player server on Port 3487
CMD ["node", "server.js"]

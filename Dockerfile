FROM node:20-alpine

WORKDIR /app

# Install ffmpeg & yt-dlp for YouTube Music / Multi-Source Audio Downloader fallback
RUN apk add --no-cache ffmpeg yt-dlp python3 || true

# Copy package files and install dependencies (with --legacy-peer-deps to prevent ERESOLVE conflicts)
COPY package*.json .npmrc* ./
RUN npm install --legacy-peer-deps

# Copy full source code and build the Vite React frontend
COPY . .
RUN npm run build

# Create persistent data directory for config.json & downloads folder
RUN mkdir -p /app/data /app/downloads

ENV NODE_ENV=production
ENV PORT=3487

EXPOSE 3487

# Start the Express backend + static frontend server on Port 3487
CMD ["node", "server.js"]

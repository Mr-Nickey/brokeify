FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies (with --legacy-peer-deps to prevent ERESOLVE conflicts)
COPY package*.json .npmrc* ./
RUN npm install --legacy-peer-deps

# Copy full source code and build the Vite React frontend
COPY . .
RUN npm run build

# Create persistent data directory for config.json & playlist backups
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start the Express backend + static frontend server
CMD ["node", "server.js"]

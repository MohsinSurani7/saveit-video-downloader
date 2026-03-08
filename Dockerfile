FROM node:22-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir yt-dlp

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY server/ ./server/
COPY shared/ ./shared/
COPY patches/ ./patches/
COPY app.json ./
COPY tsconfig.json ./
COPY assets/ ./assets/

RUN npx esbuild server/index.ts --platform=node --packages=external --bundle --format=cjs --outdir=server_dist
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=5000
ENV YT_DLP_PATH=/opt/venv/bin/yt-dlp

EXPOSE 5000

CMD ["node", "server_dist/index.js"]

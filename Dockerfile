FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install Playwright browsers to a fixed path accessible by the node user
ENV PLAYWRIGHT_BROWSERS_PATH=/app/pw-browsers
RUN npx playwright install chromium

COPY --from=builder /app/dist ./dist
COPY sql/ ./sql/

RUN mkdir -p /app/storage && chown -R node:node /app/storage /app/pw-browsers

ENV NODE_ENV=production
ENV PORT=3100
EXPOSE 3100

USER node

CMD ["node", "dist/index.js"]

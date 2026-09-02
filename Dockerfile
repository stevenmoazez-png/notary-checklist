FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY . .

# drop privileges — nothing here needs root
USER node

EXPOSE 8080
CMD ["node", "server/index.js"]

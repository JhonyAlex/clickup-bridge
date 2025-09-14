FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm i --omit=dev
COPY server.js ./
ENV PORT=3107
EXPOSE 3107
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3107/health || exit 1
CMD ["npm","start"]

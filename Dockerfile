# Cloud build (Render) from the repository root; local Docker Compose uses app/Dockerfile.
FROM node:22-alpine
WORKDIR /app
COPY app/package.json ./
RUN npm install --omit=dev
COPY app/src ./src
COPY app/public ./public
EXPOSE 3100
CMD ["node", "src/server.js"]

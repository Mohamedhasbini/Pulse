FROM node:22-alpine
WORKDIR /app
# exactly the versions in the lockfile, every build (a rebuild can't silently pull a newer package)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
EXPOSE 3100
CMD ["node", "src/server.js"]

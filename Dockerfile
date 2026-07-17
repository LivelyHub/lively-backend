# Build stage — also used by CI to run migrations (has drizzle-kit dev dep)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
RUN npm run build

# Runtime stage — production deps only
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 7000
CMD ["node", "dist/server.js"]

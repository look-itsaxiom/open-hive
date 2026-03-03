FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
RUN npm ci
COPY packages/shared/ packages/shared/
COPY packages/backend/ packages/backend/
RUN npx turbo run build --filter=@open-hive/backend

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/packages/backend/dist ./dist
COPY --from=build /app/packages/backend/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./node_modules/@open-hive/shared/dist
COPY --from=build /app/packages/shared/package.json ./node_modules/@open-hive/shared/
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]

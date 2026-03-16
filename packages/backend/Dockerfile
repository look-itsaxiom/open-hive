FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/plugin/package.json packages/plugin/
RUN npm ci --include=dev
COPY packages/shared/ packages/shared/
COPY packages/backend/ packages/backend/
RUN npx tsc --build packages/backend/tsconfig.json --force

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/packages/backend/dist ./dist
COPY --from=build /app/packages/backend/src/dashboard/views ./dist/dashboard/views
COPY --from=build /app/packages/backend/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./node_modules/@open-hive/shared/dist
COPY --from=build /app/packages/shared/package.json ./node_modules/@open-hive/shared/
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]

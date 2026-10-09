# production-checker, packaged for environments that can't (or shouldn't)
# install Chromium's system dependencies themselves - e.g. an agent sandbox,
# a locked-down CI runner, or anywhere you want `--deep` mode reproducible
# without touching the host. The default (non---deep) scan doesn't need this
# image at all; see README.md for running the CLI directly with Node.
#
# The Playwright base image ships a matching Chromium build + every system
# library it needs (fonts, libnss3, etc.) pre-installed, so `--deep` works
# out of the box with no extra `apt-get` step.
FROM mcr.microsoft.com/playwright:v1.64.0-noble AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.64.0-noble

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm install playwright@1.64.0 --no-save
COPY --from=build /app/dist ./dist

# Playwright base image's default user already has Chromium permissions sorted.
USER pwuser

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--help"]

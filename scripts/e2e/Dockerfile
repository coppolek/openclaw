# syntax=docker/dockerfile:1.7

FROM node:24-trixie@sha256:e4ceb04a1f1dd4823a1ab6ef8d2182c09d6299b507c70f20bd0eb9921a78354d

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable

RUN useradd --create-home --shell /bin/bash appuser \
 && mkdir -p /app \
 && chown appuser:appuser /app

ENV HOME="/home/appuser"
ENV NODE_OPTIONS="--disable-warning=ExperimentalWarning"

USER appuser
WORKDIR /app

COPY --chown=appuser:appuser package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=appuser:appuser ui/package.json ./ui/package.json
COPY --chown=appuser:appuser extensions ./extensions
COPY --chown=appuser:appuser patches ./patches
COPY --chown=appuser:appuser scripts/postinstall-bundled-plugins.mjs scripts/preinstall-package-manager-warning.mjs scripts/npm-runner.mjs scripts/windows-cmd-helpers.mjs ./scripts/

RUN --mount=type=cache,id=openclaw-pnpm-store,target=/home/appuser/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

COPY --chown=appuser:appuser tsconfig.json tsconfig.plugin-sdk.dts.json tsdown.config.ts vitest.config.ts openclaw.mjs ./
COPY --chown=appuser:appuser src ./src
COPY --chown=appuser:appuser test ./test
COPY --chown=appuser:appuser scripts ./scripts
COPY --chown=appuser:appuser docs ./docs
COPY --chown=appuser:appuser packages ./packages
COPY --chown=appuser:appuser skills ./skills
COPY --chown=appuser:appuser ui ./ui
COPY --chown=appuser:appuser extensions ./extensions
COPY --chown=appuser:appuser vendor/a2ui/renderers/lit ./vendor/a2ui/renderers/lit
COPY --chown=appuser:appuser apps/shared/OpenClawKit/Sources/OpenClawKit/Resources ./apps/shared/OpenClawKit/Sources/OpenClawKit/Resources
COPY --chown=appuser:appuser apps/shared/OpenClawKit/Tools/CanvasA2UI ./apps/shared/OpenClawKit/Tools/CanvasA2UI

RUN pnpm build
# Onboard Docker E2E does not exercise the Control UI itself; it only needs the
# asset-existence check to pass so configure/onboard can continue.
RUN mkdir -p dist/control-ui \
  && printf '%s\n' '<!doctype html><title>OpenClaw Control UI</title>' > dist/control-ui/index.html

CMD ["bash"]

# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV PNPM_STORE_DIR="/pnpm/store"
RUN corepack enable

# 1. 의존성 격리 스테이지 (deps)
# 빌드에 필요한 Python, g++ 등의 도구를 전용 스테이지에 분리하여 Layer 병목 최소화
FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++

# 2. 작업 공간 최적화 스테이지 (builder)
# 모노레포(Monorepo) 전체 공간 중 @homerunnie/backend 실행에 필요한 파일 뼈대만 추출(Prune)
FROM deps AS builder
WORKDIR /app
RUN npm i -g turbo
COPY . .
RUN turbo prune @homerunnie/backend --docker

# 3. 레이어 캐시(Layer Cache) 극대화 및 빌드 스테이지 (installer)
# 소스 코드가 아닌 json/lockfile만 먼저 설치하여 CI/CD에서 캐시가 깨지는 확률을 방지
FROM deps AS installer
WORKDIR /app

COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,id=homerunnie-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline

# 의존성이 확보된 후 진짜 소스코드를 덮어씌워서 빌드 실행
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
RUN --mount=type=cache,id=homerunnie-turbo-cache,target=/root/.cache/turbo \
    pnpm turbo run build --filter=@homerunnie/backend...

# 불필요한 개발용 패키지를 모두 제거하고 프로덕션 코어를 `/app/pruned` 폴더에 분리 보관
RUN pnpm --filter=@homerunnie/backend --prod deploy /app/pruned --legacy

# 4. 최종 운용 스테이지 (runner)
# 무거운 빌드 툴들을 모두 버리고 가볍고 깔끔한 최종 이미지만 운영 환경으로 노출
FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# 인스톨러에서 최적화가 끝난 산출물 3종 세트만 최종 복사
COPY --from=installer --chown=nestjs:nodejs /app/pruned/node_modules ./node_modules
COPY --from=installer --chown=nestjs:nodejs /app/pruned/dist ./dist
COPY --from=installer --chown=nestjs:nodejs /app/pruned/package.json ./package.json
COPY --from=installer --chown=nestjs:nodejs /app/apps/backend/drizzle ./drizzle

EXPOSE 3030

CMD ["pnpm", "start:prod"]

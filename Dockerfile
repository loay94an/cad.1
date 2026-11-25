# Floor plan: the PWA (Vue + Vite+) served by the ASP.NET Core API, in one image.
#   docker build -t floorplan .
#   docker buildx build --platform linux/amd64,linux/arm64 .   (the build stages run natively and cross-compile)
#   docker compose up -d        (see docker-compose.yml and server/README.md)

# 1. Build the PWA into dist/.
# The output is plain files, so this stage runs on the build machine's own platform.
FROM --platform=$BUILDPLATFORM node:22 AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
# Only what the frontend build reads (keeps a local node_modules or server/bin out of this stage).
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# 2. Publish the API.
#    Cross-compiles for the target platform (amd64 or arm64) instead of running the SDK under emulation.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS api
ARG TARGETARCH
WORKDIR /src
COPY server/Floorplan.Api/Floorplan.Api.csproj server/Floorplan.Api/
RUN dotnet restore server/Floorplan.Api/Floorplan.Api.csproj -a $TARGETARCH
COPY server/Floorplan.Api/ server/Floorplan.Api/
RUN dotnet publish server/Floorplan.Api/Floorplan.Api.csproj -c Release -a $TARGETARCH --self-contained false -o /app --no-restore

# 3. Runtime.
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=api /app ./
COPY --from=web /src/dist ./wwwroot
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DataDir=/data
RUN mkdir -p /data && chown app:app /data
USER app
VOLUME /data
EXPOSE 8080
# GET /api/health answers {"status":"ok"} (the image has no curl; probe it from your proxy or monitor).
ENTRYPOINT ["dotnet", "Floorplan.Api.dll"]

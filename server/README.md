# Floor plan server

An ASP.NET Core 10 API for the floor plan PWA. It saves homes per user, shares them by email, and stores the pictures and documents attached to rooms. It also serves the built PWA, so the whole app runs in one container.

- `Floorplan.Api/`: minimal APIs and EF Core with SQLite.
- `Floorplan.Api.Tests/`: xUnit tests that run the API in-process with `WebApplicationFactory`.

## Run it locally

```bash
cd server/Floorplan.Api
dotnet run
```

The API listens on `http://localhost:5080` in the Development environment. In another terminal, run `npm run dev` in the repository root. Vite serves the PWA on `http://localhost:5173` and proxies `/api` to the API. CORS also allows `http://localhost:5173` in Development.

`appsettings.Development.json` sets `Auth:Enabled` to `false`. With auth off, every request is signed in as user `dev`. To test sharing between people, send the header `X-Dev-User: alice` (or `bob`, and so on); that user gets the email `alice@dev.local`. The app refuses to start with auth off in any environment other than Development.

```bash
curl http://localhost:5080/api/config
curl -H "X-Dev-User: alice" http://localhost:5080/api/me
```

Run the tests with:

```bash
cd server
dotnet test
```

The data lives in `Floorplan.Api/data/` by default (`DataDir`).

## Configuration

Settings come from `appsettings.json` or environment variables. In an environment variable, `:` becomes `__`, so `Oidc:Authority` is `Oidc__Authority`.

| Setting | Default | Meaning |
|---|---|---|
| `DataDir` | `./data` | Holds `floorplan.db` and one folder per home. A relative path is relative to the content root. The Docker image uses `/data`. |
| `Auth:Enabled` | `true` | `false` is allowed only in Development. |
| `Oidc:Authority` | (required) | The provider's issuer URL. Discovery and signing keys are read from it. |
| `Oidc:ClientId` | | The public client the PWA signs in with. It is returned by `/api/config`. |
| `Oidc:Audience` | ClientId | The expected `aud` of access tokens. |
| `Oidc:ValidateAudience` | `true` | A token passes when its `aud` contains the audience, or when it has no `aud` but its `client_id` (or `azp`) is the client id. Turn this off only if neither works for your provider. |
| `Oidc:UserinfoFallback` | `true` | An access token that is not a JWT the API can verify (encrypted, as OpenIddict makes them, or opaque) is checked by sending it to the provider's userinfo endpoint. `false` refuses such tokens. |
| `Oidc:UserinfoCacheSeconds` | `300` | How long a userinfo answer is reused for the same token. |
| `Oidc:TokenDecryptionCert:Path` | | Optional. A .pfx with the private key, so the API reads encrypted tokens itself instead of asking userinfo. |
| `Oidc:TokenDecryptionCert:Password` | | The password of that .pfx. |
| `Oidc:TokenDecryptionKey` | | Instead of a certificate: the base64 symmetric encryption key. |
| `Oidc:Scopes` | `openid profile email` | Returned to the PWA by `/api/config`. |
| `Oidc:RequireHttpsMetadata` | `true` | Set to `false` only for a provider on plain http on your LAN. |
| `Files:MaxFileBytes` | 20 MiB | The largest file accepted. The app shrinks photos on the phone before uploading. |
| `Cors:Origins` | `[]` | Extra browser origins. Development adds `http://localhost:5173`. |

### OIDC provider

Register the app with your provider as follows:

| Setting | Value |
|---|---|
| Client type | **Public** (no client secret). The PWA runs in the browser and cannot keep a secret. |
| Grant / flow | **Authorization Code with PKCE** (S256). No implicit flow, no client credentials. |
| Redirect URI | The app's address **with the trailing slash**, for example `https://floorplan.example.com/`. If the app is in a subfolder: `https://example.com/floorplan/`. It must match exactly. |
| Post-logout redirect URI | The same address, `https://floorplan.example.com/`. *Log out* ends the session at the provider (its `end_session_endpoint`) and comes back here. |
| Web origin (CORS) | The app's origin, `https://floorplan.example.com`. The browser calls the provider's token endpoint directly. |
| Scopes | `openid profile email`, plus `offline_access` if your provider only gives refresh tokens with it (see below). |
| Access token | A **JWT signed with an asymmetric key** (RS256 or ES256), so the API can check it against the provider's public keys. |

The client id goes into `OIDC_CLIENT_ID`, and the provider's issuer URL into `OIDC_AUTHORITY`. The PWA reads both from `/api/config`, so nothing is built into the app.

**Staying signed in.** The app renews the access token without leaving the page: shortly before it expires, when the app comes back to the foreground, when it is opened again after the token expired, and when the API answers 401.
- With a **refresh token** it asks the token endpoint. Allow the *refresh token* grant for the client, and set `OIDC_SCOPES=openid profile email offline_access` if your provider needs that scope for refresh tokens.
- Without one, or when the refresh token is refused, it signs in again in a hidden iframe (`prompt=none`) that uses your session at the provider. That comes back to the same redirect URI, so nothing extra has to be registered. It needs the provider to allow its authorize page in a frame of the app, and its session cookie to reach that frame: easiest when the provider and the app share a domain (`auth.example.com` and `floorplan.example.com`).
- Only when both fail (the provider session ended too) are you logged out.

- **Authentik:**
  1. Create an *OAuth2/OpenID Provider*. Set *Client type* to **Public**.
  2. Add the redirect URI, `https://floorplan.example.com/`, with matching mode *Strict*. If your version lists post-logout redirect URIs separately, add the same address there too.
  3. Under *Signing Key*, choose a certificate (for example *authentik Self-signed Certificate*). Without one, tokens are signed with HS256 and the API cannot check them.
  4. Under *Scopes*, add `openid`, `profile`, `email` and `offline_access`, and set `OIDC_SCOPES=openid profile email offline_access`. Otherwise Authentik gives no refresh token.
  5. Create an *Application* that uses this provider. Its slug is part of the authority: `https://<authentik>/application/o/<app-slug>/`. Access tokens have `aud` = the client id, so no audience setting is needed.
- **Keycloak:**
  1. Create an *OpenID Connect* client. Turn *Client authentication* off, and turn *Standard flow* on.
  2. Under *Advanced*, set *Proof Key for Code Exchange Code Challenge Method* to `S256`.
  3. Set *Valid redirect URIs* to `https://floorplan.example.com/`, *Valid post logout redirect URIs* to the same address (or `+`), and *Web origins* to `https://floorplan.example.com` (or `+`).
  4. The authority is `https://<keycloak>/realms/<realm>`. Keycloak gives refresh tokens without extra scopes. Its access tokens have `aud: account` by default: either add an *Audience* mapper for the client id, or set `OIDC_AUDIENCE=account`.

- **OpenIddict:** register a public client (`ClientType = Public`) with the *authorization code* and *refresh token* grants, the endpoints *authorization*, *token* and *end session*, `RequirePkce`, and the redirect and post-logout redirect URIs above. The authority is the issuer, for example `https://auth.example.com/`.
  OpenIddict **encrypts access tokens** by default, so the API cannot read them. It sends them to the userinfo endpoint instead, which needs nothing extra: the client only needs the `openid` scope (and `profile` and `email` for the name and email). The answer is reused for 5 minutes per token, so a revoked token can still work for up to 5 minutes. The userinfo endpoint accepts a token issued to any client of the provider, so the API cannot check that the token was made for this app. To get that check, either call `DisableAccessTokenEncryption()` on the OpenIddict server, or give the API the encryption certificate (`Oidc__TokenDecryptionCert__Path` and `__Password`) or the symmetric key (`Oidc__TokenDecryptionKey`). OpenIddict access tokens have no `aud` unless the token has resources; the API then accepts them by their `client_id`.

If sign-in works but the API answers 401, the container log says why: look for `Access token refused:`.

Users are created on their first request, from the token's `sub`, `name` (or `preferred_username`) and `email`. If the access token has no email, the provider's userinfo endpoint is asked. An email that the provider marks as `email_verified: false` is ignored, so nobody can claim a share by setting someone else's address.

## Docker

The root `Dockerfile` builds the PWA (`npm ci && npm run build`), publishes the API, and copies `dist/` into the API's `wwwroot`. The container listens on port 8080 and keeps everything in the `/data` volume.

Each version tag (`v0.9.0`) is built by the *Docker image* workflow and pushed to `ghcr.io/lieven121/floorplan` as `0.9.0`, `0.9` and `latest`, for `linux/amd64` and `linux/arm64`. To build it yourself:

```bash
cat > .env <<'ENV'
OIDC_AUTHORITY=https://auth.example.com/application/o/floorplan/
OIDC_CLIENT_ID=floorplan
ENV
docker compose up -d --build
```

- **Reverse proxy:** put the container behind your TLS proxy (Traefik, Caddy, nginx). `X-Forwarded-For`, `-Proto` and `-Host` are trusted from any address, so do not expose port 8080 directly to the internet.
- **Backups:** back up the `floorplan-data` volume. It holds `floorplan.db` and the files.

## API

Everything is under `/api` and needs `Authorization: Bearer <access token>`, except `/api/config` and `/api/health`. Without a valid token, every other endpoint returns **401**. JSON is camelCase, and dates are UTC ISO-8601. Ids (home, room, file) are 1 to 64 characters from `A-Z a-z 0-9 - _`. Responses may carry a few extra fields beyond the ones listed (for example `owner` or `homeId`); clients can ignore them.

| Method | Path | Who | Body and result |
|---|---|---|---|
| GET | `/config` | anyone | `{ authEnabled, authority, clientId, scopes }`. With auth off it also has `devUsers: ["dev", "alice", "bob"]`. |
| GET | `/health` | anyone | `{ status: "ok" }` |
| GET | `/me` | signed in | `{ id, name, email }` |
| GET | `/homes` | signed in | `[{ id, name, role, version, updatedAt, ownerName }]`: homes you own and homes shared with you, newest first. |
| POST | `/homes` | signed in | Body: `{ id, name, document }`. The id is made by the client. Returns 201 with the summary (`version: 1`), or 409 if the id exists. |
| GET | `/homes/{id}` | any role | `{ id, name, role, version, updatedAt, ownerName, document }`. `document` is the project JSON, stored as-is. |
| PUT | `/homes/{id}` | owner, editor | Body: `{ name, document, version }`, where `version` is the one you last saw. Returns 200 `{ version, updatedAt }`. A stale version gets 409 `{ version: currentVersion }`. A viewer gets 403. `version: 0` on an unused id creates the home (201). |
| DELETE | `/homes/{id}` | owner | 204. Also deletes the shares, the versions, the file rows and `{DataDir}/{id}/`. |
| GET | `/homes/{id}/shares` | owner | `[{ email, role }]` |
| POST | `/homes/{id}/shares` | owner | Body: `{ email, role: "viewer" \| "editor" }`. Adds the share, or changes its role. |
| DELETE | `/homes/{id}/shares/{email}` | owner | 204. URL-encode the email. |
| POST | `/homes/{id}/rooms/{roomId}/files` | owner, editor | multipart: `id` (the client's file id; reusing it replaces the file) and `file`. Returns `{ id, name, mime, size }`. |
| GET | `/homes/{id}/files` | any role | The files of the home. |
| GET | `/files/{id}` | any role on its home | The bytes, with Content-Type. |
| DELETE | `/files/{id}` | owner, editor | 204 |
| GET | `/homes/{id}/versions` | any role | `[{ id, name, createdAt, auto, createdBy }]`, newest first. |
| POST | `/homes/{id}/versions` | owner, editor | Body: `{ name, document, auto }`. Saves a snapshot of the plan (201). With `auto: true` only the newest 10 automatic versions are kept; named ones stay. |
| GET | `/homes/{id}/versions/{versionId}` | any role | The summary plus `document`. |
| DELETE | `/homes/{id}/versions/{versionId}` | owner, editor | 204 |

Access rules: someone with no access gets **404**, so they cannot tell that the home exists. A viewer who tries to write gets **403**.

### Files

- **Location:** each file is saved at `{DataDir}/{homeId}/{roomId}/{fileId}.{ext}`. The ids are checked against the pattern above, and every resolved path is checked to stay inside `DataDir`. The uploaded file name is only used for display.
- **Size:** files up to 20 MiB are stored as they are; larger ones get **413**. The app shrinks photos over 4 MiB to at most 4000 px (JPEG) on the phone before uploading, so photos stay well under the limit.
- **Downloads:** files are served with `Content-Security-Policy: sandbox` and `nosniff`. Only images, PDFs and plain text are shown inline; everything else downloads as `application/octet-stream`.

### Mapping to the PWA's `StorageAdapter`

| `StorageAdapter` | API |
|---|---|
| `list()` | `GET /homes` |
| `get(id)` | `GET /homes/{id}` → `.document`. Keep `.version` for the next save. |
| `put(project)` | New home: `POST /homes` with `{ id, name, document }`. Existing home: `PUT /homes/{id}` with `{ name, document, version }`. On 409, reload or merge. |
| `delete(id)` | `DELETE /homes/{id}` |
| `putFile(id, blob)` | `POST /homes/{homeId}/rooms/{roomId}/files` with `id` in the form. The adapter needs the home and room the file belongs to. |
| `getFile(id)` | `GET /files/{id}` with the bearer token, read as a blob. |
| `deleteFiles(ids)` | `DELETE /files/{id}` for each id. |
| `listVersions` / `putVersion` / `getVersion` / `deleteVersion` | `/homes/{id}/versions[/{versionId}]` |

## Database

The schema is managed with EF Core migrations in `Floorplan.Api/Database/Migrations`, which are applied at startup. To change the model, run:

```bash
cd server
dotnet ef migrations add <Name> --project Floorplan.Api --output-dir Database/Migrations
```

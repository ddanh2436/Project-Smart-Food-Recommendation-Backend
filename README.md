# VietNomNom — Backend API

NestJS + MongoDB API for the VietNomNom food recommendation app. It owns
authentication, restaurant and review data, and orchestrates calls to the
separate FastAPI AI service.

Deployment: see [DEPLOY.md](./DEPLOY.md).

## Architecture

```
Frontend (Vercel) ──▶ this API (Render) ──▶ MongoDB Atlas
                            │
                            └──▶ AI service (Hugging Face Spaces)
                                 recommend · chat · sentiment · vision
```

The API never talks to a model directly. Everything AI-related goes through
`src/common/ai/ai.service.ts`, which is the single place that knows the AI
service's URL, timeouts and failure behaviour. Every AI call degrades
gracefully, because a free Hugging Face Space sleeps and cold-starts in ~50s —
a sleeping model must never stop a user from browsing or posting a review.

## Endpoints

### Auth
| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/register` | 5/min per IP |
| `POST` | `/auth/login` | 10/min per IP |
| `POST` | `/auth/refresh` | takes only the refresh token; the user id comes from its verified payload |
| `POST` | `/auth/logout` | clears the stored refresh-token hash 🔒 |
| `GET` | `/auth/google` → `/auth/google/callback` | tokens returned in the URL **fragment** |
| `GET` `PATCH` | `/auth/profile` | 🔒 |

### Restaurants
| Method | Path | Notes |
|---|---|---|
| `GET` | `/restaurants` | validated query DTO; AI-ranked when `search` is set |
| `GET` | `/restaurants/:id` | |
| `GET` | `/restaurants/nearby` | `?lat=&lon=&radius=&limit=` |
| `POST` | `/restaurants/chat` | conversational search, accepts `history` |
| `POST` | `/restaurants/search-by-image` | 8MB limit, image MIME types only |

### Reviews
| Method | Path | Notes |
|---|---|---|
| `GET` | `/reviews?url=` | |
| `GET` | `/reviews/insights?url=` | aspect-level AI digest |
| `POST` | `/reviews` | 5/min; auth optional, attributed when present |
| `DELETE` | `/reviews/:id` | own reviews only 🔒 |
| `POST` | `/reviews/migrate-sentiment` | requires `x-admin-token` 🔑 |

### Health
| Method | Path | Notes |
|---|---|---|
| `GET` | `/` | service info |
| `GET` | `/health` | database state + AI URL; used by Render, exempt from rate limiting |

🔒 requires a Bearer access token · 🔑 requires `x-admin-token`

## Configuration

Copy `.env.example` to `.env`. The app **exits on boot** if `MONGODB_URI`,
`JWT_SECRET` or `JWT_REFRESH_SECRET` is missing, and also if the two JWT secrets
are identical — otherwise an access token would be accepted as a refresh token.

## What was fixed

This service had several serious defects. They are documented here so they are
not reintroduced.

**Security**

- `GET/PATCH/DELETE /users/:id` had **no guards at all** — anyone could list
  every user and modify or delete any account. Now authenticated, and restricted
  to the caller's own record.
- `POST /reviews/migrate-sentiment` was public, triggering a full-collection
  scan plus one AI inference per row on demand. Now admin-only.
- Refresh tokens were stored **in plaintext**. The `_hashData` helper existed but
  was never called, while the refresh path compared with `bcrypt.compare` — so
  refresh could never succeed *and* a database dump handed out live sessions.
- `hashedRefreshToken` had **no `@Prop()` decorator**, so Mongoose silently
  discarded it on every save. This is why users were logged out after 15 minutes.
- `ValidationPipe` ran without `whitelist`, so unknown body fields flowed into
  Mongoose updates — a mass-assignment hole. `CreateReviewDto` had no validation
  decorators whatsoever, letting a client set its own AI sentiment label.
- Google accounts got a password from `Math.random().toString(36).substring(7)`
  — roughly 6 characters from a predictable PRNG. Now 32 random bytes.
- Login threw `NotFoundException` for an unknown email and `Unauthorized` for a
  wrong password, which allowed email enumeration. Both now return the same 401.
- OAuth tokens were passed in the redirect **query string**, where they land in
  server logs, browser history and the `Referer` header. Now in the fragment.
- `origin: '*'` with `credentials: true` is invalid per the CORS spec, so the
  config was simultaneously wide open and broken for credentialed requests.
- Startup logged environment variables to stdout.
- No rate limiting anywhere; no `helmet`.

**Correctness**

- `update(+id)` / `remove(+id)` coerced a Mongo ObjectId with `+`, producing
  `NaN`. Both were unreachable stubs returning strings.
- `isOpenNow` returned `false` for an empty hours field, silently hiding every
  restaurant whose opening hours had not been crawled.
- The user's raw search string went straight into a `$regex`, so `"c++("` threw
  and a crafted input could cause catastrophic backtracking.
- `?limit=999999` was accepted and passed to the database.

**Performance**

- Any `openNow=true` request loaded the **entire** collection into memory with
  no cap. The in-memory path is now bounded and only used where Mongo genuinely
  cannot express the query.
- The sentiment backfill made one HTTP request and one `save()` per review in a
  sequential loop. It now batches through the AI service and uses `bulkWrite`.
- No indexes existed for the queries the app actually issues; every listing page
  was a full scan plus an in-memory sort.

## Development

```bash
npm install
npm run start:dev     # watch mode, http://localhost:3001
npm test              # unit tests
npm run test:e2e      # needs a reachable MONGODB_URI
npm run typecheck
npm run lint
```

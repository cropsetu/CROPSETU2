# CropSetu

AI-powered farming platform for Indian farmers. Crop disease scanning, FarmMind
agronomic chat, mandi prices, weather advisories, animal trade, machinery and
labour rental, and government scheme guidance — in 10+ Indian languages.

## Repository layout

```
CROPSETU2/
├── backend/      Express.js 4 + Prisma 5 + PostgreSQL + Redis + Socket.IO
│                 Primary REST API. Auth (OTP), users, farms, market,
│                 community, AgriStore, AnimalTrade, Rent, Schemes.
├── fastapi/      FastAPI 0.135 + asyncpg + Pydantic v2
│                 AI service. Calls Claude / Groq / Gemini. 5-agent crop
│                 disease pipeline, FarmMind chat, smart alerts,
│                 AgriPredict price forecasts, KisanRakshak pest predict.
├── frontend/     Expo 54 + React Native 0.81 + React 19
│                 Mobile app (Android primary, iOS supported). JavaScript.
├── docs/         Architecture and review documents.
└── README.md
```

## Local development

Each service is independent. Open three terminals.

### Backend (Express)

```bash
cd backend
cp .env.example .env          # fill in your keys
npm install
npx prisma migrate dev        # creates local Postgres schema
npm run dev                   # starts on http://localhost:3001/api/v1
```

Required env: `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `REDIS_URL`,
`AI_BACKEND_URL` (URL of the running fastapi service).
Optional: `MSG91_AUTH_KEY` (real SMS), `CLOUDINARY_*`, `GROQ_API_KEY`,
`ANTHROPIC_API_KEY`, `SARVAM_API_KEY`, `DATA_GOV_API_KEY`,
`OPENWEATHER_API_KEY`, `FIELD_ENCRYPTION_KEY`.

### FastAPI AI service

```bash
cd fastapi
cp .env.example .env
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload --port 8001
```

Required env: `DATABASE_URL` (same Postgres as backend), at least one of
`GROQ_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`.

### Frontend (Expo)

```bash
cd frontend
npm install
npx expo start
```

The Metro bundler picks up the dev API URL from `src/constants/config.js`.
On a physical device, set `DEV_LAN_IP` to your Mac's LAN IP and switch
`DEV_HOST` accordingly.

## Production

Deployed on Railway (backend + fastapi + Postgres + Redis) and EAS
(mobile app). Production env vars are set in each service's Railway
"Variables" tab — never committed.

Health probes:
- `GET /healthz` — liveness, no dependencies.
- `GET /readyz`  — readiness, fails 503 if Postgres is unreachable.

## Documentation

- [docs/reviews/shared.md](docs/reviews/shared.md) — cross-cutting
  production-readiness review (secrets, schema, deploy, CI).
- [docs/reviews/backend-express.md](docs/reviews/backend-express.md)
- [docs/reviews/fastapi.md](docs/reviews/fastapi.md)
- [docs/reviews/frontend-rn.md](docs/reviews/frontend-rn.md)

## Security

Never commit `.env` files. The repository's `.gitignore` excludes them
explicitly; the `.env.example` files document required keys without
values. If you ever paste a credential into a chat / log / commit, treat
it as compromised and rotate it immediately.

# FarmEasy Backend API

Node.js + Express + PostgreSQL + Redis backend for the FarmEasy agriculture app.

---

## Tech Stack

| Layer        | Technology                        |
|-------------|-----------------------------------|
| Runtime      | Node.js 18+ (ES Modules)          |
| Framework    | Express 4                         |
| ORM          | Prisma 5                          |
| Database     | PostgreSQL 16                     |
| Cache        | Redis 7                           |
| Auth         | JWT (15 min) + Refresh token (30d)|
| OTP SMS      | MSG91                             |
| Images       | Cloudinary                        |
| Real-time    | Socket.io (Animal Trade chat)     |
| Push         | Expo Push Notifications           |

---

## Quick Start

### Prerequisites
- Node.js ≥ 18
- PostgreSQL 16 running locally or hosted
- Redis running locally or hosted (optional for dev)

### 1. Install dependencies
```bash
cd farmeasy-backend
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and JWT_SECRET
```

### 3. Set up the database
```bash
# Create tables from Prisma schema
npm run db:push

# (Or use migrations for production)
npm run db:migrate

# Generate Prisma client
npm run db:generate

# Seed categories + sample products
npm run db:seed
```

### 4. Start the server
```bash
# Development (hot reload)
npm run dev

# Production
npm start
```

Server starts at `http://localhost:3000`

---

## API Reference

### Base URL
```
http://localhost:3000/api/v1
```

### Authentication Flow
```
POST /auth/send-otp     { phone: "9876543210" }
  → { sessionId }

POST /auth/verify-otp   { phone, otp, name? }
  → { accessToken, refreshToken, isNewUser, user }

POST /auth/refresh       { userId, refreshToken }
  → { accessToken, refreshToken }

POST /auth/logout        { refreshToken }   (Authorization: Bearer <token>)
POST /auth/logout-all                       (Authorization: Bearer <token>)
```

### User
```
GET  /users/me
PUT  /users/me              { name?, language?, images? }   multipart
PUT  /users/me/farm         { village, district, state, pincode, landAcres, cropTypes, soilType, irrigationType }
POST /users/me/push-token   { token, platform }
```

### AgriStore
```
GET  /agristore/categories
GET  /agristore/products               ?category&search&featured&page&limit
GET  /agristore/products/:id
GET  /agristore/cart                   (auth)
POST /agristore/cart                   { productId, quantity }
PUT  /agristore/cart/:productId        { quantity }
DELETE /agristore/cart/:productId
POST /agristore/orders                 { deliveryAddress, paymentMethod, notes }
GET  /agristore/orders                 (auth)
GET  /agristore/orders/:id             (auth)
POST /agristore/products/:id/review    { rating, comment }
```

### Animal Trade
```
GET  /animals              ?animal&search&minPrice&maxPrice&district&page&limit
GET  /animals/my           (auth)
GET  /animals/:id
POST /animals              (auth, multipart images)
PUT  /animals/:id          (auth, owner)
DELETE /animals/:id        (auth, owner)
POST /animals/:id/chat     (auth) — initiate/get chat
GET  /animals/:id/chats    (auth, seller only) — list all chats
```

### Community
```
GET  /community/posts               ?category&search&page&limit
GET  /community/posts/:id
POST /community/posts               (auth, multipart images)
POST /community/posts/:id/like      (auth) — toggle
POST /community/posts/:id/bookmark  (auth) — toggle
GET  /community/posts/:id/comments
POST /community/posts/:id/comments  { text, parentId? }
DELETE /community/comments/:id      (auth, author)
```

### Response format
```json
{ "success": true,  "data": { ... }, "meta": { "total": 50, "page": 1, "totalPages": 3 } }
{ "success": false, "error": { "message": "...", "details": [...] } }
```

---

## Socket.io (Real-time Chat)

Connect with your JWT access token:
```js
const socket = io('http://localhost:3000', {
  auth: { token: accessToken },
  transports: ['websocket'],
});

socket.emit('join_chat',    { chatId });
socket.emit('send_message', { chatId, text: 'Hello!' });
socket.emit('mark_read',    { chatId });

socket.on('chat_history', (messages) => { /* initial load */ });
socket.on('new_message',  (message)  => { /* live message */ });
socket.on('messages_read',({ chatId, userId }) => { /* read receipt */ });
```

---

## Project Structure

```
farmeasy-backend/
├── prisma/
│   ├── schema.prisma       ← All DB models
│   └── seed.js             ← Seed data
├── src/
│   ├── config/
│   │   ├── env.js          ← Typed environment variables
│   │   ├── db.js           ← Prisma client singleton
│   │   ├── redis.js        ← Redis client
│   │   └── cloudinary.js   ← Cloudinary + multer uploader
│   ├── middleware/
│   │   ├── auth.js         ← JWT authenticate, requireRole, optionalAuth
│   │   └── validate.js     ← express-validator result handler
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── agristore.routes.js
│   │   ├── animaltrade.routes.js
│   │   └── community.routes.js
│   ├── services/
│   │   └── otp.service.js  ← Send + verify OTP (MSG91 + dev fallback)
│   ├── socket/
│   │   └── chat.socket.js  ← Socket.io real-time chat
│   ├── utils/
│   │   ├── jwt.js          ← Sign, verify, refresh tokens
│   │   └── response.js     ← Standardised response helpers
│   ├── app.js              ← Express app (middleware, routes)
│   └── server.js           ← HTTP server + Socket.io bootstrap
├── .env.example
├── .gitignore
└── package.json
```

---

## Development Notes

- **OTP in dev**: If `MSG91_AUTH_KEY` is not set, OTP is printed to the console — no SMS needed during development.
- **Prisma Studio**: Run `npm run db:studio` to browse your DB with a visual UI.
- **Image uploads**: Cloudinary credentials are optional in dev. Leave them blank to get upload errors (won't break auth/chat/posts).
# Farmeasy-frontend
# Farmeasy-frontend

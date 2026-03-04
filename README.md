## Express + PostgreSQL Monolith API

Node.js backend built with **Express** and **PostgreSQL** (monolithic architecture) including:

- **Auth**: Register and login with JWT
- **CRUD**: Protected `items` resource (create, read, update, delete)

### 1. Requirements

- Node.js 18+
- PostgreSQL 13+

### 2. Setup

```bash
cd Backend/node-express-pg-api
cp .env.example .env
```

Edit `.env` as needed:

- **DATABASE_URL**: e.g. `postgres://postgres:postgres@localhost:5432/express_pg_api`
- **JWT_SECRET**: any random string

Create the database in PostgreSQL:

```sql
CREATE DATABASE express_pg_api;
```

### 3. Run the server

```bash
npm install
npm run dev
```

The API listens on `http://localhost:4000` by default.

### 4. Endpoints

- **Health**
  - `GET /health`

- **Auth**
  - `POST /auth/register` – body: `{ "email": "user@example.com", "password": "secret" }`
  - `POST /auth/login` – body: `{ "email": "user@example.com", "password": "secret" }`
    - Returns: `{ "token": "JWT...", "user": { "id", "email" } }`

- **Items** (requires `Authorization: Bearer <token>`)
  - `GET /items`
  - `GET /items/:id`
  - `POST /items` – body: `{ "title": "My item", "description": "optional" }`
  - `PUT /items/:id` – body: `{ "title": "New title", "description": "New desc" }`
  - `DELETE /items/:id`

### 5. Monolith vs microservice

This project is a **monolith**: a single service containing auth + CRUD.
You can later split it into microservices (e.g. `auth-service`, `items-service`) by extracting modules/routes into separate apps and giving each its own database/schema if needed.


### NEW SERVICE
New API Structure for Participants
With this separation, participant-related endpoints are now accessible under a cleaner /participants path:

GET /participants - List all participants across all your events.
GET /participants/:eventId - List participants for a specific event.
GET /participants/:eventId/:id - Get details of a specific participant.
POST /participants/:eventId - Register a new participant for an event.
PATCH /participants/:eventId/:id - Update a participant's status.
DELETE /participants/:eventId/:id - Remove a participant.

### CLIENT API (NO AUTH)
Public endpoints for client-side applications:

- `GET /client/events` – List all active events with nested data (rundowns, brands, promo codes).
- `GET /client/events/featured` – Get a single random active event.
- `GET /client/events/:id` – Get details for a specific event by ID.
- `GET /client/organizers/:domain` – Get organizer profile and their active events by domain.
- `GET /client/:domain/featured` – Get a single random active event from a specific organizer by domain.
- `POST /client/participants` – Register for an event.

### ORGANIZERS API
Manage event organizers and their relationships with events:

- `GET /organizers`
  - Goal: List all organizers.
  - Optional search query: `?name=...` or `?domain=...`
- `POST /organizers`
  - Goal: Create a new organizer.
  - Request Body: `{ "name": "...", "domain": "...", "scope": "...", "category": "...", "format": "hybrid|non-hybrid" }`
  - Note: `domain` must be unique and URL-friendly.
- `GET /organizers/:id`
  - Goal: Get details for a specific organizer.
- `GET /organizers/:id/events`
  - Goal: Get all events associated with a specific organizer.
- `POST /organizers/:id/events`
  - Goal: Link an existing event to an organizer.
  - Request Body: `{ "event_id": number }`
- `DELETE /organizers/:id/events/:eventId`
  - Goal: Unlink an event from an organizer.
- `DELETE /organizers/:id`
  - Goal: Remove an organizer and its associations.

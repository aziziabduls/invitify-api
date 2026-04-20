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

### ATTENDANCE SERVICE
Track and manage participant attendance for your events:

- `GET /participants/attendance`
  - **Goal**: List all attendance data for events owned by the user.
  - **Header**: `Authorization: Bearer <token>`
  - **Returns**: Array of `{ id, customer_name, customer_email, event_name, attended_at, status }`

- `POST /participants/check-in`
  - **Goal**: Check in a participant using QR code data or manual entry.
  - **Header**: `Authorization: Bearer <token>`
  - **Request Body (QR Code Format)**:
    ```json
    {
      "eventId": 1,
      "participantId": "P-1-101",
      "email": "user@example.com",
      "type": "attendance_check"
    }
    ```
  - **Request Body (Manual Format)**:
    ```json
    {
      "participantId": "user@example.com",
      "type": "attendance_check"
    }
    ```
  - **Validation**:
    - Verifies event ownership by the authenticated user.
    - Prevents duplicate check-ins.
    - Updates `attended_at` timestamp.

#### Testing with CURL

1. **Get Attendance List**:
   ```bash
   curl -X GET http://localhost:4000/participants/attendance \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

2. **Check-in Participant**:
   ```bash
   curl -X POST http://localhost:4000/participants/check-in \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "eventId": 1,
       "participantId": "P-1-1",
       "type": "attendance_check"
     }'
   ```

### PARTICIPANT MANAGEMENT
Authenticated endpoints for managing participants and free-event email notifications:

- `POST /participants/:eventId`
  - Registers a participant for an event you own.
  - Behavior for free events: If the event is free (`events.is_free = true` or `price <= 0`), the API automatically sends an email to the participant with a JSON payload to be used for booth check-in:
    ```json
    {
      "eventId": 9,
      "participantId": 8,
      "email": "azi@mail.com",
      "type": "attendance_check"
    }
    ```
  - Requires environment variables for email:
    - `EMAIL_USER` and `EMAIL_PASS` (Gmail example) used by `src/services/emailService.js`.

- `POST /participants/:eventId/:id/set_as_paid`
  - Sets the participant status to `paid`.
  - Header: `Authorization: Bearer <token>`
  - Sends a confirmation email with an embedded QR code image (PNG data URL). The QR encodes:
    ```json
    {
      "eventId": 9,
      "participantId": 8,
      "email": "azi@mail.com",
      "type": "attendance_check"
    }
    ```
  - Requires `EMAIL_USER`, `EMAIL_PASS` (Gmail example) and the `qrcode` package.

- `POST /participants/:eventId/:id/block`
  - Sets the participant status to `blocked`.
  - Header: `Authorization: Bearer <token>`

- `POST /participants/:eventId/:id/remove`
  - Removes the participant (convenience wrapper around `DELETE`).
  - Header: `Authorization: Bearer <token>`

#### Testing with CURL

1. Set participant as paid:
   ```bash
   curl -X POST http://localhost:4000/participants/9/8/set_as_paid \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

2. Block participant:
   ```bash
   curl -X POST http://localhost:4000/participants/9/8/block \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

3. Remove participant:
   ```bash
   curl -X POST http://localhost:4000/participants/9/8/remove \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

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

---

## Role System
- **SUPER_ADMIN**: Full access to all organizers, events, participants, and role management. Can see all data across the platform.
- **EVENT_ORGANIZER**: Manage their own organizers, events, and participants. Access is isolated to their own records.
- **INCIDENTAL**: Minimal access, primarily used for booth attendance check-in. Can show all menus but is restricted from modifying data outside of attendance.

## Admin Service (SUPER_ADMIN only)
- **GET /admin/users**: List all users with their roles.
- **PATCH /admin/users/:id/role**: Update a user's role.
  - Body: `{ "role_name": "SUPER_ADMIN" | "EVENT_ORGANIZER" | "INCIDENTAL" }`
- **GET /admin/roles**: List all roles.
- **GET /admin/menus**: List all menus.
- **GET /admin/roles/:id/menus**: Get menus assigned to a role.
- **POST /admin/roles/:id/menus**: Assign menus to a role.
  - Body: `{ "menu_ids": [number, ...] }`

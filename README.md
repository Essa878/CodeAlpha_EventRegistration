# CodeAlpha_EventRegistration

An Event Registration System built with **Express.js** and **SQLite** for the CodeAlpha Backend Development internship.

Organizers create events; attendees register, view, and cancel their registrations. Authentication is handled with JWT + bcrypt.

## Features

- User accounts with roles: **attendee** and **organizer**
- JWT authentication (`Authorization: Bearer <token>`)
- Organizers create, update, and delete their own events
- Attendees browse/search events, register, and cancel registrations
- Capacity handling — events show remaining spots and reject when full
- Organizers can view the attendee list for their events
- Basic frontend covering login, event browsing, registration, and organizer tools

## Tech Stack

- Node.js + Express 5
- SQLite via `better-sqlite3`
- `bcryptjs` for password hashing
- `jsonwebtoken` for auth tokens
- `dotenv` for configuration

## Getting Started

```bash
npm install
cp .env.example .env   # optional; defaults work out of the box
npm start
```

Open <http://localhost:3001>. For auto-reload: `npm run dev`.

## Data Model

- **users** — id, name, email (unique), password_hash, role, created_at
- **events** — id, organizer_id, title, description, location, starts_at, capacity, created_at
- **registrations** — id, event_id, user_id, status (`registered`/`cancelled`), created_at, unique(event_id, user_id)

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account (`name`, `email`, `password`, `role`) |
| POST | `/api/auth/login` | Login, returns token |
| GET | `/api/auth/me` | Current user (auth) |

### Events
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/events?search=` | List/search events |
| GET | `/api/events/:id` | Event details |
| POST | `/api/events` | Create event (organizer) |
| PUT | `/api/events/:id` | Update own event (organizer) |
| DELETE | `/api/events/:id` | Delete own event (organizer) |
| GET | `/api/events/:id/registrations` | List attendees (organizer) |

### Registrations
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/events/:id/register` | Register for event (attendee) |
| GET | `/api/registrations/me` | My registrations (auth) |
| POST | `/api/registrations/:id/cancel` | Cancel a registration |
| DELETE | `/api/registrations/:id` | Cancel a registration (alias) |

## Example Flow

```bash
# 1. Register an organizer
curl -X POST http://localhost:3001/api/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Ada","email":"ada@example.com","password":"secret1","role":"organizer"}'
# -> { "token": "...", "user": { ... } }

# 2. Create an event (use the token)
curl -X POST http://localhost:3001/api/events -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"title":"CodeAlpha Meetup","location":"Online","startsAt":"2026-12-01T10:00:00","capacity":50}'

# 3. As an attendee, register for it
curl -X POST http://localhost:3001/api/events/1/register -H "Authorization: Bearer <ATTENDEE_TOKEN>"
```

## Project Structure

```
CodeAlpha_EventRegistration/
├── public/index.html        # optional frontend
├── src/
│   ├── auth.js              # password + JWT helpers, middleware
│   ├── db.js                # SQLite schema
│   ├── server.js            # Express entry point
│   └── routes/
│       ├── auth.js
│       ├── events.js
│       └── registrations.js
├── .env.example
└── package.json
```

## License

MIT

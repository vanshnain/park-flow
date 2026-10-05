# ParkFlow Smart Parking Allocation System

ParkFlow is a full-stack parking convenience app for malls, hotels, restaurants, and other public destinations. Drivers register vehicles and request available spaces; administrators review requests, reserve or reassign spaces, and manage the lot. The existing vanilla HTML/CSS/JavaScript frontend and Express/MySQL backend have been retained and connected through a same-origin REST API.

## Features

- Email/password registration and login with bcrypt password hashes and signed JWT sessions.
- `USER` and `ADMIN` roles enforced by backend middleware.
- User dashboard, searchable/filterable parking inventory, vehicle management, parking requests, allocations, and profile editing.
- Admin dashboard statistics, user and vehicle directory, parking-space CRUD/status controls, request approval/rejection, allocation viewing and reassignment.
- Transactional slot requests and approvals, conflict detection, and allocation cancellation with slot release.
- Immediate slot allocation with hourly pricing (`₹25` or `₹35`) and a simulated checkout flow.
- Admin dashboard reports recorded demo-payment revenue; the app does not connect to a real payment processor.
- Demo seed data, responsive layouts, loading/empty/error states, and request feedback.

## Technology

- Frontend: HTML, CSS, and browser JavaScript.
- Backend: Node.js 22+, Express 5, `mysql2`, bcryptjs, jsonwebtoken, and dotenv.
- Database: MySQL 8+.
- Tests: Node.js built-in test runner with live API smoke tests.

## Project Layout

```text
parking/
  README.md
  backend/
    .env.example
    db/
      database.js
      schema.sql
      seed.js
    server.js
    package.json
  frontend/
    index.html
    script.js
    style.css
```

## Requirements

Install Node.js 22 or newer, npm, and MySQL 8 or newer. Create a MySQL account with permission to create/use the `parkease` database and alter its tables. The schema script upgrades the existing ParkFlow tables in place and keeps existing parking-space records.

## Setup

From the project folder:

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` with your local MySQL connection and a random JWT secret of at least 32 characters. For example, generate a secret with:

```bash
node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

Set up or upgrade the database as a MySQL administrator:

```bash
mysql -u root -p < db/schema.sql
```

Then create the demo accounts and sample data:

```bash
npm run seed
```

The seed command is repeatable. It updates the demo account passwords to the documented values and ensures sample vehicles, slots, a pending request, and an active allocation exist.

## Environment Variables

| Variable | Purpose | Example |
| --- | --- | --- |
| `PORT` | Express and frontend port | `5000` |
| `DB_HOST` | MySQL host | `127.0.0.1` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL user | `parkease_user` |
| `DB_PASSWORD` | MySQL password | Set locally; do not commit it |
| `DB_NAME` | Database name | `parkease` |
| `JWT_SECRET` | JWT signing secret, 32+ characters | Generate a random value |
| `CORS_ORIGIN` | Allowed browser origin | `http://localhost:5000` |

The real `.env` file is ignored by git. The backend refuses to start if database settings or a sufficiently long JWT secret are missing.

## Start the App

The Express server hosts both the frontend and `/api` routes:

```bash
cd backend
npm start
```

Open `http://localhost:5000`. For development with automatic backend restarts, use `npm run dev`.

If port 5000 is already in use, run the app on another port and set the matching allowed origin:

```bash
PORT=5001 CORS_ORIGIN=http://localhost:5001 npm start
```

Then open `http://localhost:5001`. The frontend and API use the same origin, so no separate frontend server is needed.

## Demo Credentials

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@parkflow.com` | `Admin123!` |
| User | `user@parkflow.com` | `User123!` |
| User with pending request | `student@parkflow.com` | `Student123!` |

Change these demo passwords before exposing the application beyond a local demonstration.

## API Overview

All endpoints return JSON except the frontend files. Protected endpoints require `Authorization: Bearer <token>`.

| Area | Endpoints |
| --- | --- |
| Health | `GET /api/health` |
| Authentication | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Users | `GET /api/users/me`, `PATCH /api/users/me`, admin-only `GET /api/users` |
| Vehicles | `GET/POST /api/vehicles`, `DELETE /api/vehicles/:id`, admin-only `GET /api/admin/vehicles` |
| Parking spaces | `GET /api/parking-slots` (filters: `q`, `zone`, `status`, `type`); admin-only `POST/PATCH/DELETE /api/parking-slots` |
| Requests | `GET/POST /api/parking-requests`, `DELETE /api/parking-requests/:id`; admin-only `POST /api/admin/parking-requests/:id/approve` and `/reject` |
| Allocations | `GET /api/allocations`, `POST /api/allocations/:id/cancel`; admin-only `PATCH /api/admin/allocations/:id/slot` |
| Admin dashboard | `GET /api/admin/dashboard` |

Parking-space states are `AVAILABLE`, `OCCUPIED`, `RESERVED`, and `MAINTENANCE`. A new booking atomically creates an approved request and active allocation, then reserves the space. The demo checkout records a simulated payment based on the selected number of hours; it does not collect or transfer real money. Historic requests awaiting review can still be handled in the admin request screen.

## Tests

Start the backend first, then run the API smoke suite from `backend/`:

```bash
API_BASE_URL=http://localhost:5000 npm test
```

Use `http://localhost:5001` in `API_BASE_URL` when running on port 5001. Tests check the live database health endpoint, demo login, authenticated user/admin routes, role protection, slot filtering, and admin dashboard/directory reads.

## Troubleshooting

- **MySQL access denied:** Verify `DB_HOST`, `DB_PORT`, `DB_USER`, and `DB_PASSWORD` in `backend/.env`, and confirm that the account can use the `parkease` database.
- **Missing tables or columns:** Run `mysql -u root -p < backend/db/schema.sql` from the project folder, then run `npm run seed` from `backend/`.
- **Port already in use:** Set a free `PORT` and matching `CORS_ORIGIN` before starting the backend.
- **Browser sign-in fails:** Run the seed command and use one of the demo credentials above. Check the browser is using the same port as the backend.
- **Request rejected as unavailable:** Another request may already be pending for that space, or the space may have been reserved while the page was open. Refresh the parking list and choose another available space.

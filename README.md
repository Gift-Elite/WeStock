# Stock Management System

Full-stack stock management system built with React (Vite), Node (Express), Tailwind CSS, Socket.IO and SQLite.

Features:
- Roles: Admin, Cashier, Stock Clerk
- Login & Signup
- Role-based dashboards (different UIs)
- Real-time updates via Socket.IO (calls, stock updates, confirmations)
- Basic SQL schema and seed data using SQLite

Quick start

1. Install dependencies for server and client

```bash
# from project root
cd server
npm install

cd ../client
npm install
```

2. Start server and client (in separate terminals)

```bash
# server
cd server
npm run dev

# client
cd client
npm run dev
```

3. Open the client app shown by Vite (usually http://localhost:5173)

Notes
- See `server/db/schema.sql` and `server/db/seed.sql` for schema and example seed data.
- Configure env vars using `server/.env.example` and `client/.env.example`.

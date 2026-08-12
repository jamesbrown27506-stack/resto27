# resto237

Food ordering platform for Douala, Cameroon. Customers browse restaurants, order delivery or pickup, reserve tables, earn loyalty points and review their orders. Restaurants manage their menu, orders and reservations; the platform admin oversees tenants and billing.

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4
- Supabase (Postgres, Auth, Storage) — service-role reads/writes server-side, RLS on the customer tables
- Recharts, date-fns, zod

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Requires a `.env.local` with the Supabase project URL and anon/service-role keys (see `.env.example` if present).

## Scripts

- `npm run dev` — development server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm start` — serve the production build

## Structure

- `src/app/(customer)/` — customer-facing area: account, orders, reviews, reservations, loyalty, addresses, favorites, profile, cart, checkout, browse
- `src/app/(public)/` — public marketing pages and the restaurant directory
- `src/app/(manager)/` and `src/app/(admin)/` — tenant and platform consoles
- `src/lib/data/` — server-side read layers and server actions
- `supabase/migrations/` — database schema

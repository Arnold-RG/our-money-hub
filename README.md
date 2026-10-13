# Our Money Hub

A private ledger for one household: income, spending, savings, projects, a plan board, and a shared chat. Each person has their own account. A household is visible only to the people who joined it.

The default currency is Polish złoty (PLN). Other currencies, including RWF, XAF, and CDF, can be chosen when the household is created.

## Live site

https://arnold-rg.github.io/our-money-hub/

This repository does not contain anyone’s books. Accounts and ledgers live in a private database. The public page shows the app with empty books until someone signs up. If the sign-in service is not connected yet, the page says so and does not accept accounts.

## On your computer

```bash
cp .env.example .env
npm install
npm test
npm run dev
```

Open http://localhost:5173

Put the Supabase project URL and the anon public key in `.env`. Leave `.env` uncommitted. Never put the service role key in `.env`, in GitHub, or in the client.

## Accounts

Sign up with an email and a password of at least 10 characters that includes letters and numbers. Passwords are hashed by Supabase Auth. This app never stores them.

After sign-in, create a household or join one with a code. The person who creates the household is its admin and receives a join code, shown once. The code is stored only as a hash. Issuing a new code from Settings retires the old one.

Admins and members of the same household share that household’s books and chat. Other accounts cannot read them. There is no special owner account.

## Connect the live site

GitHub Pages publishes the site from the `main` branch. Sign-in uses Supabase. These steps happen in the Supabase and GitHub settings.

1. Create a Supabase project.
2. Open the SQL editor and run all of `supabase/schema.sql`.
3. In Authentication → URL configuration, set the site URL to `https://arnold-rg.github.io/our-money-hub/` and add that same address plus `http://localhost:5173/` as redirect URLs.
4. In Authentication → Providers → Email, set the minimum password length to 10. Turn on leaked-password protection if the project offers it.
5. Leave Auth rate limits on. Sign-in attempts are limited per IP by Supabase.
6. In Project Settings → API, copy the project URL and the `anon` public key. Do not copy the `service_role` key.
7. In this GitHub repository, open Settings → Secrets and variables → Actions and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
8. Merge into `main`, or re-run the Deploy site workflow after those secrets exist. Pages updates only from `main`.

If the secrets are missing, the site still builds. It shows the not-connected screen instead of a sign-in form.

## What is inside

- Home, with the month’s household table
- People and chat
- Income, expenses, and other costs
- Savings pots
- Life projects
- Currency exchange
- Plans board
- Advisor
- Settings, including a JSON export and an optional import of books previously saved on this device

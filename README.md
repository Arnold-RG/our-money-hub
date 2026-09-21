# Our Money Hub (OMH)

Private household books. The admin creates the house and sends a join code or link. Members create their own username, email, and password. After that, **admin and members all add lines**, and **everyone sees the same household table on Home**.

Default currency is Polish złoty (PLN).

## Live site

https://arnold-rg.github.io/our-money-hub/

## Roles

- **Admin** — creates the household, uses an authenticator app, sends the invite, manages people and house settings.
- **Member** — joins with the code or link, adds their own income/expenses/savings/projects, and sees every other person’s data in the Home table.

## Security stack

1. Username or email + password (the browser can save it)
2. Authenticator app for the admin only
3. Face, fingerprint, or Windows Hello for every person on each device
4. Session closes after 20 idle minutes, or 8 hours
5. Five failed sign-ins lock that login for 15 minutes
6. Household data is encrypted before it is stored or synced

## What is inside

- Home: totals plus **one table of every household line** (all people, this month)
- Income, expenses, other costs
- Savings pots
- Life projects
- Currency exchange
- Plans board
- Advisor
- People (admin)
- Settings

## Run it on your computer

```bash
npm install
npm run dev
```

Then open http://localhost:5173

# Our Money Hub (OMH)

Private household books. The admin creates the house and sends a join code or link. Members create their own username, email, and password. After that, **admin and members all add lines**, **everyone sees the same household table on Home**, and **everyone can chat and open each person’s money, savings, and projects**.

Default currency is Polish złoty (PLN).

## Live site

https://arnold-rg.github.io/our-money-hub/

## Roles

- **Admin** — creates the household, sends the invite, manages people and house settings.
- **Member** — joins with the code or link, adds their own income/expenses/savings/projects, chats with the house, and sees every other person’s data.

## Security stack

1. Username or email + password (the browser can save it)
2. Face, fingerprint, or Windows Hello for every person on each device
3. Session closes after 20 idle minutes, or 8 hours
4. Five failed sign-ins lock that login for 15 minutes
5. Household data and chat are encrypted before they are stored or synced

## What is inside

- Home: totals plus **one table of every household line** (all people, this month)
- People: household group chat plus each member’s money, savings, and projects
- Income, expenses, other costs
- Savings pots
- Life projects
- Currency exchange
- Plans board
- Advisor
- Settings

## Run it on your computer

```bash
npm install
npm run dev
```

Then open http://localhost:5173

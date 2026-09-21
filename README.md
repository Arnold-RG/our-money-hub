# Our Money Hub (OMH)

A private household ledger for two people. The books are kept in Polish złoty by default. You and your partner can both see and edit income, expenses, savings, life projects, other costs, currency exchange, and a shared plans board.

Outside people cannot create an account. Guests only see what the admin opens for them.

## Live site

https://arnold-rg.github.io/our-money-hub/

## How to start

1. Open the live site.
2. Create the admin account. Use a password of at least 10 characters with letters and numbers.
3. Leave the main currency as **PLN**, or change it later in Settings.
4. Add your partner during setup, or later under People.
5. Copy the household join code from the last setup step or from Settings.
6. Your partner opens the same site, chooses **Join household**, pastes the code, and signs in with the email and password you created for them.

The join code is a household key. Do not post it in public messages or on this repository.

## What is inside

- Home: monthly surplus, both accounts side by side, savings and projects
- Income, expenses, and other costs
- Savings pots
- Life project budgets
- Currency exchange for PLN, EUR, USD, RWF, XAF (Congo-Brazzaville), CDF, and more
- Plans: a board for writing a project from the first step to the last

## Security

- There is no public signup.
- Passwords are stored as salted PBKDF2 hashes, never as plain text.
- Household data is encrypted with AES-GCM before it is saved or synced.
- Five failed sign-ins lock that email for fifteen minutes.
- A signed-in session closes after twenty idle minutes, or after eight hours.
- GitHub hosts only the application files. Household money records are not stored in this repository.

## Run it on your computer

```bash
npm install
npm run dev
```

Then open http://localhost:5173

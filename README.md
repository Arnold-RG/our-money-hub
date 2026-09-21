# Our Money Hub (OMH)

Private household books. Anyone can create their own household. Members join with a special code, an invite link, or a QR code shown on an admin device. The books are kept in Polish złoty by default.

## Live site

https://arnold-rg.github.io/our-money-hub/

## How to start

1. Open the live site.
2. Choose **Create a household**. Add your name, email, and a password of at least 10 characters with letters and numbers. You can also continue with Google, Apple, Facebook, Microsoft, or GitHub (email plus an OMH password if that provider is not switched on yet).
3. Scan the authenticator QR with Google Authenticator, Authy, or Microsoft Authenticator, then enter the 6-digit code.
4. Add Face ID, Touch ID, Windows Hello, or a fingerprint. This is required on each device.
5. Leave the main currency as **PLN**, or change it later in Settings.
6. Share the household join code, invite link, or QR from Settings on an admin device.
7. The other person opens the same site, chooses **Join with a code**, pastes the code or scans the QR, and creates their own login, authenticator, and biometric.

There is no single master account for the whole app. Each household has its own admins. The join code is a household key. Do not post it in public messages or on this repository.

## What is inside

- Home: monthly surplus, accounts side by side, savings and projects
- Income, expenses, and other costs
- Savings pots
- Life project budgets
- Currency exchange for PLN, EUR, USD, RWF, XAF (Congo-Brazzaville), CDF, and more
- Plans: a board for writing a project from the first step to the last
- Advisor: recalculates income, spending, and savings, then suggests how to keep more and live on this month’s pay
- People: more than one admin, members with full access, and guests with limited access
- Face ID, fingerprint, Windows Hello, and an authenticator app on sign-up and sign-in

## Security

- Every person creates their own email and password, or links a social account.
- An authenticator app and a device biometric are required.
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

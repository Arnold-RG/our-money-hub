# Our Money Hub (OMH)

Private household books. Anyone can create their own household. After an admin creates a house, the app generates a join code and a shareable link. Only that admin can send them. Members join with the code or link and create their own username, email, and password. The books are kept in Polish złoty by default.

## Live site

https://arnold-rg.github.io/our-money-hub/

## How to start

1. Open the live site.
2. Choose **Create a household**. Add your name, username, email, and a password of at least 10 characters with letters and numbers. You can also continue with Google. The browser can save those login details.
3. Scan the authenticator QR (admin only) with Google Authenticator, Authy, or Microsoft Authenticator, then enter the 6-digit code.
4. Add Face ID, Touch ID, Windows Hello, or a fingerprint. Admins and members both do this on each device.
5. The app then shows the household join **code** and **link**. Use **Send invite**, **Copy link**, or **Copy code**. Only the admin can share these. Find them again later in Settings.
6. The other person opens the same site, chooses **Join with a code or link**, pastes the code or opens the link, and creates their own username, email, and password. Then they add Face or fingerprint.

There is no single master account for the whole app. The join code is a household key. Do not post it in public messages or on this repository.

Google sign-in uses a Google Cloud web client ID. Add it once on the sign-in screen or in Settings. Authorized JavaScript origin: the live site origin. Authorized redirect: `https://arnold-rg.github.io/our-money-hub/oauth-google.html`.

## What is inside

- Home: monthly surplus, accounts side by side, savings and projects
- Income, expenses, and other costs
- Savings pots
- Life project budgets
- Currency exchange for PLN, EUR, USD, RWF, XAF (Congo-Brazzaville), CDF, and more
- Plans: a board for writing a project from the first step to the last
- Advisor: recalculates income, spending, and savings, then suggests how to keep more and live on this month’s pay
- People: household members, plus guests with limited access
- Face ID, fingerprint, or Windows Hello for every person; authenticator app for the admin only

## Security

- Members create their own username, email, and password. Admins can also use Google.
- Passwords are stored as salted PBKDF2 hashes, never as plain text.
- Household data is encrypted with AES-GCM before it is saved or synced.
- Five failed sign-ins lock that login for fifteen minutes.
- A signed-in session closes after twenty idle minutes, or after eight hours.
- GitHub hosts only the application files. Household money records are not stored in this repository.

## Run it on your computer

```bash
npm install
npm run dev
```

Then open http://localhost:5173

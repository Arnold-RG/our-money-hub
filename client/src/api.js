import {
  COST_CATEGORIES,
  CURRENCY_CODES,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PROJECT_STATUSES,
  RECURRING,
} from "./catalogs.js";
import {
  assertPassword,
  cleanEmail,
  cleanText,
  clearSession,
  cleanUsername,
  decodeSyncCode,
  guardLogin,
  hashPassword,
  monthBounds,
  noteLogin,
  nowIso,
  parseCents,
  parseDate,
  randomId,
  readSession,
  touchSession,
  verifyPassword,
  writeSession,
} from "./security.js";
import {
  activateHouse,
  createVault,
  currentVault,
  emptyVault,
  exportEncrypted,
  getSyncCode,
  hasLocalVault,
  isOpen,
  listHouses,
  openLocalVault,
  persist,
  pullRemote,
  refreshFromRemote,
} from "./vault.js";
import { findAccountByEmail, findAccountById, findAccountByLogin, findAccountByProvider, patchAccount, publicAccount, registerAccount, verifyAccount } from "./identity.js";
import { totpMatch } from "./totp.js";
import { joinUrl } from "./share.js";

const LEDGERS = {
  income: { list: "incomes", titleField: "source", dateField: "received_on", categories: INCOME_CATEGORIES, grant: "income", label: "income" },
  expenses: { list: "expenses", titleField: "merchant", dateField: "spent_on", categories: EXPENSE_CATEGORIES, grant: "expenses", label: "expense" },
  costs: { list: "costs", titleField: "title", dateField: "due_on", categories: COST_CATEGORIES, grant: "costs", label: "cost" },
};

function grantsFor(user) {
  if (!user) return emptyGrants();
  if (user.role === "admin" || user.role === "member" || user.role === "spouse") {
    const isAdmin = user.role === "admin";
    return {
      income: true, expenses: true, savings: true, projects: true, costs: true,
      exchange: true, plans: true, advisor: true,
      people: isAdmin,
      settings: true,
      invite: isAdmin,
      manage: isAdmin,
      household: true,
    };
  }
  return emptyGrants();
}

function emptyGrants() {
  return {
    income: false, expenses: false, savings: false, projects: false, costs: false,
    exchange: false, plans: false, advisor: false, people: false, settings: false, invite: false, manage: false, household: false,
  };
}

function publicUser(user) {
  return { id: user.id, householdId: "home", name: user.name, username: user.username || "", email: user.email, role: user.role };
}

function requireUser() {
  const session = touchSession();
  if (!session) throw new Error("Please sign in.");
  const user = currentVault().users.find((row) => row.id === session.userId);
  if (!user) {
    clearSession();
    throw new Error("Please sign in.");
  }
  return user;
}

function requireGrant(module) {
  const user = requireUser();
  const grants = grantsFor(user);
  if (!grants[module]) throw new Error("You do not have access to this part of Our Money Hub.");
  return { user, grants, vault: currentVault() };
}

function logActivity(user, action, detail) {
  currentVault().activity.unshift({
    id: randomId(),
    user_id: user.id,
    actor_name: user.name,
    action,
    detail,
    created_at: nowIso(),
  });
  currentVault().activity = currentVault().activity.slice(0, 80);
}

function ownerName(ownerId) {
  return currentVault().users.find((row) => row.id === ownerId)?.name || "Household";
}

function catalogs() {
  return {
    income: INCOME_CATEGORIES,
    expenses: EXPENSE_CATEGORIES,
    costs: COST_CATEGORIES,
    statuses: PROJECT_STATUSES,
    recurring: RECURRING,
    currencies: CURRENCY_CODES,
  };
}

function membersOf() {
  return currentVault().users
    .map((row) => ({
      id: row.id,
      name: row.name,
      username: row.username || "",
      email: row.email,
      role: row.role,
      created_at: row.createdAt,
      grants: grantsFor(row),
    }))
    .sort((a, b) => ["admin", "member", "spouse", "guest"].indexOf(a.role) - ["admin", "member", "spouse", "guest"].indexOf(b.role));
}

function assertOwner(ownerId) {
  return currentVault().users.some((row) => row.id === ownerId);
}

export const api = {
  async bootstrap() {
    const currencies = CURRENCY_CODES;
    const houses = hasLocalVault() ? listHouses() : [];
    if (hasLocalVault() && !isOpen()) {
      try {
        await openLocalVault();
        await refreshFromRemote();
      } catch {
        return { user: null, currencies, houses, joinable: true };
      }
    }
    const session = readSession();
    if (!session) return { user: null, currencies, houses, joinable: true };
    if (!isOpen() && hasLocalVault()) {
      try {
        await openLocalVault();
      } catch {
        return { user: null, currencies, houses, joinable: true };
      }
    }
    const user = isOpen() ? currentVault().users.find((row) => row.id === session.userId) : null;
    if (!user) return { user: null, currencies, houses, joinable: true };
    const account = findAccountById(session.accountId) || findAccountByEmail(user.email);
    const grants = grantsFor(user);
    const isAdmin = user.role === "admin";
    const code = grants.invite ? getSyncCode() : "";
    return {
      user: { ...publicUser(user), account: publicAccount(account) },
      grants,
      household: currentVault().household,
      members: grants.household ? membersOf() : [{ id: user.id, name: user.name, username: user.username, email: user.email, role: user.role, grants }],
      catalogs: catalogs(),
      syncCode: code,
      joinUrl: code ? joinUrl(code) : "",
      houses,
      needsTotp: Boolean(isAdmin && account && !account.totpConfirmed),
      needsBio: Boolean(account && !account.biometricOn),
      totpSecret: isAdmin && account && !account.totpConfirmed ? account.totpSecret : "",
    };
  },

  async setup(body) {
    const name = cleanText(body.adminName || body.name, 80);
    const username = body.username ? cleanUsername(body.username) : "";
    const email = cleanEmail(body.adminEmail || body.email);
    const password = String(body.adminPassword || body.password || "");
    const householdName = cleanText(body.householdName, 80) || "Our household";
    const currency = CURRENCY_CODES.includes(body.currency) ? body.currency : "PLN";
    const provider = body.provider || null;
    if (!name || !email) throw new Error("Add your name and email.");
    if (!username) throw new Error("Choose a username.");
    let account = findAccountByEmail(email) || findAccountByLogin(username);
    if (!provider) {
      if (!account) assertPassword(password);
      else if (!(await verifyAccount(email, password)) && !(await verifyAccount(username, password))) {
        throw new Error("Password does not match this account.");
      }
    }
    if (!account) account = await registerAccount({ name, username, email, password, provider });
    const hashed = account.passwordHash ? { hash: account.passwordHash, salt: account.passwordSalt } : await hashPassword(password || randomId());
    const vault = emptyVault();
    const admin = {
      id: randomId(),
      name,
      username: account.username || username,
      email,
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      role: "admin",
      createdAt: nowIso(),
    };
    vault.household = { id: randomId(), name: householdName, currency, createdAt: nowIso() };
    vault.users.push(admin);
    vault.activity.push({
      id: randomId(),
      user_id: admin.id,
      actor_name: admin.name,
      action: "setup",
      detail: "Opened a household",
      created_at: nowIso(),
    });
    await createVault(vault);
    writeSession(admin.id, { accountId: account.id });
    const code = getSyncCode();
    if (!code) throw new Error("The household was created, but a join code could not be generated. Try again.");
    return { ok: true, syncCode: code, joinUrl: joinUrl(code), totpSecret: account.totpSecret, user: publicUser(admin) };
  },

  async join(body) {
    const { blobId, keyBytes } = decodeSyncCode(body.syncCode);
    await pullRemote(blobId, keyBytes);
    const name = cleanText(body.name, 80);
    const username = cleanUsername(body.username);
    const email = cleanEmail(body.email);
    const password = String(body.password || "");
    if (!name || !email) throw new Error("Add your name, username, and email to join.");
    assertPassword(password);
    let account = findAccountByEmail(email);
    if (!account) account = await registerAccount({ name, username, email, password });
    let user = currentVault().users.find((row) => row.email === email);
    if (!user) {
      const hashed = account.passwordHash
        ? { hash: account.passwordHash, salt: account.passwordSalt }
        : await hashPassword(password);
      user = {
        id: randomId(),
        name,
        username: account.username || username,
        email,
        passwordHash: hashed.hash,
        passwordSalt: hashed.salt,
        role: "member",
        createdAt: nowIso(),
      };
      currentVault().users.push(user);
      logActivity(user, "people", `${name} joined the household`);
      await persist();
    }
    writeSession(user.id, { accountId: account.id });
    return { ok: true, totpSecret: "", user: publicUser(user) };
  },

  async login(body) {
    const login = String(body.username || body.email || "").trim();
    const password = String(body.password || "");
    guardLogin(login);
    let account = await verifyAccount(login, password);
    if (!account) {
      if (hasLocalVault() && !isOpen()) {
        await openLocalVault();
        await refreshFromRemote();
      }
      const user = isOpen() ? currentVault().users.find((row) => row.email === cleanEmail(login) || row.username === login.toLowerCase()) : null;
      const ok = user && user.passwordHash ? await verifyPassword(password, user.passwordHash, user.passwordSalt) : false;
      noteLogin(login, ok);
      if (!ok) throw new Error("Those details do not match an account.");
      writeSession(user.id);
      logActivity(user, "login", `${user.name} signed in`);
      await persist();
      return { ok: true, user: publicUser(user), needsTotp: user.role === "admin" };
    }
    noteLogin(login, true);
    if (hasLocalVault() && !isOpen()) {
      await openLocalVault();
      await refreshFromRemote();
    }
    const user = isOpen() ? currentVault().users.find((row) => row.email === account.email || row.username === account.username) : null;
    if (!user) throw new Error("This account is not in an open household yet. Create one or join with a code.");
    if (user.role === "admin" && account.totpConfirmed) {
      if (!body.totpCode) return { ok: false, needsTotp: true };
      if (!(await totpMatch(account.totpSecret, body.totpCode))) throw new Error("That authenticator code is not valid.");
    }
    writeSession(user.id, { accountId: account.id });
    logActivity(user, "login", `${user.name} signed in`);
    await persist();
    return {
      ok: true,
      user: publicUser(user),
      needsTotp: user.role === "admin" && !account.totpConfirmed,
      totpSecret: user.role === "admin" && !account.totpConfirmed ? account.totpSecret : "",
    };
  },

  async loginSocial(identity) {
    if (!identity?.email) throw new Error("That Google account did not share an email.");
    let account = findAccountByProvider(identity.provider, identity.subject) || findAccountByEmail(identity.email);
    if (!account) {
      account = await registerAccount({
        name: identity.name || identity.email,
        username: identity.email.split("@")[0],
        email: identity.email,
        password: "",
        provider: identity,
      });
    }
    if (hasLocalVault() && !isOpen()) {
      try {
        await openLocalVault();
      } catch {
        /* continue */
      }
    }
    const user = isOpen() ? currentVault().users.find((row) => row.email === account.email) : null;
    if (user) writeSession(user.id, { accountId: account.id });
    const admin = user?.role === "admin";
    return {
      ok: true,
      linked: Boolean(user),
      totpSecret: admin && !account.totpConfirmed ? account.totpSecret : "",
      needsTotp: Boolean(admin && !account.totpConfirmed),
      account: publicAccount(account),
      user: user ? publicUser(user) : null,
    };
  },

  async confirmTotp(code) {
    const session = readSession();
    if (!session?.accountId) throw new Error("Please sign in first.");
    const account = findAccountById(session.accountId);
    if (!account) throw new Error("Account not found.");
    if (!(await totpMatch(account.totpSecret, code))) throw new Error("That authenticator code is not valid.");
    patchAccount(account.id, { totpConfirmed: true });
    return { ok: true };
  },

  async verifyLoginTotp(code) {
    const session = readSession();
    if (!session) throw new Error("Please sign in first.");
    const account = findAccountById(session.accountId) || (isOpen() ? findAccountByEmail(currentVault().users.find((row) => row.id === session.userId)?.email) : null);
    if (!account?.totpSecret) throw new Error("No authenticator is linked to this account.");
    if (!(await totpMatch(account.totpSecret, code))) throw new Error("That authenticator code is not valid.");
    return { ok: true };
  },

  async switchHouse(id) {
    const session = readSession();
    const previous = isOpen() && session ? currentVault().users.find((row) => row.id === session.userId) : null;
    await activateHouse(id);
    const next = previous ? currentVault().users.find((row) => row.email === previous.email) : null;
    if (next) writeSession(next.id, { accountId: session?.accountId });
    else clearSession();
    return { ok: true };
  },

  async markBiometric() {
    const session = readSession();
    if (!session?.accountId) throw new Error("Please sign in first.");
    patchAccount(session.accountId, { biometricOn: true });
    return { ok: true };
  },

  async loginByUserId(userId) {
    if (!hasLocalVault()) throw new Error("No household is open on this device.");
    if (!isOpen()) {
      await openLocalVault();
      await refreshFromRemote();
    }
    const user = currentVault().users.find((row) => row.id === userId);
    if (!user) throw new Error("That biometric key is not linked to a household account.");
    const account = findAccountByEmail(user.email);
    writeSession(user.id, { accountId: account?.id });
    logActivity(user, "login", `${user.name} signed in with biometric unlock`);
    await persist();
    return {
      ok: true,
      user: publicUser(user),
      needsTotp: user.role === "admin",
      totpSecret: user.role === "admin" && account && !account.totpConfirmed ? account.totpSecret : "",
    };
  },

  async logout() {
    clearSession();
    return { ok: true };
  },

  async password(body) {
    const user = requireUser();
    if (!(await verifyPassword(body.currentPassword, user.passwordHash, user.passwordSalt))) {
      throw new Error("Current password is not correct.");
    }
    assertPassword(body.nextPassword);
    const next = await hashPassword(body.nextPassword);
    user.passwordHash = next.hash;
    user.passwordSalt = next.salt;
    await persist();
    return { ok: true };
  },

  async household(body) {
    const { vault } = requireGrant("invite");
    const name = cleanText(body.name, 80);
    if (!name) throw new Error("Household name is required.");
    vault.household.name = name;
    vault.household.currency = CURRENCY_CODES.includes(body.currency) ? body.currency : vault.household.currency;
    await persist();
    return { ok: true };
  },

  async people() {
    requireGrant("people");
    return { members: membersOf() };
  },

  async addPerson(body) {
    const { user, vault } = requireGrant("people");
    const name = cleanText(body.name, 80);
    const email = cleanEmail(body.email);
    const role = body.role === "admin" ? "admin" : body.role === "guest" ? "guest" : "member";
    if (!name || !email) throw new Error("Name and email are required.");
    assertPassword(body.password);
    if (vault.users.some((row) => row.email === email)) throw new Error("That email is already in use.");
    const hashed = await hashPassword(body.password);
    const next = {
      id: randomId(),
      name,
      email,
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      role,
      createdAt: nowIso(),
    };
    vault.users.push(next);
    if (role === "guest") {
      vault.grants[next.id] = {
        income: Boolean(body.grants?.income),
        expenses: Boolean(body.grants?.expenses),
        savings: Boolean(body.grants?.savings),
        projects: Boolean(body.grants?.projects),
        costs: Boolean(body.grants?.costs),
        exchange: Boolean(body.grants?.exchange),
        plans: Boolean(body.grants?.plans),
        advisor: Boolean(body.grants?.advisor),
      };
    }
    logActivity(user, "people", `Added ${role} account for ${name}`);
    await persist();
    return { ok: true, id: next.id };
  },

  async updateGrants(id, grants) {
    const { user, vault } = requireGrant("people");
    const person = vault.users.find((row) => row.id === id);
    if (!person) throw new Error("Person not found.");
    if (person.role !== "guest") throw new Error("Household members already have full access.");
    vault.grants[id] = {
      income: Boolean(grants.income),
      expenses: Boolean(grants.expenses),
      savings: Boolean(grants.savings),
      projects: Boolean(grants.projects),
      costs: Boolean(grants.costs),
      exchange: Boolean(grants.exchange),
      plans: Boolean(grants.plans),
      advisor: Boolean(grants.advisor),
    };
    logActivity(user, "people", `Updated access for ${person.name}`);
    await persist();
    return { ok: true };
  },

  async resetPassword(id, password) {
    const { vault } = requireGrant("people");
    const person = vault.users.find((row) => row.id === id);
    if (!person) throw new Error("Person not found.");
    assertPassword(password);
    const hashed = await hashPassword(password);
    person.passwordHash = hashed.hash;
    person.passwordSalt = hashed.salt;
    await persist();
    return { ok: true };
  },

  async removePerson(id) {
    const { user, vault } = requireGrant("people");
    const person = vault.users.find((row) => row.id === id);
    if (!person) throw new Error("Person not found.");
    if (person.id === user.id) throw new Error("You cannot remove your own account.");
    if (person.role === "admin" && vault.users.filter((row) => row.role === "admin").length < 2) {
      throw new Error("Keep at least one admin in this household.");
    }
    vault.users = vault.users.filter((row) => row.id !== id);
    delete vault.grants[id];
    logActivity(user, "people", `Removed ${person.name}`);
    await persist();
    return { ok: true };
  },

  async ledger(kind, month) {
    const cfg = LEDGERS[kind];
    const { vault } = requireGrant(cfg.grant);
    const bounds = monthBounds(month);
    const items = vault[cfg.list]
      .filter((row) => row[cfg.dateField] >= bounds.start && row[cfg.dateField] <= bounds.end)
      .sort((a, b) => b[cfg.dateField].localeCompare(a[cfg.dateField]))
      .map((row) => ({ ...row, owner_name: ownerName(row.owner_id) }));
    return {
      month: bounds.month,
      items,
      totalCents: items.reduce((sum, row) => sum + row.amount_cents, 0),
      categories: cfg.categories,
    };
  },

  async addLedger(kind, body) {
    const cfg = LEDGERS[kind];
    const { user, vault } = requireGrant(cfg.grant);
    const title = cleanText(body[cfg.titleField] || body.title, 120);
    const category = cleanText(body.category, 40);
    const amount = parseCents(body.amount);
    const date = parseDate(body.date);
    const recurring = RECURRING.includes(body.recurring) ? body.recurring : "none";
    const notes = cleanText(body.notes, 400);
    const ownerId = String(body.ownerId || user.id);
    if (!title || amount === null || !date) throw new Error("A title, amount, and date are required.");
    if (!cfg.categories.includes(category)) throw new Error("Choose a valid category.");
    if (!assertOwner(ownerId)) throw new Error("That person is not in this household.");
    vault[cfg.list].push({
      id: randomId(),
      owner_id: ownerId,
      created_by: user.id,
      [cfg.titleField]: title,
      category,
      amount_cents: amount,
      [cfg.dateField]: date,
      recurring,
      notes,
      created_at: nowIso(),
    });
    logActivity(user, kind, `Added ${cfg.label}: ${title}`);
    await persist();
    return { ok: true };
  },

  async updateLedger(kind, id, body) {
    const cfg = LEDGERS[kind];
    const { vault } = requireGrant(cfg.grant);
    const row = vault[cfg.list].find((item) => item.id === id);
    if (!row) throw new Error("Entry not found.");
    const title = cleanText(body[cfg.titleField] || body.title, 120);
    const amount = parseCents(body.amount);
    const date = parseDate(body.date);
    if (!title || amount === null || !date) throw new Error("A title, amount, and date are required.");
    row[cfg.titleField] = title;
    row.category = cleanText(body.category, 40);
    row.amount_cents = amount;
    row[cfg.dateField] = date;
    row.recurring = RECURRING.includes(body.recurring) ? body.recurring : "none";
    row.notes = cleanText(body.notes, 400);
    row.owner_id = String(body.ownerId || row.owner_id);
    await persist();
    return { ok: true };
  },

  async deleteLedger(kind, id) {
    const cfg = LEDGERS[kind];
    const { user, vault } = requireGrant(cfg.grant);
    vault[cfg.list] = vault[cfg.list].filter((row) => row.id !== id);
    logActivity(user, kind, `Removed ${cfg.label}`);
    await persist();
    return { ok: true };
  },

  async savings() {
    const { vault } = requireGrant("savings");
    const items = vault.savings.map((account) => ({
      ...account,
      owner_name: ownerName(account.owner_id),
      entries: vault.savingsEntries.filter((row) => row.savings_id === account.id),
    }));
    return { items, totalCents: items.reduce((sum, row) => sum + row.current_cents, 0) };
  },

  async addSavings(body) {
    const { user, vault } = requireGrant("savings");
    const name = cleanText(body.name, 120);
    const target = parseCents(body.target ?? 0);
    const current = parseCents(body.current ?? 0);
    const monthly = parseCents(body.monthly ?? 0);
    if (!name || target === null || current === null || monthly === null) throw new Error("A name and valid amounts are required.");
    const id = randomId();
    vault.savings.unshift({
      id,
      owner_id: String(body.ownerId || user.id),
      created_by: user.id,
      name,
      target_cents: target,
      current_cents: current,
      monthly_cents: monthly,
      target_date: body.targetDate ? parseDate(body.targetDate) : null,
      notes: cleanText(body.notes, 400),
      created_at: nowIso(),
    });
    if (current > 0) {
      vault.savingsEntries.unshift({
        id: randomId(), savings_id: id, created_by: user.id, created_by_name: user.name,
        kind: "deposit", amount_cents: current, entry_on: nowIso().slice(0, 10), notes: "Opening balance", created_at: nowIso(),
      });
    }
    logActivity(user, "savings", `Opened savings pot: ${name}`);
    await persist();
    return { ok: true, id };
  },

  async updateSavings(id, body) {
    const { vault } = requireGrant("savings");
    const row = vault.savings.find((item) => item.id === id);
    if (!row) throw new Error("Savings pot not found.");
    row.name = cleanText(body.name, 120);
    row.target_cents = parseCents(body.target ?? row.target_cents / 100);
    row.monthly_cents = parseCents(body.monthly ?? row.monthly_cents / 100);
    row.target_date = body.targetDate ? parseDate(body.targetDate) : row.target_date;
    row.notes = cleanText(body.notes, 400);
    row.owner_id = String(body.ownerId || row.owner_id);
    await persist();
    return { ok: true };
  },

  async savingsEntry(id, body) {
    const { user, vault } = requireGrant("savings");
    const row = vault.savings.find((item) => item.id === id);
    if (!row) throw new Error("Savings pot not found.");
    const amount = parseCents(body.amount);
    const kind = body.kind === "withdraw" ? "withdraw" : "deposit";
    if (!amount) throw new Error("Enter an amount.");
    const next = kind === "deposit" ? row.current_cents + amount : row.current_cents - amount;
    if (next < 0) throw new Error("That withdrawal is larger than the current balance.");
    row.current_cents = next;
    vault.savingsEntries.unshift({
      id: randomId(), savings_id: id, created_by: user.id, created_by_name: user.name,
      kind, amount_cents: amount, entry_on: parseDate(body.date) || nowIso().slice(0, 10),
      notes: cleanText(body.notes, 200), created_at: nowIso(),
    });
    logActivity(user, "savings", `${kind === "deposit" ? "Deposited into" : "Withdrew from"} ${row.name}`);
    await persist();
    return { ok: true, currentCents: next };
  },

  async deleteSavings(id) {
    const { user, vault } = requireGrant("savings");
    vault.savings = vault.savings.filter((row) => row.id !== id);
    vault.savingsEntries = vault.savingsEntries.filter((row) => row.savings_id !== id);
    logActivity(user, "savings", "Removed a savings pot");
    await persist();
    return { ok: true };
  },

  async projects() {
    const { vault } = requireGrant("projects");
    const items = vault.projects.map((project) => {
      const entries = vault.projectEntries.filter((row) => row.project_id === project.id);
      return {
        ...project,
        owner_name: ownerName(project.owner_id),
        spent_cents: entries.reduce((sum, row) => sum + row.amount_cents, 0),
        entries,
      };
    });
    return { items };
  },

  async addProject(body) {
    const { user, vault } = requireGrant("projects");
    const name = cleanText(body.name, 120);
    const budget = parseCents(body.budget ?? 0);
    if (!name || budget === null) throw new Error("A name and budget are required.");
    vault.projects.unshift({
      id: randomId(),
      owner_id: String(body.ownerId || user.id),
      created_by: user.id,
      name,
      budget_cents: budget,
      status: PROJECT_STATUSES.includes(body.status) ? body.status : "planned",
      target_date: body.targetDate ? parseDate(body.targetDate) : null,
      notes: cleanText(body.notes, 400),
      created_at: nowIso(),
    });
    logActivity(user, "projects", `Opened life project: ${name}`);
    await persist();
    return { ok: true };
  },

  async updateProject(id, body) {
    const { vault } = requireGrant("projects");
    const row = vault.projects.find((item) => item.id === id);
    if (!row) throw new Error("Project not found.");
    row.name = cleanText(body.name, 120);
    row.budget_cents = parseCents(body.budget ?? row.budget_cents / 100);
    row.status = PROJECT_STATUSES.includes(body.status) ? body.status : row.status;
    row.target_date = body.targetDate ? parseDate(body.targetDate) : row.target_date;
    row.notes = cleanText(body.notes, 400);
    row.owner_id = String(body.ownerId || row.owner_id);
    await persist();
    return { ok: true };
  },

  async projectEntry(id, body) {
    const { user, vault } = requireGrant("projects");
    const row = vault.projects.find((item) => item.id === id);
    if (!row) throw new Error("Project not found.");
    const amount = parseCents(body.amount);
    if (!amount) throw new Error("Enter an amount.");
    vault.projectEntries.unshift({
      id: randomId(), project_id: id, created_by: user.id, created_by_name: user.name,
      amount_cents: amount, entry_on: parseDate(body.date) || nowIso().slice(0, 10),
      notes: cleanText(body.notes, 200), created_at: nowIso(),
    });
    logActivity(user, "projects", `Logged spend on ${row.name}`);
    await persist();
    return { ok: true };
  },

  async deleteProject(id) {
    const { user, vault } = requireGrant("projects");
    vault.projects = vault.projects.filter((row) => row.id !== id);
    vault.projectEntries = vault.projectEntries.filter((row) => row.project_id !== id);
    logActivity(user, "projects", "Removed a project");
    await persist();
    return { ok: true };
  },

  async dashboard(month) {
    const user = requireUser();
    const grants = grantsFor(user);
    const vault = currentVault();
    const bounds = monthBounds(month);
    const inRange = (row, field) => row[field] >= bounds.start && row[field] <= bounds.end;
    const income = grants.income ? vault.incomes.filter((row) => inRange(row, "received_on")).reduce((s, r) => s + r.amount_cents, 0) : 0;
    const expenses = grants.expenses ? vault.expenses.filter((row) => inRange(row, "spent_on")).reduce((s, r) => s + r.amount_cents, 0) : 0;
    const costs = grants.costs ? vault.costs.filter((row) => inRange(row, "due_on")).reduce((s, r) => s + r.amount_cents, 0) : 0;
    const savingsTotal = grants.savings ? vault.savings.reduce((s, r) => s + r.current_cents, 0) : 0;
    const savingsMonth = grants.savings
      ? vault.savingsEntries.filter((row) => row.entry_on >= bounds.start && row.entry_on <= bounds.end)
        .reduce((s, r) => s + (r.kind === "deposit" ? r.amount_cents : -r.amount_cents), 0)
      : 0;
    const canSee = grants.household || grants.income || grants.expenses || grants.savings || grants.projects || grants.costs;
    if (!canSee) {
      return {
        month: bounds.month,
        totals: { income: 0, expenses: 0, costs: 0, outflow: 0, savingsTotal: 0, savingsMonth: 0, surplus: 0 },
        ownerBreakdown: [], categories: [], trend: [], recent: [], savings: [], projects: [], locked: true,
      };
    }
    const ownerBreakdown = grants.household
      ? vault.users.filter((row) => row.role !== "guest").map((row) => ({
        id: row.id,
        name: row.name,
        income_cents: vault.incomes.filter((item) => item.owner_id === row.id && inRange(item, "received_on")).reduce((s, r) => s + r.amount_cents, 0),
        expense_cents: vault.expenses.filter((item) => item.owner_id === row.id && inRange(item, "spent_on")).reduce((s, r) => s + r.amount_cents, 0),
        cost_cents: vault.costs.filter((item) => item.owner_id === row.id && inRange(item, "due_on")).reduce((s, r) => s + r.amount_cents, 0),
        savings_cents: vault.savings.filter((item) => item.owner_id === row.id).reduce((s, r) => s + r.current_cents, 0),
      }))
      : [];
    const book = [];
    const addBook = (row) => {
      if (!row.date || row.date < bounds.start || row.date > bounds.end) return;
      book.push(row);
    };
    if (grants.income) {
      for (const row of vault.incomes) {
        addBook({
          id: `in-${row.id}`,
          date: row.received_on,
          type: "Income",
          kind: "income",
          person: ownerName(row.owner_id),
          owner_id: row.owner_id,
          title: row.source,
          category: row.category,
          amount_cents: row.amount_cents,
          flow: "in",
          notes: row.notes || "",
        });
      }
    }
    if (grants.expenses) {
      for (const row of vault.expenses) {
        addBook({
          id: `ex-${row.id}`,
          date: row.spent_on,
          type: "Expense",
          kind: "expense",
          person: ownerName(row.owner_id),
          owner_id: row.owner_id,
          title: row.merchant,
          category: row.category,
          amount_cents: row.amount_cents,
          flow: "out",
          notes: row.notes || "",
        });
      }
    }
    if (grants.costs) {
      for (const row of vault.costs) {
        addBook({
          id: `co-${row.id}`,
          date: row.due_on,
          type: "Other cost",
          kind: "cost",
          person: ownerName(row.owner_id),
          owner_id: row.owner_id,
          title: row.title,
          category: row.category,
          amount_cents: row.amount_cents,
          flow: "out",
          notes: row.notes || "",
        });
      }
    }
    if (grants.savings) {
      for (const row of vault.savingsEntries) {
        const pot = vault.savings.find((item) => item.id === row.savings_id);
        addBook({
          id: `sv-${row.id}`,
          date: row.entry_on,
          type: row.kind === "withdraw" ? "Savings out" : "Savings in",
          kind: "savings",
          person: row.created_by_name || ownerName(pot?.owner_id),
          owner_id: pot?.owner_id || row.created_by,
          title: pot?.name || "Savings",
          category: row.kind === "withdraw" ? "Withdrawal" : "Deposit",
          amount_cents: row.amount_cents,
          flow: row.kind === "withdraw" ? "out" : "in",
          notes: row.notes || "",
        });
      }
    }
    if (grants.projects) {
      for (const row of vault.projectEntries) {
        const project = vault.projects.find((item) => item.id === row.project_id);
        addBook({
          id: `pr-${row.id}`,
          date: row.spent_on || row.entry_on || String(row.created_at || "").slice(0, 10),
          type: "Project",
          kind: "project",
          person: ownerName(project?.owner_id) || row.created_by_name || "Household",
          owner_id: project?.owner_id,
          title: project?.name || "Project",
          category: "Life project",
          amount_cents: row.amount_cents,
          flow: "out",
          notes: row.notes || "",
        });
      }
    }
    book.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
    const catMap = {};
    if (grants.expenses) {
      for (const row of vault.expenses.filter((item) => inRange(item, "spent_on"))) {
        catMap[row.category] = (catMap[row.category] || 0) + row.amount_cents;
      }
    }
    const categories = Object.entries(catMap).map(([category, amount_cents]) => ({ category, amount_cents })).sort((a, b) => b.amount_cents - a.amount_cents);
    const trend = [];
    const base = new Date(`${bounds.month}-01T00:00:00`);
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = monthBounds(key);
      const between = (row, field) => row[field] >= b.start && row[field] <= b.end;
      trend.push({
        month: key,
        income: grants.income ? vault.incomes.filter((row) => between(row, "received_on")).reduce((s, r) => s + r.amount_cents, 0) : 0,
        out:
          (grants.expenses ? vault.expenses.filter((row) => between(row, "spent_on")).reduce((s, r) => s + r.amount_cents, 0) : 0) +
          (grants.costs ? vault.costs.filter((row) => between(row, "due_on")).reduce((s, r) => s + r.amount_cents, 0) : 0),
      });
    }
    return {
      month: bounds.month,
      totals: { income, expenses, costs, outflow: expenses + costs, savingsTotal, savingsMonth, surplus: income - expenses - costs },
      ownerBreakdown,
      book,
      categories,
      trend,
      recent: vault.activity.slice(0, 10),
      savings: grants.savings ? vault.savings.map((row) => ({ id: row.id, name: row.name, target_cents: row.target_cents, current_cents: row.current_cents, owner_id: row.owner_id })) : [],
      projects: grants.projects
        ? vault.projects.filter((row) => row.status !== "done").slice(0, 6).map((row) => ({
          ...row,
          spent_cents: vault.projectEntries.filter((item) => item.project_id === row.id).reduce((s, r) => s + r.amount_cents, 0),
        }))
        : [],
    };
  },

  async board() {
    const { vault } = requireGrant("plans");
    return {
      lists: [...vault.lists].sort((a, b) => a.order - b.order),
      cards: vault.cards.map((card) => ({ ...card, owner_name: ownerName(card.ownerId) })),
    };
  },

  async addList(title) {
    const { vault } = requireGrant("plans");
    const name = cleanText(title, 60);
    if (!name) throw new Error("Give the column a name.");
    vault.lists.push({ id: randomId(), title: name, order: vault.lists.length });
    await persist();
    return { ok: true };
  },

  async renameList(id, title) {
    const { vault } = requireGrant("plans");
    const list = vault.lists.find((row) => row.id === id);
    if (!list) throw new Error("Column not found.");
    list.title = cleanText(title, 60);
    await persist();
    return { ok: true };
  },

  async deleteList(id) {
    const { vault } = requireGrant("plans");
    if (vault.lists.length <= 1) throw new Error("Keep at least one column.");
    vault.lists = vault.lists.filter((row) => row.id !== id);
    vault.cards = vault.cards.filter((row) => row.listId !== id);
    await persist();
    return { ok: true };
  },

  async addCard(body) {
    const { user, vault } = requireGrant("plans");
    const title = cleanText(body.title, 140);
    if (!title) throw new Error("A card needs a title.");
    const list = vault.lists.find((row) => row.id === body.listId) || vault.lists[0];
    vault.cards.push({
      id: randomId(),
      listId: list.id,
      title,
      plan: cleanText(body.plan, 8000),
      labels: Array.isArray(body.labels) ? body.labels.slice(0, 4) : [],
      ownerId: String(body.ownerId || user.id),
      due: body.due ? parseDate(body.due) : null,
      order: vault.cards.filter((row) => row.listId === list.id).length,
      checklist: [],
      created_at: nowIso(),
    });
    logActivity(user, "plans", `Added plan card: ${title}`);
    await persist();
    return { ok: true };
  },

  async updateCard(id, body) {
    const { vault } = requireGrant("plans");
    const card = vault.cards.find((row) => row.id === id);
    if (!card) throw new Error("Card not found.");
    if (body.title != null) card.title = cleanText(body.title, 140);
    if (body.plan != null) card.plan = cleanText(body.plan, 8000);
    if (body.labels) card.labels = body.labels.slice(0, 4);
    if (body.ownerId) card.ownerId = String(body.ownerId);
    if (body.due !== undefined) card.due = body.due ? parseDate(body.due) : null;
    if (body.checklist) card.checklist = body.checklist.slice(0, 30);
    await persist();
    return { ok: true };
  },

  async moveCard(id, listId, index) {
    const { vault } = requireGrant("plans");
    const card = vault.cards.find((row) => row.id === id);
    if (!card) throw new Error("Card not found.");
    if (!vault.lists.some((row) => row.id === listId)) throw new Error("Column not found.");
    card.listId = listId;
    card.order = Number.isFinite(index) ? index : 0;
    await persist();
    return { ok: true };
  },

  async deleteCard(id) {
    const { vault } = requireGrant("plans");
    vault.cards = vault.cards.filter((row) => row.id !== id);
    await persist();
    return { ok: true };
  },

  async exportData() {
    requireGrant("invite");
    const vault = currentVault();
    return {
      household: vault.household,
      members: vault.users.map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role })),
      incomes: vault.incomes,
      expenses: vault.expenses,
      costs: vault.costs,
      savings: vault.savings,
      projects: vault.projects,
      exportedAt: nowIso(),
    };
  },

  syncCode: getSyncCode,
  exportEncrypted,
};

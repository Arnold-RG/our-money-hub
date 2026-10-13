import {
  COST_CATEGORIES,
  CURRENCY_CODES,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PLAN_LABELS,
  PROJECT_STATUSES,
  RECURRING,
} from "./catalogs.js";
import { emailProblem, normalizeEmail, passwordProblem } from "./authRules.js";
import { today } from "./format.js";
import { joinUrl } from "./share.js";
import { siteUrl, supabase, isConfigured } from "./supabaseClient.js";
import {
  cleanText,
  monthBounds,
  nowIso,
  parseCents,
  parseDate,
  randomId,
} from "./security.js";
import { forgetDeviceCopy, hasLocalVault, openLocalVault, wipeOldLoginStore } from "./vault.js";

const HOUSE_KEY = "omh.house";

const LEDGERS = {
  income: { list: "incomes", table: "incomes", titleField: "source", dateField: "received_on", categories: INCOME_CATEGORIES, grant: "income", label: "income" },
  expenses: { list: "expenses", table: "expenses", titleField: "merchant", dateField: "spent_on", categories: EXPENSE_CATEGORIES, grant: "expenses", label: "expense" },
  costs: { list: "costs", table: "costs", titleField: "title", dateField: "due_on", categories: COST_CATEGORIES, grant: "costs", label: "cost" },
};

let memory = null;

function explainError(error) {
  if (!error) return;
  const message = String(error.message || "Something went wrong.");
  if (error.status === 429 || /rate limit/i.test(message)) {
    throw new Error("Too many attempts. Wait a few minutes and try again.");
  }
  if (error.status === 401 || /jwt/i.test(message)) {
    throw new Error("Your session ended. Sign in again.");
  }
  if (error.code === "23514") {
    throw new Error("Check the category, date, and amount.");
  }
  throw new Error(message);
}

function dataOf(result) {
  if (result.error) explainError(result.error);
  return result.data;
}

function activeHouseId() {
  return localStorage.getItem(HOUSE_KEY) || "";
}

function setActiveHouse(id) {
  if (id) localStorage.setItem(HOUSE_KEY, id);
  else localStorage.removeItem(HOUSE_KEY);
}

function grantsFor(user) {
  if (!user) return emptyGrants();
  if (user.role === "admin" || user.role === "member") {
    const isAdmin = user.role === "admin";
    return {
      income: true, expenses: true, savings: true, projects: true, costs: true,
      exchange: true, plans: true, advisor: true, people: true, settings: true,
      invite: isAdmin, manage: isAdmin, household: true,
    };
  }
  return emptyGrants();
}

function emptyGrants() {
  return {
    income: false, expenses: false, savings: false, projects: false, costs: false,
    exchange: false, plans: false, advisor: false, people: false, settings: false,
    invite: false, manage: false, household: false,
  };
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

function requireConfigured() {
  if (!isConfigured || !supabase) throw new Error("Sign-in is not connected for this copy.");
}

async function requireSession() {
  requireConfigured();
  const { data, error } = await supabase.auth.getSession();
  if (error) explainError(error);
  if (!data.session) throw new Error("Sign in first.");
  return data.session;
}

async function listHouses(userId) {
  const memberships = dataOf(await supabase.from("members").select("household_id, role").eq("user_id", userId)) || [];
  const ids = memberships.map((row) => row.household_id);
  if (!ids.length) return [];
  const houses = dataOf(await supabase.from("households").select("id, name, currency, created_at").in("id", ids)) || [];
  const roles = new Map(memberships.map((row) => [row.household_id, row.role]));
  return houses.map((house) => ({
    id: house.id,
    name: house.name,
    currency: house.currency,
    createdAt: house.created_at,
    role: roles.get(house.id) || "member",
  }));
}

async function fetchHouse(hid) {
  const [house, members, incomes, expenses, costs, savings, savingsEntries, projects, projectEntries, messages, activity, lists, cards] = await Promise.all([
    supabase.from("households").select("id, name, currency, created_at").eq("id", hid).maybeSingle(),
    supabase.from("members").select("user_id, role, created_at").eq("household_id", hid),
    supabase.from("incomes").select("*").eq("household_id", hid),
    supabase.from("expenses").select("*").eq("household_id", hid),
    supabase.from("costs").select("*").eq("household_id", hid),
    supabase.from("savings").select("*").eq("household_id", hid),
    supabase.from("savings_entries").select("*").eq("household_id", hid),
    supabase.from("projects").select("*").eq("household_id", hid),
    supabase.from("project_entries").select("*").eq("household_id", hid),
    supabase.from("messages").select("*").eq("household_id", hid).order("created_at", { ascending: false }).limit(200),
    supabase.from("activity").select("*").eq("household_id", hid).order("created_at", { ascending: false }).limit(80),
    supabase.from("lists").select("*").eq("household_id", hid).order("position", { ascending: true }),
    supabase.from("cards").select("*").eq("household_id", hid).order("position", { ascending: true }),
  ]);
  const household = dataOf(house);
  if (!household) throw new Error("That household is not on this account.");
  const memberRows = dataOf(members) || [];
  const ids = memberRows.map((row) => row.user_id);
  const profiles = ids.length
    ? dataOf(await supabase.from("profiles").select("id, name").in("id", ids)) || []
    : [];
  const names = new Map(profiles.map((row) => [row.id, row.name]));
  return {
    household: {
      id: household.id,
      name: household.name,
      currency: household.currency,
      createdAt: household.created_at,
    },
    users: memberRows.map((row) => ({
      id: row.user_id,
      name: names.get(row.user_id) || "Member",
      role: row.role,
      createdAt: row.created_at,
    })),
    incomes: dataOf(incomes) || [],
    expenses: dataOf(expenses) || [],
    costs: dataOf(costs) || [],
    savings: dataOf(savings) || [],
    savingsEntries: dataOf(savingsEntries) || [],
    projects: dataOf(projects) || [],
    projectEntries: dataOf(projectEntries) || [],
    messages: (dataOf(messages) || []).slice().reverse().map((row) => ({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      role: row.role,
      text: row.body,
      created_at: row.created_at,
    })),
    activity: dataOf(activity) || [],
    lists: (dataOf(lists) || []).map((row) => ({ id: row.id, title: row.title, order: row.position })),
    cards: (dataOf(cards) || []).map(cardFromRow),
  };
}

function cardFromRow(row) {
  return {
    id: row.id,
    listId: row.list_id,
    title: row.title,
    plan: row.plan || "",
    labels: row.labels || [],
    ownerId: row.owner_id,
    owner_name: row.owner_name,
    due: row.due_on,
    order: row.position,
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
    created_at: row.created_at,
  };
}

async function reload() {
  const hid = activeHouseId();
  if (!hid) throw new Error("Open a household first.");
  memory = await fetchHouse(hid);
  return memory;
}

async function requireGrant(module) {
  const session = await requireSession();
  await reload();
  const user = memory.users.find((row) => row.id === session.user.id);
  if (!user) throw new Error("You are not in this household.");
  const grants = grantsFor(user);
  if (module && !grants[module]) throw new Error("You do not have access to this part of Our Money Hub.");
  return { user, grants, session };
}

async function requireAdmin() {
  const result = await requireGrant("manage");
  if (result.user.role !== "admin") throw new Error("Only an admin can do that.");
  return result;
}

function membersOf() {
  return memory.users
    .map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      created_at: row.createdAt,
      grants: grantsFor(row),
    }))
    .sort((a, b) => (a.role === "admin" ? 0 : 1) - (b.role === "admin" ? 0 : 1) || a.name.localeCompare(b.name));
}

function memberBooks(person) {
  const bounds = monthBounds();
  const id = String(person.id);
  const owned = (row) => String(row.owner_id) === id;
  const inRange = (row, field) => row[field] >= bounds.start && row[field] <= bounds.end;
  const income_cents = memory.incomes.filter((row) => owned(row) && inRange(row, "received_on")).reduce((sum, row) => sum + row.amount_cents, 0);
  const expense_cents = memory.expenses.filter((row) => owned(row) && inRange(row, "spent_on")).reduce((sum, row) => sum + row.amount_cents, 0);
  const cost_cents = memory.costs.filter((row) => owned(row) && inRange(row, "due_on")).reduce((sum, row) => sum + row.amount_cents, 0);
  const savings = memory.savings.filter(owned).map((row) => ({
    id: row.id,
    name: row.name,
    current_cents: row.current_cents,
    target_cents: row.target_cents,
  }));
  const projects = memory.projects.filter(owned).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    budget_cents: row.budget_cents || 0,
    spent_cents: memory.projectEntries.filter((item) => item.project_id === row.id).reduce((sum, item) => sum + item.amount_cents, 0),
  }));
  return {
    ...person,
    month: bounds.month,
    income_cents,
    expense_cents,
    cost_cents,
    savings_cents: savings.reduce((sum, row) => sum + (row.current_cents || 0), 0),
    surplus_cents: income_cents - expense_cents - cost_cents,
    savings,
    projects,
  };
}

function ownerName(ownerId) {
  return memory.users.find((row) => row.id === ownerId)?.name || "Household";
}

function lineOwner(row) {
  return row.owner_name || ownerName(row.owner_id);
}

async function logActivity(action, detail) {
  const { error } = await supabase.from("activity").insert({
    household_id: memory.household.id,
    action: cleanText(action, 40),
    detail: cleanText(detail, 200),
  });
  if (error) return;
}

function cleanChecklist(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 30).map((item) => ({
    id: cleanText(item?.id, 40) || randomId(),
    text: cleanText(item?.text, 160),
    done: Boolean(item?.done),
  }));
}

function cleanLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.filter((label) => PLAN_LABELS.includes(label)).slice(0, 4);
}

function publicUser(user, email) {
  return {
    id: user.id,
    householdId: memory?.household?.id || null,
    name: user.name,
    role: user.role,
    email: email || "",
  };
}

export const api = {
  async bootstrap() {
    wipeOldLoginStore();
    const currencies = CURRENCY_CODES;
    if (!isConfigured) return { configured: false, user: null, currencies, houses: [] };
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    const session = data.session;
    if (!session) return { configured: true, user: null, currencies, houses: [] };
    const profile = dataOf(await supabase.from("profiles").select("name").eq("id", session.user.id).maybeSingle());
    const name = profile?.name || cleanText(session.user.user_metadata?.name, 80) || "Member";
    const houses = await listHouses(session.user.id);
    let hid = activeHouseId();
    if (!houses.some((house) => house.id === hid)) hid = houses[0]?.id || "";
    if (!hid) {
      return {
        configured: true,
        user: { id: session.user.id, name, email: session.user.email || "", role: null, householdId: null },
        grants: emptyGrants(),
        household: null,
        members: [],
        catalogs: catalogs(),
        houses,
        syncCode: "",
        joinUrl: "",
      };
    }
    setActiveHouse(hid);
    await reload();
    const member = memory.users.find((row) => row.id === session.user.id);
    if (!member) throw new Error("You are not in this household.");
    return {
      configured: true,
      user: publicUser(member, session.user.email),
      grants: grantsFor(member),
      household: memory.household,
      members: membersOf(),
      catalogs: catalogs(),
      houses,
      syncCode: "",
      joinUrl: "",
    };
  },

  async signUp(body) {
    requireConfigured();
    const name = cleanText(body.name, 80);
    const email = normalizeEmail(body.email);
    const problem = emailProblem(email) || passwordProblem(body.password, email);
    if (!name) throw new Error("Add your name.");
    if (problem) throw new Error(problem);
    const { data, error } = await supabase.auth.signUp({
      email,
      password: body.password,
      options: { data: { name }, emailRedirectTo: siteUrl() },
    });
    if (error) explainError(error);
    return { needsEmail: !data.session, email };
  },

  async signIn(body) {
    requireConfigured();
    const email = normalizeEmail(body.email);
    const problem = emailProblem(email);
    if (problem) throw new Error(problem);
    if (!body.password) throw new Error("Add your password.");
    const { error } = await supabase.auth.signInWithPassword({ email, password: body.password });
    if (error) explainError(error);
    return { ok: true };
  },

  async sendReset(email) {
    requireConfigured();
    const normalized = normalizeEmail(email);
    const problem = emailProblem(normalized);
    if (problem) throw new Error(problem);
    const { error } = await supabase.auth.resetPasswordForEmail(normalized, { redirectTo: siteUrl() });
    if (error) explainError(error);
    return { ok: true };
  },

  async updatePassword(body) {
    const session = await requireSession();
    const email = session.user.email || "";
    const problem = passwordProblem(body.next, email);
    if (problem) throw new Error(problem);
    if (body.current) {
      const { error } = await supabase.auth.signInWithPassword({ email, password: body.current });
      if (error) explainError(error);
    }
    const { error } = await supabase.auth.updateUser({ password: body.next });
    if (error) explainError(error);
    return { ok: true };
  },

  async updateProfile(name) {
    const session = await requireSession();
    const cleanName = cleanText(name, 80);
    if (!cleanName) throw new Error("Add your name.");
    const { error } = await supabase.from("profiles").update({ name: cleanName }).eq("id", session.user.id);
    if (error) explainError(error);
    return { ok: true };
  },

  async setup(body) {
    await requireSession();
    const householdName = cleanText(body.householdName, 80);
    const currency = CURRENCY_CODES.includes(body.currency) ? body.currency : "PLN";
    if (!householdName) throw new Error("Add a household name.");
    const { data, error } = await supabase.rpc("create_household", { hname: householdName, hcurrency: currency });
    if (error) explainError(error);
    setActiveHouse(data.household_id);
    await reload();
    const code = data.invite_code;
    return { ok: true, syncCode: code, joinUrl: joinUrl(code) };
  },

  async join(body) {
    await requireSession();
    const code = cleanText(body.syncCode, 80);
    if (code.length < 20) throw new Error("That code is not valid.");
    const { data, error } = await supabase.rpc("join_household", { invite_code: code });
    if (error) explainError(error);
    setActiveHouse(data);
    await reload();
    return { ok: true };
  },

  async rotateInvite() {
    await requireAdmin();
    const { data, error } = await supabase.rpc("rotate_invite", { hid: memory.household.id });
    if (error) explainError(error);
    return { code: data, url: joinUrl(data) };
  },

  async switchHouse(id) {
    const session = await requireSession();
    const houses = await listHouses(session.user.id);
    if (!houses.some((house) => house.id === id)) throw new Error("That household is not on this account.");
    setActiveHouse(id);
    await reload();
    return { ok: true };
  },

  async become() {
    throw new Error("Each person signs in with their own account.");
  },

  async logout() {
    setActiveHouse("");
    memory = null;
    if (supabase) await supabase.auth.signOut();
    return { ok: true };
  },

  async household(body) {
    await requireAdmin();
    const name = cleanText(body.name, 80);
    const currency = CURRENCY_CODES.includes(body.currency) ? body.currency : memory.household.currency;
    if (!name) throw new Error("Household name is required.");
    const { error } = await supabase.from("households").update({ name, currency }).eq("id", memory.household.id);
    if (error) explainError(error);
    await reload();
    return { ok: true };
  },

  async people() {
    await requireGrant("people");
    return { members: membersOf().map((row) => memberBooks(row)) };
  },

  async chat() {
    await requireGrant("people");
    return { messages: memory.messages };
  },

  async sendChat(text) {
    const { user } = await requireGrant("people");
    const body = cleanText(text, 800);
    if (!body) throw new Error("Write a message first.");
    const { error } = await supabase.from("messages").insert({
      household_id: memory.household.id,
      body,
    });
    if (error) explainError(error);
    await logActivity("people", `${user.name} wrote in the household chat`);
    await reload();
    return { ok: true, messages: memory.messages };
  },

  async addPerson() {
    throw new Error("People join with their own account and a code from Settings.");
  },

  async updateGrants() {
    throw new Error("Household members already have the books.");
  },

  async setRole(id, role) {
    await requireAdmin();
    const { error } = await supabase.rpc("set_member_role", {
      hid: memory.household.id,
      target: id,
      next_role: role,
    });
    if (error) explainError(error);
    await reload();
    return { ok: true };
  },

  async removePerson(id) {
    const { user } = await requireAdmin();
    const person = memory.users.find((row) => row.id === id);
    const { error } = await supabase.rpc("remove_member", { hid: memory.household.id, target: id });
    if (error) explainError(error);
    await logActivity("people", `Removed ${person?.name || "a member"}`);
    if (id === user.id) setActiveHouse("");
    await reload().catch(() => { memory = null; });
    return { ok: true };
  },

  async ledger(kind, month) {
    const cfg = LEDGERS[kind];
    await requireGrant(cfg.grant);
    const bounds = monthBounds(month);
    const items = memory[cfg.list]
      .filter((row) => row[cfg.dateField] >= bounds.start && row[cfg.dateField] <= bounds.end)
      .sort((a, b) => String(b[cfg.dateField]).localeCompare(String(a[cfg.dateField])))
      .map((row) => ({ ...row, owner_name: lineOwner(row) }));
    return {
      month: bounds.month,
      items,
      totalCents: items.reduce((sum, row) => sum + row.amount_cents, 0),
      categories: cfg.categories,
    };
  },

  async addLedger(kind, body) {
    const cfg = LEDGERS[kind];
    const { user } = await requireGrant(cfg.grant);
    const title = cleanText(body[cfg.titleField] || body.title, 120);
    const category = cleanText(body.category, 40);
    const amount = parseCents(body.amount);
    const date = parseDate(body.date);
    const recurring = RECURRING.includes(body.recurring) ? body.recurring : "none";
    const notes = cleanText(body.notes, 400);
    const ownerId = String(body.ownerId || user.id);
    if (!title || amount === null || !date) throw new Error("A title, amount, and date are required.");
    if (!cfg.categories.includes(category)) throw new Error("Choose a valid category.");
    if (!memory.users.some((row) => row.id === ownerId)) throw new Error("That person is not in this household.");
    const { error } = await supabase.from(cfg.table).insert({
      household_id: memory.household.id,
      owner_id: ownerId,
      [cfg.titleField]: title,
      category,
      amount_cents: amount,
      [cfg.dateField]: date,
      recurring,
      notes,
    });
    if (error) explainError(error);
    await logActivity(kind, `Added ${cfg.label}: ${title}`);
    await reload();
    return { ok: true };
  },

  async updateLedger(kind, id, body) {
    const cfg = LEDGERS[kind];
    await requireGrant(cfg.grant);
    const title = cleanText(body[cfg.titleField] || body.title, 120);
    const category = cleanText(body.category, 40);
    const amount = parseCents(body.amount);
    const date = parseDate(body.date);
    const ownerId = String(body.ownerId || "");
    if (!title || amount === null || !date) throw new Error("A title, amount, and date are required.");
    if (!cfg.categories.includes(category)) throw new Error("Choose a valid category.");
    if (ownerId && !memory.users.some((row) => row.id === ownerId)) throw new Error("That person is not in this household.");
    const patch = {
      [cfg.titleField]: title,
      category,
      amount_cents: amount,
      [cfg.dateField]: date,
      recurring: RECURRING.includes(body.recurring) ? body.recurring : "none",
      notes: cleanText(body.notes, 400),
    };
    if (ownerId) patch.owner_id = ownerId;
    const { error } = await supabase.from(cfg.table).update(patch).eq("id", id).eq("household_id", memory.household.id);
    if (error) explainError(error);
    await reload();
    return { ok: true };
  },

  async deleteLedger(kind, id) {
    const cfg = LEDGERS[kind];
    await requireGrant(cfg.grant);
    const { error } = await supabase.from(cfg.table).delete().eq("id", id).eq("household_id", memory.household.id);
    if (error) explainError(error);
    await logActivity(kind, `Removed ${cfg.label}`);
    await reload();
    return { ok: true };
  },

  async savings() {
    await requireGrant("savings");
    const items = memory.savings.map((account) => ({
      ...account,
      owner_name: lineOwner(account),
      entries: memory.savingsEntries.filter((row) => row.savings_id === account.id),
    }));
    return { items, totalCents: items.reduce((sum, row) => sum + row.current_cents, 0) };
  },

  async addSavings(body) {
    const { user } = await requireGrant("savings");
    const name = cleanText(body.name, 120);
    const target = parseCents(body.target ?? 0);
    const current = parseCents(body.current ?? 0);
    const monthly = parseCents(body.monthly ?? 0);
    const ownerId = String(body.ownerId || user.id);
    if (!name || target === null || current === null || monthly === null) throw new Error("A name and valid amounts are required.");
    if (!memory.users.some((row) => row.id === ownerId)) throw new Error("That person is not in this household.");
    const { error } = await supabase.from("savings").insert({
      household_id: memory.household.id,
      owner_id: ownerId,
      name,
      target_cents: target,
      current_cents: current,
      monthly_cents: monthly,
      target_date: body.targetDate ? parseDate(body.targetDate) : null,
      notes: cleanText(body.notes, 400),
    });
    if (error) explainError(error);
    await logActivity("savings", `Opened savings pot: ${name}`);
    await reload();
    return { ok: true };
  },

  async updateSavings(id, body) {
    const { user } = await requireGrant("savings");
    const name = cleanText(body.name, 120);
    const target = parseCents(body.target ?? 0);
    const monthly = parseCents(body.monthly ?? 0);
    const ownerId = String(body.ownerId || user.id);
    if (!name || target === null || monthly === null) throw new Error("A name and valid amounts are required.");
    const { error } = await supabase.from("savings").update({
      name,
      target_cents: target,
      monthly_cents: monthly,
      target_date: body.targetDate ? parseDate(body.targetDate) : null,
      notes: cleanText(body.notes, 400),
      owner_id: ownerId,
    }).eq("id", id).eq("household_id", memory.household.id);
    if (error) explainError(error);
    await reload();
    return { ok: true };
  },

  async savingsEntry(id, body) {
    await requireGrant("savings");
    const amount = parseCents(body.amount);
    const kind = body.kind === "withdraw" ? "withdraw" : "deposit";
    const date = parseDate(body.date) || today();
    if (!amount) throw new Error("Enter an amount.");
    const { data, error } = await supabase.rpc("move_savings", {
      pot: id,
      kind,
      amount,
      entry_on: date,
      note: cleanText(body.notes, 200),
    });
    if (error) explainError(error);
    const pot = memory.savings.find((row) => row.id === id);
    await logActivity("savings", `${kind === "deposit" ? "Deposited into" : "Withdrew from"} ${pot?.name || "a pot"}`);
    await reload();
    return { ok: true, currentCents: data };
  },

  async deleteSavings(id) {
    await requireGrant("savings");
    const { error } = await supabase.from("savings").delete().eq("id", id).eq("household_id", memory.household.id);
    if (error) explainError(error);
    await logActivity("savings", "Removed a savings pot");
    await reload();
    return { ok: true };
  },

  async projects() {
    await requireGrant("projects");
    const items = memory.projects.map((project) => {
      const entries = memory.projectEntries.filter((row) => row.project_id === project.id);
      return {
        ...project,
        owner_name: lineOwner(project),
        spent_cents: entries.reduce((sum, row) => sum + row.amount_cents, 0),
        entries,
      };
    });
    return { items };
  },

  async addProject(body) {
    const { user } = await requireGrant("projects");
    const name = cleanText(body.name, 120);
    const budget = parseCents(body.budget ?? 0);
    const ownerId = String(body.ownerId || user.id);
    if (!name || budget === null) throw new Error("A name and budget are required.");
    const { error } = await supabase.from("projects").insert({
      household_id: memory.household.id,
      owner_id: ownerId,
      name,
      budget_cents: budget,
      status: PROJECT_STATUSES.includes(body.status) ? body.status : "planned",
      target_date: body.targetDate ? parseDate(body.targetDate) : null,
      notes: cleanText(body.notes, 400),
    });
    if (error) explainError(error);
    await logActivity("projects", `Opened life project: ${name}`);
    await reload();
    return { ok: true };
  },

  async updateProject(id, body) {
    await requireGrant("projects");
    const name = cleanText(body.name, 120);
    const budget = parseCents(body.budget ?? 0);
    if (!name || budget === null) throw new Error("A name and budget are required.");
    const patch = {
      name,
      budget_cents: budget,
      status: PROJECT_STATUSES.includes(body.status) ? body.status : "planned",
      target_date: body.targetDate ? parseDate(body.targetDate) : null,
      notes: cleanText(body.notes, 400),
    };
    if (body.ownerId) patch.owner_id = String(body.ownerId);
    const { error } = await supabase.from("projects").update(patch).eq("id", id).eq("household_id", memory.household.id);
    if (error) explainError(error);
    await reload();
    return { ok: true };
  },

  async projectEntry(id, body) {
    const { user } = await requireGrant("projects");
    const amount = parseCents(body.amount);
    const date = parseDate(body.date) || today();
    if (!amount) throw new Error("Enter an amount.");
    const row = memory.projects.find((item) => item.id === id);
    const { error } = await supabase.from("project_entries").insert({
      household_id: memory.household.id,
      project_id: id,
      amount_cents: amount,
      entry_on: date,
      notes: cleanText(body.notes, 200),
      created_by_name: user.name,
    });
    if (error) explainError(error);
    await logActivity("projects", `Logged spend on ${row?.name || "a project"}`);
    await reload();
    return { ok: true };
  },

  async deleteProject(id) {
    await requireGrant("projects");
    const { error } = await supabase.from("projects").delete().eq("id", id).eq("household_id", memory.household.id);
    if (error) explainError(error);
    await logActivity("projects", "Removed a project");
    await reload();
    return { ok: true };
  },

  async dashboard(month) {
    const { user } = await requireGrant("household");
    const grants = grantsFor(user);
    const vault = memory;
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
    const ownerBreakdown = vault.users.map((row) => ({
      id: row.id,
      name: row.name,
      income_cents: vault.incomes.filter((item) => item.owner_id === row.id && inRange(item, "received_on")).reduce((s, r) => s + r.amount_cents, 0),
      expense_cents: vault.expenses.filter((item) => item.owner_id === row.id && inRange(item, "spent_on")).reduce((s, r) => s + r.amount_cents, 0),
      cost_cents: vault.costs.filter((item) => item.owner_id === row.id && inRange(item, "due_on")).reduce((s, r) => s + r.amount_cents, 0),
      savings_cents: vault.savings.filter((item) => item.owner_id === row.id).reduce((s, r) => s + r.current_cents, 0),
    }));
    const book = [];
    const addBook = (row) => {
      if (!row.date || row.date < bounds.start || row.date > bounds.end) return;
      book.push(row);
    };
    if (grants.income) {
      for (const row of vault.incomes) {
        addBook({
          id: `in-${row.id}`, date: row.received_on, type: "Income", kind: "income",
          person: lineOwner(row), owner_id: row.owner_id, title: row.source, category: row.category,
          amount_cents: row.amount_cents, flow: "in", notes: row.notes || "",
        });
      }
    }
    if (grants.expenses) {
      for (const row of vault.expenses) {
        addBook({
          id: `ex-${row.id}`, date: row.spent_on, type: "Expense", kind: "expense",
          person: lineOwner(row), owner_id: row.owner_id, title: row.merchant, category: row.category,
          amount_cents: row.amount_cents, flow: "out", notes: row.notes || "",
        });
      }
    }
    if (grants.costs) {
      for (const row of vault.costs) {
        addBook({
          id: `co-${row.id}`, date: row.due_on, type: "Other cost", kind: "cost",
          person: lineOwner(row), owner_id: row.owner_id, title: row.title, category: row.category,
          amount_cents: row.amount_cents, flow: "out", notes: row.notes || "",
        });
      }
    }
    if (grants.savings) {
      for (const row of vault.savingsEntries) {
        const pot = vault.savings.find((item) => item.id === row.savings_id);
        addBook({
          id: `sv-${row.id}`, date: row.entry_on,
          type: row.kind === "withdraw" ? "Savings out" : "Savings in", kind: "savings",
          person: row.created_by_name || lineOwner(pot || {}), owner_id: pot?.owner_id || row.created_by,
          title: pot?.name || "Savings", category: row.kind === "withdraw" ? "Withdrawal" : "Deposit",
          amount_cents: row.amount_cents, flow: row.kind === "withdraw" ? "out" : "in", notes: row.notes || "",
        });
      }
    }
    if (grants.projects) {
      for (const row of vault.projectEntries) {
        const project = vault.projects.find((item) => item.id === row.project_id);
        addBook({
          id: `pr-${row.id}`,
          date: row.entry_on || String(row.created_at || "").slice(0, 10),
          type: "Project", kind: "project",
          person: lineOwner(project || {}) || row.created_by_name || "Household",
          owner_id: project?.owner_id, title: project?.name || "Project", category: "Life project",
          amount_cents: row.amount_cents, flow: "out", notes: row.notes || "",
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
      savings: grants.savings ? vault.savings.map((row) => ({ id: row.id, name: row.name, target_cents: row.target_cents, current_cents: row.current_cents, owner_id: row.owner_id, owner_name: lineOwner(row) })) : [],
      projects: grants.projects
        ? vault.projects.filter((row) => row.status !== "done").slice(0, 6).map((row) => ({
          ...row,
          owner_name: lineOwner(row),
          spent_cents: vault.projectEntries.filter((item) => item.project_id === row.id).reduce((s, r) => s + r.amount_cents, 0),
        }))
        : [],
    };
  },

  async board() {
    await requireGrant("plans");
    return {
      lists: [...memory.lists].sort((a, b) => a.order - b.order),
      cards: memory.cards.map((card) => ({ ...card, owner_name: card.owner_name || ownerName(card.ownerId) })),
    };
  },

  async addList(title) {
    await requireGrant("plans");
    const name = cleanText(title, 60);
    if (!name) throw new Error("Give the column a name.");
    const { error } = await supabase.from("lists").insert({
      household_id: memory.household.id,
      title: name,
      position: memory.lists.length,
    });
    if (error) explainError(error);
    await reload();
    return { ok: true };
  },

  async renameList(id, title) {
    await requireGrant("plans");
    const name = cleanText(title, 60);
    if (!name) throw new Error("Give the column a name.");
    const { error } = await supabase.from("lists").update({ title: name }).eq("id", id).eq("household_id", memory.household.id);
    if (error) explainError(error);
    await reload();
    return { ok: true };
  },

  async deleteList(id) {
    await requireGrant("plans");
    const { error } = await supabase.from("lists").delete().eq("id", id).eq("household_id", memory.household.id);
    if (error) explainError(error);
    await reload();
    return { ok: true };
  },

  async addCard(body) {
    const { user } = await requireGrant("plans");
    const title = cleanText(body.title, 140);
    if (!title) throw new Error("A card needs a title.");
    const list = memory.lists.find((row) => row.id === body.listId) || memory.lists[0];
    if (!list) throw new Error("Add a column first.");
    const ownerId = String(body.ownerId || user.id);
    const { error } = await supabase.from("cards").insert({
      household_id: memory.household.id,
      list_id: list.id,
      title,
      plan: cleanText(body.plan, 8000),
      labels: cleanLabels(body.labels),
      owner_id: ownerId,
      due_on: body.due ? parseDate(body.due) : null,
      position: memory.cards.filter((row) => row.listId === list.id).length,
      checklist: cleanChecklist(body.checklist),
    });
    if (error) explainError(error);
    await logActivity("plans", `Added plan card: ${title}`);
    await reload();
    return { ok: true };
  },

  async updateCard(id, body) {
    await requireGrant("plans");
    const patch = {};
    if (body.title != null) patch.title = cleanText(body.title, 140);
    if (body.plan != null) patch.plan = cleanText(body.plan, 8000);
    if (body.labels) patch.labels = cleanLabels(body.labels);
    if (body.ownerId) patch.owner_id = String(body.ownerId);
    if (body.due !== undefined) patch.due_on = body.due ? parseDate(body.due) : null;
    if (body.checklist) patch.checklist = cleanChecklist(body.checklist);
    if (body.listId && memory.lists.some((row) => row.id === body.listId)) patch.list_id = body.listId;
    const { error } = await supabase.from("cards").update(patch).eq("id", id).eq("household_id", memory.household.id);
    if (error) explainError(error);
    await reload();
    return { ok: true };
  },

  async moveCard(id, listId) {
    await requireGrant("plans");
    if (!memory.lists.some((row) => row.id === listId)) throw new Error("Column not found.");
    const position = memory.cards.filter((row) => row.listId === listId).length;
    const { error } = await supabase.from("cards").update({ list_id: listId, position }).eq("id", id).eq("household_id", memory.household.id);
    if (error) explainError(error);
    await reload();
    return { ok: true };
  },

  async deleteCard(id) {
    await requireGrant("plans");
    const { error } = await supabase.from("cards").delete().eq("id", id).eq("household_id", memory.household.id);
    if (error) explainError(error);
    await reload();
    return { ok: true };
  },

  async exportData() {
    await requireGrant("household");
    const vault = memory;
    return {
      household: vault.household,
      members: vault.users.map((row) => ({ id: row.id, name: row.name, role: row.role })),
      incomes: vault.incomes,
      expenses: vault.expenses,
      costs: vault.costs,
      savings: vault.savings,
      projects: vault.projects,
      exportedAt: nowIso(),
    };
  },

  hasDeviceHouse() {
    return hasLocalVault();
  },

  forgetDevice() {
    forgetDeviceCopy();
    return { ok: true };
  },

  async importDeviceHouse() {
    const { user } = await requireAdmin();
    const local = await openLocalVault();
    if (!local) throw new Error("Nothing saved on this device could be opened.");
    const hid = memory.household.id;
    const rows = [
      ...(local.incomes || []), ...(local.expenses || []), ...(local.costs || []),
      ...(local.savings || []), ...(local.projects || []), ...(local.projectEntries || []),
      ...(local.cards || []),
    ];
    if (rows.length > 1500) throw new Error("That device copy is too large to bring in at once.");
    const legacyName = (ownerId) => local.users?.find((row) => row.id === ownerId)?.name || user.name;
    const insert = async (table, payload) => {
      const { error } = await supabase.from(table).insert(payload);
      if (error) explainError(error);
    };
    for (const row of local.incomes || []) {
      const title = cleanText(row.source, 120);
      const date = parseDate(row.received_on);
      if (!title || !date || !Number.isFinite(row.amount_cents)) continue;
      await insert("incomes", {
        household_id: hid,
        owner_id: user.id,
        owner_name: legacyName(row.owner_id),
        source: title,
        category: INCOME_CATEGORIES.includes(row.category) ? row.category : "Other",
        amount_cents: Math.max(0, Math.round(row.amount_cents)),
        received_on: date,
        recurring: RECURRING.includes(row.recurring) ? row.recurring : "none",
        notes: cleanText(row.notes, 400),
      });
    }
    for (const row of local.expenses || []) {
      const title = cleanText(row.merchant, 120);
      const date = parseDate(row.spent_on);
      if (!title || !date || !Number.isFinite(row.amount_cents)) continue;
      await insert("expenses", {
        household_id: hid,
        owner_id: user.id,
        owner_name: legacyName(row.owner_id),
        merchant: title,
        category: EXPENSE_CATEGORIES.includes(row.category) ? row.category : "Other",
        amount_cents: Math.max(0, Math.round(row.amount_cents)),
        spent_on: date,
        recurring: RECURRING.includes(row.recurring) ? row.recurring : "none",
        notes: cleanText(row.notes, 400),
      });
    }
    for (const row of local.costs || []) {
      const title = cleanText(row.title, 120);
      const date = parseDate(row.due_on);
      if (!title || !date || !Number.isFinite(row.amount_cents)) continue;
      await insert("costs", {
        household_id: hid,
        owner_id: user.id,
        owner_name: legacyName(row.owner_id),
        title,
        category: COST_CATEGORIES.includes(row.category) ? row.category : "Other",
        amount_cents: Math.max(0, Math.round(row.amount_cents)),
        due_on: date,
        recurring: RECURRING.includes(row.recurring) ? row.recurring : "none",
        notes: cleanText(row.notes, 400),
      });
    }
    for (const row of local.savings || []) {
      const name = cleanText(row.name, 120);
      if (!name) continue;
      await insert("savings", {
        household_id: hid,
        owner_id: user.id,
        owner_name: legacyName(row.owner_id),
        name,
        target_cents: Math.max(0, Math.round(row.target_cents || 0)),
        current_cents: Math.max(0, Math.round(row.current_cents || 0)),
        monthly_cents: Math.max(0, Math.round(row.monthly_cents || 0)),
        target_date: row.target_date ? parseDate(row.target_date) : null,
        notes: cleanText(row.notes, 400),
      });
    }
    const projectIds = new Map();
    for (const row of local.projects || []) {
      const name = cleanText(row.name, 120);
      if (!name) continue;
      const { data, error } = await supabase.from("projects").insert({
        household_id: hid,
        owner_id: user.id,
        owner_name: legacyName(row.owner_id),
        name,
        budget_cents: Math.max(0, Math.round(row.budget_cents || row.target_cents || 0)),
        status: PROJECT_STATUSES.includes(row.status) ? row.status : "planned",
        target_date: row.target_date ? parseDate(row.target_date) : null,
        notes: cleanText(row.notes, 400),
      }).select("id").single();
      if (error) explainError(error);
      projectIds.set(row.id, data.id);
    }
    for (const row of local.projectEntries || []) {
      const projectId = projectIds.get(row.project_id);
      const date = parseDate(row.entry_on || row.spent_on);
      if (!projectId || !date || !row.amount_cents) continue;
      await insert("project_entries", {
        household_id: hid,
        project_id: projectId,
        amount_cents: Math.max(1, Math.round(row.amount_cents)),
        entry_on: date,
        notes: cleanText(row.notes, 200),
        created_by_name: row.created_by_name || user.name,
      });
    }
    await reload();
    const listByTitle = new Map(memory.lists.map((list) => [list.title, list.id]));
    const oldTitles = new Map((local.lists || []).map((list) => [list.id, list.title]));
    const fallback = memory.lists[0]?.id;
    for (const row of local.cards || []) {
      const title = cleanText(row.title, 140);
      if (!title || !fallback) continue;
      const listId = listByTitle.get(oldTitles.get(row.listId)) || fallback;
      await insert("cards", {
        household_id: hid,
        list_id: listId,
        title,
        plan: cleanText(row.plan, 8000),
        labels: cleanLabels(row.labels),
        owner_id: user.id,
        owner_name: legacyName(row.ownerId),
        due_on: row.due ? parseDate(row.due) : null,
        position: Number.isFinite(row.order) ? row.order : 0,
        checklist: cleanChecklist(row.checklist),
      });
    }
    await logActivity("setup", "Brought in the books saved on this device");
    await reload();
    return { ok: true };
  },

  syncCode() {
    return "";
  },
};

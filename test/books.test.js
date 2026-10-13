import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emailProblem, normalizeEmail, passwordProblem } from "../client/src/authRules.js";
import { monthBounds, parseCents } from "../client/src/security.js";
import { decryptJson, encryptJson } from "../client/src/security.js";

test("password and email rules", () => {
  assert.equal(emailProblem(""), "Add your email.");
  assert.equal(emailProblem("not-an-email"), "Enter a valid email.");
  assert.equal(emailProblem("ada@house.example"), "");
  assert.equal(normalizeEmail(" Ada@House.Example "), "ada@house.example");
  assert.match(passwordProblem("short"), /10/);
  assert.match(passwordProblem("letters-only"), /letters and numbers/);
  assert.equal(passwordProblem("ledgerbook1"), "");
  assert.match(passwordProblem("ledgerbook1", "ledgerbook1"), /email/);
  assert.match(passwordProblem("x".repeat(73)), /too long/);
});

test("money and months stay in cents and calendar bounds", () => {
  assert.equal(parseCents("10.10"), 1010);
  assert.equal(parseCents(0), 0);
  assert.equal(parseCents(-1), null);
  assert.equal(parseCents("nope"), null);
  const feb = monthBounds("2026-02");
  assert.deepEqual(feb, { month: "2026-02", start: "2026-02-01", end: "2026-02-28" });
  const leap = monthBounds("2024-02");
  assert.equal(leap.end, "2024-02-29");
});

test("device vault encryption round trip", async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const payload = { household: "At home", cents: 2500 };
  const packed = await encryptJson(payload, key);
  assert.notEqual(packed.ct, JSON.stringify(payload));
  assert.deepEqual(await decryptJson(packed, key), payload);
  await assert.rejects(() => decryptJson(packed, crypto.getRandomValues(new Uint8Array(32))));
});

test("schema locks household tables to members", () => {
  const sql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const tables = [
    "profiles", "households", "members", "invites", "join_attempts",
    "incomes", "expenses", "costs", "savings", "savings_entries",
    "projects", "project_entries", "messages", "activity", "lists", "cards",
  ];
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /extensions\.digest/);
  assert.match(sql, /revoke all on all tables in schema public from public, anon, authenticated/);
  assert.equal(sql.includes("service_role"), false);
  assert.equal(/grant .* to anon/i.test(sql), false);
});

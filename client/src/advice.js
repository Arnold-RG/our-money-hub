import { money } from "./format.js";

function share(part, whole) {
  if (!whole) return 0;
  return part / whole;
}

export function buildAdvice({ dash, savings = [], projects = [], currency = "PLN" }) {
  const income = dash?.totals?.income || 0;
  const spend = dash?.totals?.outflow || 0;
  const surplus = dash?.totals?.surplus || 0;
  const savedStock = dash?.totals?.savingsTotal || 0;
  const savedMonth = dash?.totals?.savingsMonth || 0;
  const categories = [...(dash?.categories || [])];
  const needsShare = share(spend, income);
  const saveShare = share(Math.max(0, surplus), income);
  const targetSave = Math.round(income * 0.2);
  const targetNeeds = Math.round(income * 0.5);
  const targetWants = Math.round(income * 0.3);
  const health = scoreHealth({ income, spend, surplus, savedStock, saveShare });
  const ideas = [];

  if (!income) {
    ideas.push({
      tone: "warn",
      title: "Write this month’s income first",
      body: "The advisor needs at least one income entry to judge the household. Record salaries and other money in, then recalculate.",
    });
  }

  if (income && surplus < 0) {
    ideas.push({
      tone: "warn",
      title: "This month spends more than it earns",
      body: `Outflow is ${money(Math.abs(surplus), currency)} above income. Freeze entertainment and extras until the books are even. Keep housing, food, and transport. Move every leftover złoty to the emergency pot.`,
    });
  } else if (income && saveShare < 0.1) {
    ideas.push({
      tone: "warn",
      title: "Save at least 10% of income",
      body: `You are keeping ${Math.round(saveShare * 100)}% this month. A simple household rule is 20% saved, 50% needs, 30% wants. That would put ${money(targetSave, currency)} aside from this month’s income.`,
    });
  } else if (income && saveShare >= 0.2) {
    ideas.push({
      tone: "ok",
      title: "The 20% save rule is already working",
      body: `You kept ${Math.round(saveShare * 100)}% of income. Keep paying the savings pots on payday, before shopping, so the habit does not slip.`,
    });
  }

  const top = categories[0];
  if (top && income && top.amount_cents > income * 0.25) {
    const cut = Math.round(top.amount_cents * 0.15);
    ideas.push({
      tone: "idea",
      title: `Trim ${top.category} by 15%`,
      body: `${top.category} is the heaviest spend at ${money(top.amount_cents, currency)}. A 15% cut frees ${money(cut, currency)} this month — enough to lift the savings rate without touching rent.`,
      extra: { category: top.category, cut },
    });
  }

  const emergencyTarget = spend * 3;
  if (spend && savedStock < emergencyTarget) {
    ideas.push({
      tone: "idea",
      title: "Build three months of breathing room",
      body: `Three months of current spending is ${money(emergencyTarget, currency)}. You hold ${money(savedStock, currency)}. If the surplus holds, that cushion takes about ${monthsTo(emergencyTarget - savedStock, Math.max(surplus, 1))} month(s).`,
    });
  } else if (spend && savedStock >= emergencyTarget) {
    ideas.push({
      tone: "ok",
      title: "The emergency cushion is in place",
      body: "Three months of spending is covered. Extra surplus can now go to named life projects instead of sitting idle.",
    });
  }

  const hungryProject = [...projects].filter((row) => row.status !== "done").sort((a, b) => (a.budget_cents - a.spent_cents) - (b.budget_cents - b.spent_cents))[0];
  if (hungryProject && surplus > 0) {
    const gap = Math.max(0, hungryProject.budget_cents - hungryProject.spent_cents);
    ideas.push({
      tone: "idea",
      title: `Feed “${hungryProject.name}” from leftover złoty`,
      body: gap
        ? `The project still needs ${money(gap, currency)}. This month’s surplus of ${money(surplus, currency)} would cover ${Math.min(100, Math.round((surplus / gap) * 100))}% of the remaining budget if you send it there on purpose.`
        : "That project is fully funded. Mark it done or raise the budget if the work grew.",
    });
  }

  const slowPot = [...savings].filter((row) => row.target_cents > row.current_cents).sort((a, b) => (a.monthly_cents || 0) - (b.monthly_cents || 0))[0];
  if (slowPot && surplus > 0) {
    const left = slowPot.target_cents - slowPot.current_cents;
    const pace = slowPot.monthly_cents || surplus;
    ideas.push({
      tone: "idea",
      title: `Keep “${slowPot.name}” on a payday rhythm`,
      body: `${money(left, currency)} remains. At ${money(pace, currency)} a month, you arrive in about ${monthsTo(left, pace)} month(s). Move the money the same day income lands, not at the end of the month.`,
    });
  }

  if (income && spend > targetNeeds && surplus >= 0) {
    ideas.push({
      tone: "idea",
      title: "Live on 50% needs, 30% wants, 20% saved",
      body: `Needs/spend are running at ${Math.round(needsShare * 100)}% of income (aim 50%). Wants should stay near ${money(targetWants, currency)}. Saved should be near ${money(targetSave, currency)}. Cook more meals at home, delay one optional buy, and name every złoty that is left.`,
    });
  }

  if (savedMonth < 0) {
    ideas.push({
      tone: "warn",
      title: "Savings were drawn down this month",
      body: `Net ${money(Math.abs(savedMonth), currency)} left the pots. Use the board to write why, then replace it from the next income before new spending starts.`,
    });
  }

  if (!ideas.length) {
    ideas.push({
      tone: "ok",
      title: "The household is in balance",
      body: "Keep recording every figure. Recalculate after each payday so the advice stays honest.",
    });
  }

  return {
    health,
    income,
    spend,
    surplus,
    savedStock,
    savedMonth,
    saveShare,
    needsShare,
    targetSave,
    targetNeeds,
    targetWants,
    topCategory: top || null,
    ideas,
  };
}

function monthsTo(amount, monthly) {
  if (amount <= 0) return 0;
  if (!monthly || monthly <= 0) return "—";
  return Math.max(1, Math.ceil(amount / monthly));
}

function scoreHealth({ income, spend, surplus, savedStock, saveShare }) {
  if (!income) return 20;
  let score = 40;
  if (surplus >= 0) score += 20;
  else score -= 15;
  score += Math.round(Math.min(0.25, Math.max(0, saveShare)) * 120);
  if (spend && savedStock >= spend * 3) score += 15;
  else if (spend && savedStock >= spend) score += 8;
  return Math.max(5, Math.min(100, score));
}

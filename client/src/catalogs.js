export const CURRENCIES = [
  { code: "PLN", name: "Polish złoty" },
  { code: "EUR", name: "Euro" },
  { code: "USD", name: "US dollar" },
  { code: "RWF", name: "Rwandan franc" },
  { code: "XAF", name: "Central African CFA franc (Congo-Brazzaville)" },
  { code: "CDF", name: "Congolese franc" },
  { code: "XOF", name: "West African CFA franc" },
  { code: "GBP", name: "British pound" },
  { code: "KES", name: "Kenyan shilling" },
  { code: "UGX", name: "Ugandan shilling" },
  { code: "NGN", name: "Nigerian naira" },
  { code: "ZAR", name: "South African rand" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "AUD", name: "Australian dollar" },
  { code: "CHF", name: "Swiss franc" },
  { code: "CZK", name: "Czech koruna" },
  { code: "UAH", name: "Ukrainian hryvnia" },
  { code: "SEK", name: "Swedish krona" },
  { code: "NOK", name: "Norwegian krone" },
  { code: "DKK", name: "Danish krone" },
  { code: "JPY", name: "Japanese yen" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "INR", name: "Indian rupee" },
];

export const CURRENCY_CODES = CURRENCIES.map((item) => item.code);

export const INCOME_CATEGORIES = ["Salary", "Business", "Freelance", "Gift", "Investment", "Support", "Other"];
export const EXPENSE_CATEGORIES = ["Housing", "Food", "Transport", "Utilities", "Health", "Education", "Family", "Entertainment", "Debt", "Other"];
export const COST_CATEGORIES = ["Insurance", "Fees", "Maintenance", "Subscriptions", "Unexpected", "Other"];
export const PROJECT_STATUSES = ["planned", "active", "paused", "done"];
export const RECURRING = ["none", "weekly", "monthly", "yearly"];
export const PLAN_LABELS = ["Home", "Travel", "School", "Work", "Family", "Urgent"];

export function currencyName(code) {
  return CURRENCIES.find((item) => item.code === code)?.name || code;
}

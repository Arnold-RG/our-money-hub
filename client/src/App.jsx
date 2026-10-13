import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api.js";
import { currentMonth } from "./format.js";
import { Icon, OmhMark } from "./ui.jsx";
import { Welcome } from "./pages/Welcome.jsx";
import { Dashboard } from "./pages/Dashboard.jsx";
import { Ledger } from "./pages/Ledger.jsx";
import { Savings } from "./pages/Savings.jsx";
import { Projects } from "./pages/Projects.jsx";
import { Exchange } from "./pages/Exchange.jsx";
import { Plans } from "./pages/Plans.jsx";
import { People } from "./pages/People.jsx";
import { Settings } from "./pages/Settings.jsx";
import { Opening } from "./Opening.jsx";
import { Advisor } from "./pages/Advisor.jsx";
import { supabase } from "./supabaseClient.js";

const NAV = [
  { to: "/", label: "Home", icon: "home", grant: "household" },
  { to: "/people", label: "People", icon: "chat", grant: "people" },
  { to: "/income", label: "Income", icon: "in", grant: "income" },
  { to: "/expenses", label: "Expenses", icon: "out", grant: "expenses" },
  { to: "/savings", label: "Savings", icon: "save", grant: "savings" },
  { to: "/projects", label: "Projects", icon: "project", grant: "projects" },
  { to: "/costs", label: "Other costs", icon: "out", grant: "costs" },
  { to: "/exchange", label: "Exchange", icon: "calc", grant: "exchange" },
  { to: "/plans", label: "Plans", icon: "board", grant: "plans" },
  { to: "/advisor", label: "Advisor", icon: "idea", grant: "advisor" },
  { to: "/settings", label: "Settings", icon: "gear", grant: "settings" },
];

const TITLES = {
  "/": "Home",
  "/people": "People",
  "/income": "Income",
  "/expenses": "Expenses",
  "/savings": "Savings",
  "/projects": "Projects",
  "/costs": "Other costs",
  "/exchange": "Exchange",
  "/plans": "Plans",
  "/advisor": "Advisor",
  "/settings": "Settings",
};

export default function App() {
  const [boot, setBoot] = useState(null);
  const [month, setMonth] = useState(currentMonth());
  const [theme, setTheme] = useState(() => localStorage.getItem("omh-theme") || "light");
  const [more, setMore] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [introDone, setIntroDone] = useState(() => sessionStorage.getItem("omh.intro") === "done");
  const location = useLocation();

  async function refresh() {
    const data = await api.bootstrap();
    setBoot(data);
  }

  useEffect(() => {
    refresh().catch((err) => setBoot({ error: err.message, configured: true }));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function apply() {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved === "dark" ? "dark" : "light";
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", resolved === "dark" ? "#12100e" : "#f6f1e7");
    }
    apply();
    localStorage.setItem("omh-theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    setMore(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!more) return undefined;
    function onKey(event) {
      if (event.key === "Escape") setMore(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [more]);

  useEffect(() => {
    if (!supabase) return undefined;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") {
        setRecovery(false);
        refresh().catch((err) => setBoot({ error: err.message, configured: true }));
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const house = boot?.household?.name;
    const page = TITLES[location.pathname];
    document.title = boot?.user && house && page ? `${page} · ${house}` : "Our Money Hub";
  }, [location.pathname, boot]);

  const joining = location.pathname.startsWith("/join") || location.pathname.startsWith("/create");

  const links = useMemo(() => {
    if (!boot?.user || !boot?.household) return [];
    return NAV.filter((item) => item.to === "/" || item.to === "/settings" || Boolean(boot.grants?.[item.grant]));
  }, [boot]);

  if (!introDone) {
    return <Opening onDone={() => setIntroDone(true)} />;
  }

  if (!boot) {
    return <div className="start-wrap"><p className="lede">Opening Our Money Hub…</p></div>;
  }
  if (boot.error && boot.configured !== false && !boot.user) {
    return (
      <div className="start-wrap">
        <div className="gate gate-single">
          <div className="gate-body">
            <h1>Our Money Hub</h1>
            <p className="lede">{boot.error}</p>
            <button className="btn" type="button" onClick={() => { setBoot(null); refresh().catch((err) => setBoot({ error: err.message, configured: true })); }}>Try again</button>
          </div>
        </div>
      </div>
    );
  }
  if (boot.configured === false) {
    return <Welcome boot={boot} mode="offline" onDone={refresh} />;
  }
  if (recovery) {
    return <Welcome boot={boot} mode="reset" onDone={() => { setRecovery(false); refresh(); }} />;
  }
  if (!boot.user || !boot.household || joining) {
    return <Welcome boot={boot} onDone={refresh} />;
  }

  const session = boot;
  const mobileMain = links.slice(0, 4);
  const mobileMore = links.slice(4);

  return (
    <div className="app-shell">
      <button className="skip" type="button" onClick={() => document.getElementById("content")?.focus()}>Skip to the books</button>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><OmhMark /></div>
          <div>
            <p className="brand-name">OMH</p>
            <p>{session.household?.name || "Our Money Hub"}</p>
          </div>
        </div>
        <nav className="nav-list" aria-label="Household">
          {links.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <strong>{session.user.name}</strong>
            <span>{roleLine(session.user.role)}</span>
          </div>
          <button className="sidebar-btn" type="button" onClick={async () => {
            await api.logout();
            await refresh();
          }}>Sign out</button>
        </div>
      </aside>

      <main className="main" id="content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Dashboard session={session} month={month} setMonth={setMonth} />} />
          <Route path="/people" element={gate(session, "people", <People session={session} onRefresh={refresh} />)} />
          <Route path="/income" element={gate(session, "income", <Ledger kind="income" session={session} month={month} setMonth={setMonth} />)} />
          <Route path="/expenses" element={gate(session, "expenses", <Ledger kind="expenses" session={session} month={month} setMonth={setMonth} />)} />
          <Route path="/savings" element={gate(session, "savings", <Savings session={session} />)} />
          <Route path="/projects" element={gate(session, "projects", <Projects session={session} />)} />
          <Route path="/costs" element={gate(session, "costs", <Ledger kind="costs" session={session} month={month} setMonth={setMonth} />)} />
          <Route path="/exchange" element={gate(session, "exchange", <Exchange session={session} />)} />
          <Route path="/plans" element={gate(session, "plans", <Plans session={session} />)} />
          <Route path="/advisor" element={gate(session, "advisor", <Advisor session={session} month={month} setMonth={setMonth} />)} />
          <Route path="/settings" element={<Settings session={session} theme={theme} setTheme={setTheme} onRefresh={refresh} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="bottom-nav" aria-label="Household">
        {mobileMain.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => isActive ? "active" : ""}>
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
        <button type="button" className={more ? "active" : ""} aria-expanded={more} aria-controls="more-menu" onClick={() => setMore((value) => !value)}>
          <Icon name="more" />
          More
        </button>
      </nav>
      {more && (
        <div className="more-back" onClick={() => setMore(false)}>
          <div className="more-sheet" id="more-menu" role="dialog" aria-label="More pages" onClick={(event) => event.stopPropagation()}>
            {mobileMore.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={() => setMore(false)}>
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function roleLine(role) {
  if (role === "admin") return "Admin of this household";
  if (role === "member") return "Member of this household";
  return "Signed in";
}

function gate(session, grant, node) {
  if (!session.grants?.[grant] && grant !== "settings") {
    return <Navigate to="/" replace />;
  }
  return node;
}

import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api.js";
import { currentMonth } from "./format.js";
import { clearSession, touchSession } from "./security.js";
import { Icon, OmhMark } from "./ui.jsx";
import { Auth } from "./pages/Auth.jsx";
import { Dashboard } from "./pages/Dashboard.jsx";
import { Ledger } from "./pages/Ledger.jsx";
import { Savings } from "./pages/Savings.jsx";
import { Projects } from "./pages/Projects.jsx";
import { Exchange } from "./pages/Exchange.jsx";
import { Plans } from "./pages/Plans.jsx";
import { People } from "./pages/People.jsx";
import { Settings } from "./pages/Settings.jsx";

const NAV = [
  { to: "/", label: "Home", icon: "home", grant: "household" },
  { to: "/income", label: "Income", icon: "in", grant: "income" },
  { to: "/expenses", label: "Expenses", icon: "out", grant: "expenses" },
  { to: "/savings", label: "Savings", icon: "save", grant: "savings" },
  { to: "/projects", label: "Projects", icon: "project", grant: "projects" },
  { to: "/costs", label: "Other costs", icon: "out", grant: "costs" },
  { to: "/exchange", label: "Exchange", icon: "calc", grant: "exchange" },
  { to: "/plans", label: "Plans", icon: "board", grant: "plans" },
  { to: "/people", label: "People", icon: "people", grant: "people" },
  { to: "/settings", label: "Settings", icon: "gear", grant: "settings" },
];

export default function App() {
  const [boot, setBoot] = useState(null);
  const [month, setMonth] = useState(currentMonth());
  const [theme, setTheme] = useState(() => localStorage.getItem("omh-theme") || "light");
  const [more, setMore] = useState(false);
  const location = useLocation();

  async function refresh() {
    const data = await api.bootstrap();
    setBoot(data);
  }

  useEffect(() => {
    refresh().catch((err) => setBoot({ error: err.message }));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("omh-theme", theme);
  }, [theme]);

  useEffect(() => {
    setMore(false);
  }, [location.pathname]);

  useEffect(() => {
    function ping() {
      if (!touchSession()) {
        clearSession();
        refresh();
      }
    }
    const id = setInterval(ping, 30000);
    window.addEventListener("pointerdown", ping);
    window.addEventListener("keydown", ping);
    return () => {
      clearInterval(id);
      window.removeEventListener("pointerdown", ping);
      window.removeEventListener("keydown", ping);
    };
  }, []);

  const links = useMemo(() => {
    if (!boot?.user) return [];
    return NAV.filter((item) => item.to === "/" || item.to === "/settings" || Boolean(boot.grants?.[item.grant]));
  }, [boot]);

  if (!boot) {
    return <div className="auth-wrap"><p>Opening Our Money Hub…</p></div>;
  }
  if (boot.error) {
    return <div className="auth-wrap"><p>{boot.error}</p></div>;
  }
  if (boot.needsSetup) {
    return <Auth mode="setup" currencies={boot.currencies || []} onDone={refresh} />;
  }
  if (!boot.user) {
    return <Auth mode="login" onDone={refresh} />;
  }

  const session = boot;
  const mobileMain = links.slice(0, 4);
  const mobileMore = links.slice(4);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><OmhMark /></div>
          <div>
            <h1>OMH</h1>
            <p>{session.household?.name || "Our Money Hub"}</p>
          </div>
        </div>
        <nav className="nav-list">
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
            <span>{session.user.role === "admin" ? "Admin · full household" : session.user.role === "spouse" ? "Partner · full household" : "Guest"}</span>
          </div>
          <button className="btn-ghost" onClick={async () => { await api.logout(); refresh(); }}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard session={session} month={month} setMonth={setMonth} />} />
          <Route path="/income" element={gate(session, "income", <Ledger kind="income" session={session} month={month} setMonth={setMonth} />)} />
          <Route path="/expenses" element={gate(session, "expenses", <Ledger kind="expenses" session={session} month={month} setMonth={setMonth} />)} />
          <Route path="/savings" element={gate(session, "savings", <Savings session={session} />)} />
          <Route path="/projects" element={gate(session, "projects", <Projects session={session} />)} />
          <Route path="/costs" element={gate(session, "costs", <Ledger kind="costs" session={session} month={month} setMonth={setMonth} />)} />
          <Route path="/exchange" element={gate(session, "exchange", <Exchange session={session} />)} />
          <Route path="/plans" element={gate(session, "plans", <Plans session={session} />)} />
          <Route path="/people" element={gate(session, "people", <People session={session} onRefresh={refresh} />)} />
          <Route path="/settings" element={<Settings session={session} theme={theme} setTheme={setTheme} onRefresh={refresh} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="bottom-nav">
        {mobileMain.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => isActive ? "active" : ""}>
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
        <a href="#more" className={more ? "active" : ""} onClick={(event) => { event.preventDefault(); setMore((v) => !v); }}>
          <Icon name="more" />
          More
        </a>
      </nav>
      {more && (
        <div className="more-sheet">
          {mobileMore.map((item) => (
            <NavLink key={item.to} to={item.to}>{item.label}</NavLink>
          ))}
          <button className="btn-ghost" onClick={async () => { await api.logout(); refresh(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}

function gate(session, grant, node) {
  if (!session.grants?.[grant] && grant !== "settings") {
    return <Navigate to="/" replace />;
  }
  return node;
}

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, clearToken, setToken, token } from "./api.js";
import "./app.css";

const STATUS_LABEL = { soaking: "浸茧", reeling: "缫丝中", reeled: "已缫完" };

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Login({ onOk }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("123456");
  const [err, setErr] = useState("");
  async function submit(e) {
    e.preventDefault();
    setErr("");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setToken(data.access_token);
      onOk(data.user);
    } catch (ex) {
      setErr(ex.message);
    }
  }
  return (
    <div class="login">
      <h1>江口缫丝坞</h1>
      <p>汤温环盆作业台，不是列表台账。</p>
      <form onSubmit={submit} autocomplete="off">
        <label>
          用户名
          <input name="username" autocomplete="off" value={username} onInput={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          密码
          <input name="password" type="password" autocomplete="off" value={password} onInput={(e) => setPassword(e.target.value)} />
        </label>
        <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
        <button type="submit">登录</button>
      </form>
      {err && <p class="err">{err}</p>}
    </div>
  );
}

function TopBar({ title, subtitle, view, setView, onLogout }) {
  return (
    <div class="topbar">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <nav class="tabs">
        <button class={view === "yard" ? "tab active" : "tab"} onClick={() => setView("yard")}>
          环盆作业台
        </button>
        <button class={view === "quota" ? "tab active" : "tab"} onClick={() => setView("quota")}>
          小箴配额
        </button>
        <button onClick={onLogout}>退出</button>
      </nav>
    </div>
  );
}

function Yard({ topbar }) {
  const [board, setBoard] = useState(null);
  const [picked, setPicked] = useState(null);
  const [temp, setTemp] = useState("40");
  const [err, setErr] = useState("");

  async function refresh() {
    const data = await api("/api/board");
    setBoard(data);
    setPicked((prev) =>
      prev ? data.basins.find((b) => b.id === prev.id) || null : null
    );
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e.message));
  }, []);

  if (!board) {
    return (
      <div class="yard">
        {topbar}
        {err || "装载环盆…"}
      </div>
    );
  }

  const n = board.basins.length;
  const noRounds = picked != null && picked.remainingRounds <= 0;

  async function writeTemp() {
    setErr("");
    if (picked.remainingRounds <= 0) {
      setErr("小箴剩余圈数为 0，不能登记汤温，请联系管理员补圈");
      return;
    }
    try {
      const row = await api(`/api/basins/${picked.id}/readings`, {
        method: "POST",
        body: JSON.stringify({ waterTempC: Number(temp) }),
      });
      await refresh();
      setPicked(row);
    } catch (ex) {
      setErr(ex.message);
      await refresh().catch(() => {});
    }
  }
  async function setStatus(status) {
    setErr("");
    try {
      const row = await api(`/api/basins/${picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await refresh();
      setPicked(row);
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div class="yard">
      {topbar}
      <div class="ring">
        {board.basins.map((b, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const left = 50 + Math.cos(angle) * 38;
          const top = 50 + Math.sin(angle) * 38;
          return (
            <button
              key={b.id}
              class={`basin ${b.status}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              onClick={() => setPicked(b)}
            >
              <strong>{b.code}</strong>
              <span>{STATUS_LABEL[b.status]}</span>
              <span class="rounds">余 {b.remainingRounds} 圈</span>
            </button>
          );
        })}
      </div>
      {picked && (
        <div class="drawer">
          <h3>
            {picked.code} · {STATUS_LABEL[picked.status]}
          </h3>
          <p>
            最近汤温：{picked.latestTempC ?? "无"} ℃ · 记录 {picked.readingCount} 次 ·{" "}
            <b class={noRounds ? "err" : "ok"}>小箴剩余 {picked.remainingRounds} 圈</b>
          </p>
          {noRounds ? (
            <p class="err">该盆小箴剩余圈数为 0，不能登记汤温，请联系管理员到「小箴配额」补圈。</p>
          ) : null}
          <input
            value={temp}
            onInput={(e) => setTemp(e.target.value)}
            disabled={noRounds}
          />
          <button onClick={writeTemp} disabled={noRounds}>
            登记汤温（扣 1 圈）
          </button>
          <div>
            <button onClick={() => setStatus("soaking")}>浸茧</button>
            <button onClick={() => setStatus("reeling")}>缫丝中</button>
            <button onClick={() => setStatus("reeled")}>已缫完</button>
          </div>
          <p class="hint">改盆态不扣圈；圈数与「已缫完」门槛互不影响。</p>
          {err && <p class="err">{err}</p>}
        </div>
      )}
    </div>
  );
}

function QuotaPage({ isAdmin, topbar }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState({});
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load(filter = q) {
    setErr("");
    try {
      const data = await api(`/api/quotas${filter ? `?q=${encodeURIComponent(filter)}` : ""}`);
      setRows(data.basins);
    } catch (ex) {
      setErr(ex.message);
    }
  }

  useEffect(() => {
    load("");
  }, []);

  async function refill(basinId) {
    setMsg("");
    setErr("");
    const amount = Math.floor(Number(draft[basinId]));
    if (!Number.isInteger(amount) || amount < 1) {
      setErr("补圈数须为大于 0 的整数");
      return;
    }
    try {
      await api(`/api/basins/${basinId}/quota`, {
        method: "POST",
        body: JSON.stringify({ add: amount }),
      });
      setDraft((d) => ({ ...d, [basinId]: "" }));
      setMsg(`已补 ${amount} 圈`);
      await load();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div class="yard">
      {topbar}
      <div class="quota-head">
        <h2>小箴配额</h2>
        <div class="filter">
          <input
            placeholder="按盆号筛选，如 甲"
            value={q}
            onInput={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
          <button onClick={() => load()}>筛选</button>
        </div>
      </div>
      {!isAdmin && <p class="hint">缫丝工仅可查看剩余圈数；补圈请联系管理员。</p>}
      {msg && <p class="ok">{msg}</p>}
      {err && <p class="err">{err}</p>}
      {rows === null ? (
        <p>装载配额…</p>
      ) : (
        <table class="quota-table">
          <thead>
            <tr>
              <th>盆</th>
              <th>盆态</th>
              <th>剩余圈数</th>
              <th>更新时刻</th>
              {isAdmin && <th>管理员补圈</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} class={b.remainingRounds <= 0 ? "zero" : ""}>
                <td>{b.code}</td>
                <td>{STATUS_LABEL[b.status] || b.status}</td>
                <td class="num">{b.remainingRounds}</td>
                <td>{formatTime(b.quotaUpdatedAt)}</td>
                {isAdmin && (
                  <td>
                    <input
                      class="add-input"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="圈数"
                      value={draft[b.id] ?? ""}
                      onInput={(e) => setDraft((d) => ({ ...d, [b.id]: e.target.value }))}
                    />
                    <button onClick={() => refill(b.id)}>加回去</button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colspan={isAdmin ? 5 : 4} class="hint">
                  没有匹配的盆。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("yard");

  useEffect(() => {
    if (!token()) return;
    api("/api/auth/me")
      .then((u) => setUser(u))
      .catch(() => {
        clearToken();
      });
  }, []);

  function logout() {
    clearToken();
    location.reload();
  }

  if (!user) {
    return <Login onOk={(u) => setUser(u)} />;
  }

  const topbar = (
    <TopBar
      title="江口缫丝坞"
      subtitle="东津渡 · 点盆登记汤温；已缫完须最近汤温 38～42℃"
      view={view}
      setView={setView}
      onLogout={logout}
    />
  );

  return view === "quota" ? (
    <QuotaPage key="quota" isAdmin={user.role === "admin"} topbar={topbar} />
  ) : (
    <Yard key="yard" topbar={topbar} />
  );
}

render(<App />, document.getElementById("app"));

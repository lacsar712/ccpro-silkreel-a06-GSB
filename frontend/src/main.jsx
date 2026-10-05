import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, clearToken, setToken, token } from "./api.js";
import "./app.css";

const STATUS_LABEL = { soaking: "浸茧", reeling: "缫丝中", reeled: "已缫完" };

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
      onOk(data.user.role);
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

function Shell({ role, view, onNav, onLogout, children }) {
  return (
    <div class="yard">
      <div class="topbar">
        <div>
          <h1>江口缫丝坞</h1>
          <nav class="nav">
            <button class={view === "yard" ? "active" : ""} onClick={() => onNav("yard")}>
              环盆作业台
            </button>
            <button class={view === "quota" ? "active" : ""} onClick={() => onNav("quota")}>
              小箴配额
            </button>
          </nav>
        </div>
        <div class="who">
          <span>
            {role === "admin" ? "管理员" : "缫丝工"}
          </span>
          <button onClick={onLogout}>退出</button>
        </div>
      </div>
      {children}
    </div>
  );
}

function Yard() {
  const [board, setBoard] = useState(null);
  const [picked, setPicked] = useState(null);
  const [temp, setTemp] = useState("40");
  const [err, setErr] = useState("");

  async function refresh() {
    const data = await api("/api/board");
    setBoard(data);
    if (picked) {
      setPicked(data.basins.find((b) => b.id === picked.id) || data.basins[0]);
    }
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e.message));
  }, []);

  if (!board) {
    return <div>{err || "装载环盆…"}</div>;
  }

  const n = board.basins.length;
  async function writeTemp() {
    setErr("");
    if (Number.isInteger(picked.remainingTurns) && picked.remainingTurns <= 0) {
      setErr("该盆小箴配额已用完，剩余 0 圈，不能再登记汤温");
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
      await refresh();
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

  const noTurns =
    picked && Number.isInteger(picked.remainingTurns) && picked.remainingTurns <= 0;

  return (
    <div>
      <p class="subline">东津渡 · 点盆登记汤温；已缫完须最近汤温 38～42℃；每登一条扣 1 圈小箴配额</p>
      <div class="ring">
        {board.basins.map((b, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const left = 50 + Math.cos(angle) * 38;
          const top = 50 + Math.sin(angle) * 38;
          const empty = Number.isInteger(b.remainingTurns) && b.remainingTurns <= 0;
          return (
            <button
              key={b.id}
              class={`basin ${b.status} ${empty ? "quota-empty" : ""}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              onClick={() => setPicked(b)}
            >
              <strong>{b.code}</strong>
              <span>{STATUS_LABEL[b.status]}</span>
              <span class="turns">余 {empty ? 0 : b.remainingTurns ?? "—"} 圈</span>
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
            最近汤温：{picked.latestTempC ?? "无"} ℃ · 记录 {picked.readingCount} 次 ·
            小箴剩余 <strong class={noTurns ? "zero" : ""}>{picked.remainingTurns ?? "—"}</strong> 圈
          </p>
          <input value={temp} onInput={(e) => setTemp(e.target.value)} disabled={noTurns} />
          <button onClick={writeTemp} disabled={noTurns}>
            登记汤温
          </button>
          {noTurns && <p class="err">该盆小箴配额已用完，剩余 0 圈，不能再登记汤温；请管理员在「小箴配额」补圈。</p>}
          <div>
            <button onClick={() => setStatus("soaking")}>浸茧</button>
            <button onClick={() => setStatus("reeling")}>缫丝中</button>
            <button onClick={() => setStatus("reeled")}>已缫完</button>
          </div>
          {err && <p class="err">{err}</p>}
        </div>
      )}
    </div>
  );
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

function Quotas({ role }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState({});
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  async function load(keyword = q) {
    setErr("");
    setNote("");
    try {
      const data = await api(`/api/quotas${keyword ? `?q=${encodeURIComponent(keyword)}` : ""}`);
      setItems(data.items);
    } catch (ex) {
      setErr(ex.message);
    }
  }

  useEffect(() => {
    load("");
  }, []);

  async function refill(basinId) {
    setErr("");
    setNote("");
    const raw = String(draft[basinId] ?? "").trim();
    const addTurns = Number(raw);
    if (!Number.isInteger(addTurns) || addTurns <= 0) {
      setErr("补圈数必须是大于 0 的整数");
      return;
    }
    try {
      const row = await api(`/api/basins/${basinId}/quotas/refill`, {
        method: "POST",
        body: JSON.stringify({ addTurns }),
      });
      setItems((prev) =>
        (prev || []).map((it) =>
          it.basinId === basinId
            ? { ...it, remainingTurns: row.remainingTurns, updatedAt: row.updatedAt }
            : it
        )
      );
      setDraft((prev) => ({ ...prev, [basinId]: "" }));
      setNote(`已补 ${addTurns} 圈，当前剩余 ${row.remainingTurns} 圈`);
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div class="quota-page">
      <p class="subline">每盆一把小箴配额；登记汤温成功即在同一事务内扣 1 圈，扣到 0 即挡。改盆态不扣圈。</p>
      <div class="filter">
        <input
          placeholder="按盆号筛，如 甲"
          value={q}
          onInput={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button onClick={() => load()}>筛选</button>
        <button
          onClick={() => {
            setQ("");
            load("");
          }}
        >
          全部
        </button>
      </div>
      {err && <p class="err">{err}</p>}
      {note && <p class="ok">{note}</p>}
      {items === null ? (
        <p>装载配额…</p>
      ) : items.length === 0 ? (
        <p>没有匹配的盆。</p>
      ) : (
        <table class="quota-table">
          <thead>
            <tr>
              <th>盆</th>
              <th>盆态</th>
              <th>剩余圈数</th>
              <th>更新时刻</th>
              {role === "admin" && <th>管理员补圈</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const empty = it.remainingTurns <= 0;
              return (
                <tr key={it.basinId} class={empty ? "row-empty" : ""}>
                  <td>{it.code}</td>
                  <td>{STATUS_LABEL[it.status] || it.status}</td>
                  <td class={empty ? "zero" : ""}>{it.remainingTurns}</td>
                  <td>{fmtTime(it.updatedAt)}</td>
                  {role === "admin" && (
                    <td>
                      <input
                        class="refill-input"
                        type="number"
                        min="1"
                        step="1"
                        placeholder="圈数"
                        value={draft[it.basinId] ?? ""}
                        onInput={(e) =>
                          setDraft((prev) => ({ ...prev, [it.basinId]: e.target.value }))
                        }
                        onKeyDown={(e) => e.key === "Enter" && refill(it.basinId)}
                      />
                      <button onClick={() => refill(it.basinId)}>补圈</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {role !== "admin" && <p class="hint">缫丝工可查看配额；补圈请联系管理员。</p>}
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState(Boolean(token()));
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState("worker");
  const [view, setView] = useState("yard");

  useEffect(() => {
    if (!authed) return;
    setReady(false);
    api("/api/auth/me")
      .then((me) => {
        setRole(me.role);
        setReady(true);
      })
      .catch(() => {
        clearToken();
        setAuthed(false);
      });
  }, [authed]);

  if (!authed) {
    return (
      <Login
        onOk={(r) => {
          setRole(r);
          setReady(true);
          setAuthed(true);
        }}
      />
    );
  }
  if (!ready) {
    return <div class="yard">装载…</div>;
  }
  return (
    <Shell
      role={role}
      view={view}
      onNav={setView}
      onLogout={() => {
        clearToken();
        setView("yard");
        setAuthed(false);
      }}
    >
      {view === "quota" ? <Quotas role={role} /> : <Yard />}
    </Shell>
  );
}

render(<App />, document.getElementById("app"));

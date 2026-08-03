(function () {
      const TOKEN_KEY = "patygo_agent_ops_token";
      const loginView = document.getElementById("loginView");
      const opsView = document.getElementById("opsView");
      const loginForm = document.getElementById("loginForm");
      const loginNote = document.getElementById("loginNote");
      let token = sessionStorage.getItem(TOKEN_KEY) || "";
      let timer = null;
      let lastEdgeKey = "";

      const AGENT_META = {
        orchestrator: { label: "Şef", color: "#fbbf24", x: 0.5, y: 0.14 },
        backend: { label: "Backend", color: "#60a5fa", x: 0.18, y: 0.42 },
        frontend: { label: "Frontend", color: "#a78bfa", x: 0.82, y: 0.42 },
        seo: { label: "SEO", color: "#2dd4bf", x: 0.18, y: 0.72 },
        qa: { label: "QA", color: "#34d399", x: 0.5, y: 0.78 },
        release: { label: "Release", color: "#fb923c", x: 0.82, y: 0.72 },
      };

      function showOps(on) {
        loginView.hidden = on;
        opsView.hidden = !on;
      }

      async function api(path, options) {
        const opts = options || {};
        const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
        if (token) headers.Authorization = "Bearer " + token;
        if (opts.body) headers["Content-Type"] = "application/json";
        const res = await fetch(path, Object.assign({}, opts, { headers }));
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(data.error || "İstek başarısız");
        return data;
      }

      function fmtTime(iso) {
        try {
          return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        } catch (_) {
          return "—";
        }
      }

      function agentLabel(id) {
        return (AGENT_META[id] && AGENT_META[id].label) || id;
      }

      function renderFeed(el, events, chief) {
        el.textContent = "";
        if (!events.length) {
          const empty = document.createElement("div");
          empty.className = "item";
          empty.innerHTML = '<div class="sum" style="color:var(--muted)">Henüz kayıt yok.</div>';
          el.appendChild(empty);
          return;
        }
        events.forEach(function (ev) {
          const item = document.createElement("div");
          item.className = "item" + (chief ? " chief" : "");
          const meta = document.createElement("div");
          meta.className = "meta";
          const chip = document.createElement("span");
          chip.className = "chip " + ev.type;
          chip.textContent = ev.type;
          const when = document.createElement("span");
          when.className = "chip";
          when.textContent = fmtTime(ev.at);
          const route = document.createElement("span");
          route.className = "chip";
          route.textContent = agentLabel(ev.from) + (ev.to ? " → " + agentLabel(ev.to) : "");
          meta.appendChild(chip);
          meta.appendChild(when);
          meta.appendChild(route);
          const sum = document.createElement("div");
          sum.className = "sum";
          sum.textContent = ev.summary;
          item.appendChild(meta);
          item.appendChild(sum);
          if (ev.files && ev.files.length) {
            const files = document.createElement("div");
            files.className = "files";
            files.textContent = ev.files.join(" · ");
            item.appendChild(files);
          }
          el.appendChild(item);
        });
      }

      function renderPool(snapshot) {
        const host = document.getElementById("pool");
        const w = host.clientWidth || 640;
        const h = host.clientHeight || 480;
        const activity = snapshot.agentActivity || {};
        const edges = snapshot.edges || [];
        const hot = edges[0] ? edges[0].from + "→" + edges[0].to : "";
        if (hot && hot !== lastEdgeKey) lastEdgeKey = hot;

        const positions = {};
        Object.keys(AGENT_META).forEach(function (id) {
          const m = AGENT_META[id];
          positions[id] = { x: m.x * w, y: m.y * h, color: m.color, label: m.label };
        });

        let svg = '<svg viewBox="0 0 ' + w + " " + h + '" xmlns="http://www.w3.org/2000/svg">';
        edges.forEach(function (edge) {
          const a = positions[edge.from];
          const b = positions[edge.to];
          if (!a || !b) return;
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2 - 24;
          const key = edge.from + "→" + edge.to;
          const cls = key === lastEdgeKey ? "edge hot" : "edge";
          svg +=
            '<path class="' +
            cls +
            '" d="M ' +
            a.x +
            " " +
            a.y +
            " Q " +
            midX +
            " " +
            midY +
            " " +
            b.x +
            " " +
            b.y +
            '" />';
        });

        Object.keys(positions).forEach(function (id) {
          const p = positions[id];
          const act = activity[id] || { count: 0 };
          const r = 22 + Math.min(14, act.count * 1.5);
          const active = act.count > 0 ? " active" : "";
          svg +=
            '<g class="node' +
            active +
            '">' +
            '<circle cx="' +
            p.x +
            '" cy="' +
            p.y +
            '" r="' +
            r +
            '" fill="' +
            p.color +
            '22" stroke="' +
            p.color +
            '" />' +
            '<text x="' +
            p.x +
            '" y="' +
            (p.y + 4) +
            '">' +
            p.label +
            "</text>" +
            '<text class="sub" x="' +
            p.x +
            '" y="' +
            (p.y + r + 14) +
            '">' +
            act.count +
            " olay</text>" +
            "</g>";
        });
        svg += "</svg>";
        host.innerHTML = svg;
      }

      async function tick() {
        try {
          const data = await api("/api/admin/agent-ops?limit=80");
          const snap = data.snapshot || {};
          document.getElementById("statEvents").textContent = String((snap.events || []).length);
          document.getElementById("statEdges").textContent = String((snap.edges || []).length);
          document.getElementById("statDecisions").textContent = String((snap.decisions || []).length);
          document.getElementById("poolStamp").textContent = fmtTime(snap.at);
          document.getElementById("eventStamp").textContent = "yenilendi " + fmtTime(snap.at);
          renderPool(snap);
          renderFeed(document.getElementById("decisionFeed"), snap.decisions || [], true);
          renderFeed(document.getElementById("changeFeed"), snap.changes || [], false);
          renderFeed(document.getElementById("eventFeed"), snap.events || [], false);
          document.getElementById("livePill").classList.remove("off");
        } catch (err) {
          document.getElementById("livePill").classList.add("off");
          if (/oturum|şifre|401|gerekli/i.test(String(err.message || ""))) {
            stop();
            token = "";
            sessionStorage.removeItem(TOKEN_KEY);
            showOps(false);
            loginNote.textContent = "Oturum sona erdi. Tekrar giriş yapın.";
          }
        }
      }

      function start() {
        showOps(true);
        tick();
        if (timer) clearInterval(timer);
        timer = setInterval(tick, 2000);
      }

      function stop() {
        if (timer) clearInterval(timer);
        timer = null;
      }

      loginForm.addEventListener("submit", async function (ev) {
        ev.preventDefault();
        loginNote.textContent = "Giriş…";
        try {
          const email = String(document.getElementById("loginEmail").value || "").trim();
          const password = document.getElementById("password").value;
          const body = { password: password };
          if (email) body.email = email;
          const data = await api("/api/admin/login", {
            method: "POST",
            body: JSON.stringify(body),
          });
          token = data.token;
          sessionStorage.setItem(TOKEN_KEY, token);
          loginNote.textContent = "";
          start();
        } catch (err) {
          loginNote.textContent = err.message || "Giriş başarısız";
        }
      });

      document.getElementById("logoutBtn").addEventListener("click", function () {
        stop();
        token = "";
        sessionStorage.removeItem(TOKEN_KEY);
        showOps(false);
      });

      window.addEventListener("resize", function () {
        if (!opsView.hidden) tick();
      });

      if (token) start();
    })();

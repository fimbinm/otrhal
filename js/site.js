/* Společné skripty: menu, lišta se zavřenými dny, odesílání formulářů. */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

window.ORTOHAL = (function () {
  const btn = document.querySelector(".menu-btn");
  const nav = document.getElementById("nav");
  if (btn && nav) {
    btn.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      btn.setAttribute("aria-expanded", open);
    });
    nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => {
      nav.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }));
  }
  document.querySelectorAll(".year").forEach((y) => (y.textContent = new Date().getFullYear()));

  async function api(path, data) {
    const r = await fetch(path, data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Spojení se nepodařilo. Zkuste to prosím znovu.");
    return j;
  }

  const fmtDay = (d) => new Date(d + "T12:00:00").toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "numeric" });

  // aktuality z administrace – lišta nahoře na hlavní stránce (bez aktualit se neukáže)
  const dm = (d) => { const x = new Date(d + "T12:00:00"); return `${x.getDate()}. ${x.getMonth() + 1}.`; };
  const range = (n) => (n.from === n.to ? fmtDay(n.from) : `${dm(n.from)} – ${dm(n.to)}`);
  const notices = api("/api/booking?a=notices").then((j) => j.notices || []).catch(() => []);
  notices.then((list) => {
    const bar = document.getElementById("notice");
    if (!bar || !list.length) return;
    bar.querySelector(".wrap").innerHTML = list.slice(0, 4).map((n) =>
      `<p class="${n.closed ? "closed" : ""}"><span class="when">${escapeHtml(range(n))}</span><strong>${escapeHtml(n.text)}</strong></p>`).join("");
    bar.hidden = false;
  });

  // dny, kdy se neordinuje (pro kartu „Dnes“)
  const closures = notices.then((list) => {
    const out = [];
    list.filter((n) => n.closed).forEach((n) => {
      for (let d = n.from, i = 0; d <= n.to && i < 400; i++) {
        out.push({ date: d, note: n.text });
        const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10);
      }
    });
    return out;
  });

  // odeslání formuláře na /api/form
  function form(id, action, msgId, okText) {
    const f = document.getElementById(id);
    if (!f) return;
    const msg = document.getElementById(msgId);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.hidden = true;
      if (!f.checkValidity()) {
        const bad = f.querySelector(":invalid");
        msg.className = "msg err";
        msg.textContent = bad && bad.type === "checkbox" ? "Potvrďte prosím souhlas se zpracováním údajů." : "Vyplňte prosím povinná pole.";
        msg.hidden = false;
        bad && bad.focus();
        return;
      }
      const data = Object.fromEntries(new FormData(f));
      data.consent = f.consent.checked;
      const b = f.querySelector('button[type="submit"]');
      const label = b.textContent;
      b.disabled = true;
      b.textContent = "Odesílám…";
      try {
        await api(`/api/form?a=${action}`, data);
        f.reset();
        msg.className = "msg ok";
        msg.textContent = okText;
      } catch (err) {
        msg.className = "msg err";
        msg.textContent = err.message;
      } finally {
        msg.hidden = false;
        b.disabled = false;
        b.textContent = label;
        msg.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  }

  return { api, closures, form, fmtDay };
})();

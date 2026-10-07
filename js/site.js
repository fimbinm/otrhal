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

  // dny, kdy se neordinuje (zadává ordinace v administraci)
  const closures = api("/api/booking?a=closed").then((j) => j.closed || []).catch(() => []);
  closures.then((list) => {
    const bar = document.getElementById("notice");
    if (!bar || !list.length) return;
    const soon = list.slice(0, 8).map((c) => fmtDay(c.date) + (c.note ? ` (${escapeHtml(c.note)})` : "")).join(", ");
    bar.querySelector(".wrap").innerHTML = `<strong>Neordinujeme:</strong> ${soon}`;
    bar.hidden = false;
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

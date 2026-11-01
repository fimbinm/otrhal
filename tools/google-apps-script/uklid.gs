// Úklid účtu rezervace.ortohal@gmail.com: maily z webu a události v kalendáři
// starší než 60 dní se přesunou do koše (Google je z koše smaže po dalších 30 dnech).
// Běží v Google Apps Script v tomto účtu. Jednou spusťte zapnout(); vypnout() úklid zastaví.

const DNY = 60;
const ODESILATELE = ["onboarding@resend.dev", "rezervace@ortopediekrnov.cz"];

function hranice_(dny) {
  return new Date(Date.now() - dny * 86400000);
}

function stareMaily_(dny) {
  const dotaz = `from:(${ODESILATELE.join(" OR ")})` + (dny ? ` older_than:${dny}d` : "");
  const limit = hranice_(dny);
  // vlákno musí být celé starší než hranice, novější odpověď ho ochrání
  return GmailApp.search(dotaz, 0, 100).filter((v) => v.getLastMessageDate() < limit);
}

function stareUdalosti_(dny) {
  const konec = hranice_(dny);
  const zacatek = new Date(konec.getTime() - 400 * 86400000);
  return CalendarApp.getDefaultCalendar().getEvents(zacatek, konec)
    .filter((u) => !u.isRecurringEvent() && u.getEndTime() < konec);
}

// Každodenní úklid (spouští ho časovač)
function uklid() {
  let maily = 0;
  for (let i = 0; i < 20; i++) { // nejvýš 2000 vláken za běh
    const vlakna = stareMaily_(DNY);
    if (!vlakna.length) break;
    GmailApp.moveThreadsToTrash(vlakna);
    maily += vlakna.length;
  }
  const udalosti = stareUdalosti_(DNY);
  udalosti.forEach((u) => u.deleteEvent());
  console.log(`Do koše: ${maily} vláken, ${udalosti.length} událostí.`);
}

// Jen vypíše počty, nic nemaže. dny = 0 ukáže všechno, co by úklid časem zpracoval.
function zkouska() {
  const log = (dny) => console.log(
    `Starší než ${dny} dní: ${stareMaily_(dny).length} vláken, ${stareUdalosti_(dny).length} událostí.`);
  log(DNY);
  log(0);
}

// Zapne každodenní úklid kolem 3. hodiny ráno
function zapnout() {
  vypnout();
  ScriptApp.newTrigger("uklid").timeBased().everyDays(1).atHour(3).inTimezone("Europe/Prague").create();
  console.log("Úklid je zapnutý.");
}

function vypnout() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "uklid")
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

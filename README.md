# ORTOHAL Krnov – web ortopedické ambulance

Statický web (HTML/CSS/JS bez build kroku) + serverové funkce na Vercelu (`api/`).
Rezervace se ukládají do Upstash Redis, e-maily odesílá Resend.

## Jak funguje objednávání

- Online se dá objednat jen do bloků „pouze objednaní“: **Po 16:00–18:00** (MUDr. Halíř) a **Út 12:30–15:30** (MUDr. Kocián), po 10 minutách, nejvýš 6 týdnů dopředu a nejpozději hodinu před termínem. Hodiny se mění v `api/_lib/schedule.js` (a tabulka na webu v `index.html`).
- Jeden čas nejde zabrat dvakrát (atomické `SADD`), jeden telefon = jedna rezervace na den.
- **Ordinace** dostane ke každé rezervaci e-mail (jen jméno, telefon a čas, ostatní je v administraci) s pozvánkou do kalendáře (`.ics`, METHOD:REQUEST) – Gmail / Google Kalendář ji sám zapíše; při zrušení přijde METHOD:CANCEL a událost zmizí.
- Navíc je v administraci adresa kalendáře k odběru (Google Kalendář → Další kalendáře → Z adresy URL).
- **Pacient** dostane potvrzení s `.ics` a odkazem na zrušení (`/zruseni?id=…`).
- **Administrace** `/admin` (heslo): přehled po dnech, ruční zápis telefonických objednávek, zrušení, **aktuality** (text + od–do, volitelně „neordinuje se“ = zablokuje objednávání; zobrazí se jako lišta nahoře na hlavní stránce) a **blokování jednotlivých časů**.
- **Google Kalendář → web:** web čte kalendář ordinace přes tajnou adresu iCal (`GCAL_ICS_URL`, `api/_lib/gcal.js`). Každá událost v něm zabere dané časy (událost do 15 minut jen termín, ve kterém začíná; celodenní celý den; událost označená „Volno“ nic). Zpoždění dává Google + 30 s mezipaměť webu. Opakování: denní a týdenní. Smazání události pacienta z webu rezervaci neruší.
- Osobní údaje z rezervací se samy smažou 60 dní po termínu.

## Proměnné prostředí (Vercel → Settings → Environment Variables)

| Proměnná | Význam |
|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis (doplní se samy po připojení databáze přes Vercel Storage) |
| `RESEND_API_KEY` | klíč z resend.com |
| `MAIL_FROM` | odesílatel, např. `ORTOHAL Krnov <rezervace@ortopediekrnov.cz>` (doména musí být ověřená v Resendu) |
| `CLINIC_EMAIL` | e-mail ordinace, kam chodí rezervace, eRecepty a zprávy |
| `GCAL_ICS_URL` | tajná adresa iCal kalendáře ordinace (Nastavení kalendáře → Integrovat kalendář) |
| `ADMIN_PASSWORD` | heslo do `/admin` |
| `SESSION_SECRET` | dlouhý náhodný řetězec (podpisy přihlášení a odkazu na kalendář) |
| `SITE_URL` | `https://www.ortopediekrnov.cz` (odkazy v e-mailech) |

Náhledová nasazení (preview) používají v databázi vlastní prostor `pv:`, takže testy nezasahují do ostrých rezervací.

## Úpravy

- Podstránky `erecept`, `zruseni`, `ochrana-osobnich-udaju`, `404` se generují ze zdrojů v `tools/pages/` se společnou hlavičkou a patičkou z `index.html`: `python3 tools/pages.py`.

# Products & Bundles

Admin → **Products & Bundles** (`/admin/catalog`). Is page se apne saare software ek jagah rakho, kisi bhi combination ka bundle banao, aur client ko do.

## 1. Software (catalog)
- Built-in, jo pehle se list mein aate hain:
  - **Loopdesk AI khud hub hai** (login, inbox, billing, WhatsApp number). Yeh har bundle ke saath aata hai, catalog mein product nahi hai.
  - **Regulars (Auto-connect, Nov 2026):** ab baaki tools jaisa ek optional tool hai. Sirf un bundles mein jahan Regulars tick hai: client ka Regulars account apne aap banta hai aur home page ke "Open Regulars ↗" se ek click mein khulta hai. Server pe `REGULARS_API_URL`, `REGULARS_APP_URL`, `HUB_SECRET_REGULARS` chahiye (Regulars server pe wahi secret `HUB_SECRET` mein).
  - **WayneRing, Jobs (CRM), GMB Manager, AI Video Studio (Auto-connect):** client ka account apne aap banta hai, aur client ek login se in sab mein jaata hai.
- **Loyvexa** ab **Auto-connect** hai (Nov 2026): bundle dete hi Loyvexa mein client ka brand aur pehla admin (owner ka email) apne aap banta hai, bundle lapse hone pe brand pause hota hai, aur client home page ke "Open Loyvexa ↗" se ek click mein brand console kholta hai. Iske liye server pe `LOYVEXA_API_URL`, `LOYVEXA_APP_URL` aur `HUB_SECRET_LOYVEXA` set hone chahiye (Loyvexa server pe wahi secret `HUB_SECRET` mein).
- **Loyvexa ka WhatsApp Regulars se** (bundle rule 4, Nov 2026): ek client = ek WhatsApp number, jo Regulars Settings mein hai (apna number, warna shared Loopdesk number). Loyvexa ka bot, OTP, scheme messages aur campaigns `POST /api/hub/tools/loyvexa/whatsapp/send` se isi number se jaate hain. Jin dealers/mechanics ko Loyvexa ne likha hai (`HubWaContact`), unke jawab Regulars inbox mein nahi aate, seedha Loyvexa ke bot ko jaate hain. Loyvexa ke templates Meta mein `loyvexa_<event>` naam se approve karne hain (jaise `loyvexa_otp`, `loyvexa_ai_slab`). Contract: `lib/hub/tool-whatsapp.ts`. Provision ab `tools` bhi bhejta hai, taaki Loyvexa AI calls sirf WayneRing wale package mein dikhaye.
- **Korvo** abhi bhi **Manual** hai.
- **+ Add software** se koi bhi naya software jodo. Har naya software Manual se shuru hota hai.
- Software ka naam, description, link aur price edit kar sakte ho. "Switch off" karne se wo naye bundles mein nahi dikhta. Jo bundles use pehle se use kar rahe hain, unke clients ke liye wo pause ho jaata hai.

## 2. Bundles
- **+ New bundle**: naam do, software pe tick lagao (Regulars bhi ab optional hai), price daalo (₹ / C$), billing monthly ya yearly chuno, aur zaroorat ho to Growth Manager ON karo.
- Bundle edit karte hi uske **saare clients** pe change lag jaata hai:
  - naya connected software apne aap set up ho jaata hai
  - hataya gaya software pause hota hai, delete nahi hota
- Built-in plans (Answer, Answer + Return, Grow) bhi list mein dikhte hain. Website pe online payment waise hi chalti rahegi.

## 3. Client ko dena
- Section 3 mein: client chuno → bundle chuno → days daalo → paid amount daalo (khaali chhodo to free pilot) → **Activate**.
- Admin → Bundles mein bhi yahi kar sakte ho. Wahan har client ke Manual software ka status dikhta hai, aur **Mark ready** dabake client ka link save kar sakte ho.
- Client ke home page pe:
  - Auto-connect software ka tile ek click mein khulta hai.
  - Manual software ka tile "Setting up" dikhata hai jab tak team Ready mark nahi karti. Uske baad "Open ↗" aa jaata hai.
- Custom bundle ki payment abhi manual hai, yaani Activate karte waqt "Paid" amount daalna. Client ke Billing page pe likha aata hai ki "billed by Wayne E Solutions".

## Kisi software ko "Auto-connect" banana (ek baar ka code)
Us software mein wahi do endpoints banane hain jo GMB aur CRM mein bane hain (dekho `lib/hub/provision.ts`):
1. `POST /api/hub/provision`: hub ka JWT (purpose `provision`) aata hai. Body mein `{ hubBusinessId, active, business{name, sector, country, timezone}, owner{name, email} }` hota hai. Jawab `{ accountId, status }` dena hai. Ek hi `hubBusinessId` pe har baar wahi account lautna chahiye.
2. `POST /api/hub/sso/exchange`: ek-baar wala token leke apna session de, taaki owner bina password ke andar aa jaaye.

Phir Regulars mein:
- `lib/hub/plans.ts` mein `TOOLS` / `TOOL_META` mein naya tool jodo, saath mein env: `<TOOL>_API_URL`, `<TOOL>_APP_URL`, `HUB_SECRET_<TOOL>`
- `lib/hub/provision.ts` ke `PATH` mein uska endpoint daalo
- `lib/hub/catalog-rules.ts` ke `BUILT_IN_PRODUCTS` mein us product ko `connect: "AUTO", hubTool: "<TOOL>"` kar do

Har software ke liye ye 2-3 din ka kaam hai.

## Customer plan khud chunta hai, activate hum karte hain (Nov 2026)
- Signup (`/signup`) aur Billing page pe built-in plans ke saath woh saare bundles dikhte hain jin pe **"Show to customers"** tick hai (jaise Korvo + Loyvexa). Bundle banate/edit karte waqt yeh checkbox hai.
- Online payment band hai (`NEXT_PUBLIC_ONLINE_PAYMENTS` false). Customer plan chunta hai → request save hoti hai → **Admin → Bundles** mein woh client sabse upar "Asked for …" ke saath dikhta hai, plan pehle se select hota hai → days + paid amount daalo → **Activate**.
- Website ka "Start free trial" ab seedha app ka `/signup` kholta hai (ek hi signup).
- **Admin → Clients** mein har client ke liye WhatsApp aur SMS messages per month haath se daal sakte ho. Khaali = no limit. Haath se daali limit plan change pe nahi badalti.

## Regulars ab tool hai, hub nahi (Nov 2026)
- Loopdesk AI hub hai. Regulars (regulars.wayneesolutions.com) Korvo/Loyvexa jaisa tool hai: alag app, alag database.
- Step 1 (ab): jin bundles mein Regulars tick **nahi** hai, unke clients ko Loopdesk mein Customers, Offers, Counter, Report, Reviews, Outlets, QR codes aur Calling scripts pages nahi dikhte (`REGULARS_PAGES` in `lib/hub/catalog-rules.ts`). Inbox, Growth Manager, Team, Billing aur Settings (WhatsApp number) sabke liye rehte hain. Built-in plans (Answer, Answer + Return, Grow) pehle jaise hi.
- Jin bundles mein Regulars tick hai, unke clients ko yeh pages Loopdesk mein bhi dikhte hain aur "Open Regulars ↗" bhi. Step 2 mein Restaurant Bundle aur Growth wale features Regulars app mein jaayenge aur Loopdesk se yeh pages hatenge.
- Contract: Regulars mein `POST /api/hub/provision` aur `/sso` → `POST /api/hub/sso/exchange` (repo arpanwayne/regularsplatform).

## Sehat Saathi (hospital package, Nov 2026)

Hospitals and clinics: WhatsApp patient follow-up in Hindi, Punjabi and English (prescriptions explained, check-ins, urgent flags to the right doctor). Product key `sehat-saathi`, connect AUTO, tool `SEHAT_SAATHI`.

- Set-up: like Loyvexa. Put Sehat Saathi in a custom bundle; the hospital and its first admin (the owner) are created by `POST {SEHAT_SAATHI_API_URL}/api/hub/provision`, paused when the bundle lapses.
- Open: "Open Sehat Saathi ↗" and "Urgent flags ↗" on the home screen, and in the tool switcher.
- WhatsApp: the hospital's number. A stranger writing to a hospital is treated as a new patient and goes to Sehat Saathi (QR / bed code enrolment); known Regulars customers stay in the inbox. Whole messages are forwarded (photos, voice notes); Sehat Saathi downloads media through `GET /api/hub/tools/sehat-saathi/whatsapp/media/:id`. Give hospitals their own number: on the shared number a stranger can't be matched to a business.
- Calls: only with WayneRing in the same bundle (Sehat Saathi calls through WayneRing).
- Templates: `sehat_*` in en / hi / pa (lib/hub/tool-templates.ts), submitted with the others from Admin → WhatsApp templates.
- Env: `HUB_SECRET_SEHAT_SAATHI` (= `HUB_SECRET` on Sehat Saathi), `SEHAT_SAATHI_API_URL` (backend), `SEHAT_SAATHI_APP_URL` (dashboard).

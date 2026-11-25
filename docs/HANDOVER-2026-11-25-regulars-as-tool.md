# Handover: Loopdesk AI hub, Regulars ab ek tool (25 Nov 2026)

## Summary
Pehle Loopdesk mein Regulars "hub" tha: har bundle mein zabardasti shaamil, aur Regulars ke pages (Customers, Offers…) har client ko dikhte the. Ab **Loopdesk AI hub hai** aur **Regulars Korvo/Loyvexa jaisa optional tool** hai, apne server (regulars.wayneesolutions.com) pe.

Yeh **step 1** hai:

| | Pehle | Ab |
|---|---|---|
| Regulars bundle mein | Har bundle mein, untick nahi hota tha | Tick karo toh hai, warna nahi |
| Regulars account | Loopdesk ke andar ki copy | Bundle mein Regulars ho toh Regulars app mein account apne aap banta hai, "Open Regulars ↗" se ek click mein login |
| Customers, Offers, Counter, Report, Reviews, Outlets, QR codes, Calling scripts | Sabko dikhte the | Sirf un clients ko jinke bundle mein Regulars hai (built-in plans Answer / Answer + Return / Grow pehle jaise) |
| Inbox, Growth Manager, Team, Billing, Settings (WhatsApp number) | Sabko | Sabko (yeh Loopdesk ke apne hain; Loyvexa bhi isi WhatsApp number se bhejta hai) |

**Step 2 (baad mein):** Restaurant Bundle (counter, points, outlets, reviews, report) aur Growth wale features Regulars app mein le jaana, phir Loopdesk se yeh copy hatana. Tab tak jinke bundle mein Regulars hai unhe yeh pages Loopdesk mein bhi dikhenge aur "Open Regulars ↗" bhi.

PRs: Loopdesk (santwayne/loopdeskai-software) + Regulars (arpanwayne/regularsplatform).

## Kaun kya karega

| Kaam | Kaun |
|---|---|
| Dono servers pe deploy (neeche wale order mein) | Arpan |
| `HUB_SECRET` / `HUB_SECRET_REGULARS` aur URLs set karna | Arpan |
| Har bundle check karna: jahan Regulars nahi chahiye wahan untick | Noor |
| Testing checklist | Arpan + Noor |

## Deploy steps (Arpan) — order zaroori hai

Har server pe pehle database ka backup.

1. **Regulars** (naye columns + naya table, isliye `db push`):
   ```
   cd <regulars app folder>
   git pull origin main
   npm ci && npx prisma db push && npm run build
   pm2 restart <regulars app name>
   ```
   `.env` mein `HUB_SECRET` daalo (32+ characters, `openssl rand -hex 32`).

2. **Loopdesk**, abhi `REGULARS_*` env **mat** daalo:
   ```
   cd <loopdesk app folder>
   git pull origin main
   npm ci && npx prisma db push && npm run build
   pm2 restart <loopdesk app name>
   ```

3. **Noor:** Admin → **Products & Bundles** kholo. Page khulte hi Regulars "Auto-connect" ban jaata hai (pehle "Hub" tha). Ab har bundle edit karo: jis bundle mein Regulars nahi chahiye (jaise Korvo + Loyvexa dealer pack), Regulars ka tick hatao aur Save.
   - Purane saare bundles mein Regulars tick rahega, kyunki pehle zabardasti tha. Isliye yeh step env daalne se **pehle**, warna un sab clients ke Regulars accounts ban jaayenge.

4. **Arpan:** ab Loopdesk `.env` mein daalo aur restart:
   ```
   HUB_SECRET_REGULARS=<Regulars wala HUB_SECRET, same value>
   REGULARS_API_URL=https://regulars.wayneesolutions.com
   REGULARS_APP_URL=https://regulars.wayneesolutions.com
   ```

5. **Noor:** Admin → Bundles mein Regulars wale clients pe "re-run set-up" dabao, taaki unke Regulars accounts ban jaayein.

## Regulars account kaise banta hai
- Owner ke email se: naya email → naya owner + business. Jo owner pehle se Regulars use karta hai → **wahi business link ho jaata hai**, customers safe.
- Manager/admin email, ya owner jo pehle se kisi aur Loopdesk client se linked hai → set-up "Failed" dikhega (Admin → Bundles), error mein reason. Wayne ko batao.
- Naye owner ka password random hai; woh Loopdesk se "Open Regulars ↗" se aata hai, ya Regulars pe "Forgot password" se apna bana sakta hai.
- Loopdesk client Regulars mein PRO pe hota hai, koi expiry nahi; Regulars ka Billing page bolta hai ki bill Loopdesk mein hai, aur Regulars checkout unhe mana karta hai.
- Bundle lapse ya Regulars untick → Regulars mein business pause (suspended). Wapas on → resume. Super admin ka suspension Loopdesk kabhi nahi hatata.

## Testing checklist (deploy ke baad)
Code ke tests pass hain (Loopdesk 8 naye, Regulars 8 naye), par browser mein abhi kisi ne nahi dekha.

- [ ] Products & Bundles: Regulars "Auto-connect" dikhe, aur bundle mein uska tick hat sake
- [ ] Test bundle **bina Regulars** (sirf Korvo/Loyvexa): client ke menu mein Customers, Offers, Counter, QR codes na hon; Inbox, Billing, Settings hon
- [ ] Usi client se seedha `/dashboard/offers` kholo: home pe aa jaaye, message "…Regulars, which isn't part of your plan"
- [ ] Test bundle **Regulars ke saath**: home pe "Regulars" tile "Ready" ho, "Open Regulars ↗" se bina password Regulars dashboard khule
- [ ] "Offers ↗" se seedha Regulars ke Offers page pe pahunche
- [ ] Regulars pe us business ka Billing page "part of your Loopdesk AI plan" dikhaye
- [ ] Ek purane Regulars owner ke email se Loopdesk client banao: Regulars mein unke purane customers dikhein (naya khaali business nahi)
- [ ] Bundle se Regulars untick karo: Regulars tile hate, Regulars mein business paused; dobara tick: wapas chale
- [ ] Built-in plan (Answer/Grow) wala client: sab pages pehle jaise

## Dhyan rakhne wali baatein
- Jab tak step 2 nahi hota, Regulars wale bundle ke clients ka customer data do jagah ho sakta hai (Loopdesk ki copy aur Regulars app). Naye clients ko Regulars app use karne bolo.
- Built-in plans (Answer, Answer + Return, Grow) ko alag Regulars account nahi milta; unke pages pehle jaise Loopdesk mein hain.
- Regulars ke pages URL se band hain, par unke API routes abhi band nahi kiye (step 2 mein).
- Secret galat ya missing ho toh Regulars set-up "Failed"/"Setting up" pe atka rahega; Admin → Bundles mein error padho.

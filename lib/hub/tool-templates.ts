import type { MetaTemplatePayload } from "@/lib/whatsapp-templates";
import { lintBody, sanitizeParam } from "@/lib/whatsapp-templates";

/**
 * WhatsApp templates that tools send through the hub from the business's
 * number (Nov 2026). They live in the same Meta account as Regulars' own
 * templates, so /admin/whatsapp-templates and `npm run wa:templates` submit
 * them too. Names are prefixed per tool (sehat_…) so they never clash with
 * Regulars' (loopdesk_…) or Loyvexa's (loyvexa_…).
 *
 * Sehat Saathi sends { name: "sehat_<event>", language: en | hi | pa }.
 * Loyvexa sends { name: "loyvexa_<event>", language } and reads the approved
 * language from GET /api/hub/tools/loyvexa/whatsapp/templates (bug report
 * 27 Nov 2026 #4: these were never defined here, so Meta answered #132001
 * "Template name does not exist in the translation" for every welcome).
 * Loyvexa parameters match src/services/notifications.js and ai/messaging.js
 * in santwayne/loyvexa. en = English, hi = Roman Hinglish (as Loyvexa's bot).
 * Parameters match backend/src/services/* in santwayne/sehat-saathi.
 */
type ToolLang = "en" | "hi" | "pa";
type ToolDef = { name: string; tool: string; category: "UTILITY"; bodies: Partial<Record<ToolLang, string>>; examples: string[] };

export const TOOL_TEMPLATE_DEFS: ToolDef[] = [
  {
    name: "sehat_patient_welcome", tool: "SEHAT_SAATHI", category: "UTILITY", examples: ["Mandeep", "Soni Dental Hospital"],
    bodies: {
      en: "Namaste {{1}}, welcome to Sehat Saathi from {{2}}. We will explain your prescription in simple words and check in with you on WhatsApp. Reply STOP anytime to stop these messages.",
      hi: "नमस्ते {{1}}, {{2}} की ओर से सेहत साथी में आपका स्वागत है। हम आपका पर्चा आसान शब्दों में समझाएंगे और WhatsApp पर आपका हाल पूछेंगे। ये संदेश बंद करने के लिए कभी भी STOP लिखें।",
      pa: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ {{1}}, {{2}} ਵੱਲੋਂ ਸਿਹਤ ਸਾਥੀ ਵਿੱਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ। ਅਸੀਂ ਤੁਹਾਡੀ ਪਰਚੀ ਸੌਖੇ ਸ਼ਬਦਾਂ ਵਿੱਚ ਸਮਝਾਵਾਂਗੇ ਅਤੇ WhatsApp ਤੇ ਤੁਹਾਡਾ ਹਾਲ ਪੁੱਛਾਂਗੇ। ਇਹ ਸੁਨੇਹੇ ਬੰਦ ਕਰਨ ਲਈ ਕਦੇ ਵੀ STOP ਲਿਖੋ।",
    },
  },
  {
    name: "sehat_patient_checkin", tool: "SEHAT_SAATHI", category: "UTILITY", examples: ["Mandeep"],
    bodies: {
      en: "Hello {{1}}, did you take today's medicine as your doctor prescribed? Please reply YES or NO.",
      hi: "नमस्ते {{1}}, क्या आपने आज की दवा डॉक्टर के बताए अनुसार ली? कृपया हाँ या नहीं लिखें।",
      pa: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ {{1}}, ਕੀ ਤੁਸੀਂ ਅੱਜ ਦੀ ਦਵਾਈ ਡਾਕਟਰ ਦੇ ਦੱਸੇ ਮੁਤਾਬਕ ਲਈ? ਕਿਰਪਾ ਕਰਕੇ ਹਾਂ ਜਾਂ ਨਹੀਂ ਲਿਖੋ।",
    },
  },
  {
    name: "sehat_family_invite", tool: "SEHAT_SAATHI", category: "UTILITY", examples: ["Harpreet", "Mandeep", "Soni Dental Hospital"],
    bodies: {
      en: "Hello {{1}}, {{3}} would like to add you to {{2}}'s care updates on WhatsApp. Reply YES to receive updates.",
      hi: "नमस्ते {{1}}, {{3}} आपको {{2}} की देखभाल के अपडेट WhatsApp पर भेजना चाहता है। अपडेट पाने के लिए YES लिखें।",
      pa: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ {{1}}, {{3}} ਤੁਹਾਨੂੰ {{2}} ਦੀ ਦੇਖਭਾਲ ਦੇ ਅਪਡੇਟ WhatsApp ਤੇ ਭੇਜਣਾ ਚਾਹੁੰਦਾ ਹੈ। ਅਪਡੇਟ ਲੈਣ ਲਈ YES ਲਿਖੋ।",
    },
  },
  {
    name: "sehat_family_weekly_digest", tool: "SEHAT_SAATHI", category: "UTILITY", examples: ["Harpreet", "Mandeep", "6 of 7 doses taken, next visit 2 Dec"],
    bodies: {
      en: "Hello {{1}}, this week's care update for {{2}}: {{3}}. Reply here if you have a question.",
      hi: "नमस्ते {{1}}, {{2}} की इस हफ्ते की जानकारी: {{3}}। कोई सवाल हो तो यहीं लिखें।",
      pa: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ {{1}}, {{2}} ਦੀ ਇਸ ਹਫ਼ਤੇ ਦੀ ਜਾਣਕਾਰੀ: {{3}}। ਕੋਈ ਸਵਾਲ ਹੋਵੇ ਤਾਂ ਇੱਥੇ ਲਿਖੋ।",
    },
  },
  {
    name: "sehat_refill_reminder", tool: "SEHAT_SAATHI", category: "UTILITY", examples: ["Mandeep", "Metformin 500", "City Pharmacy, Model Town"],
    bodies: {
      en: "Hello {{1}}, your medicine {{2}} will run out in a few days. Pharmacy: {{3}}. Please reorder in time.",
      hi: "नमस्ते {{1}}, आपकी दवा {{2}} कुछ दिनों में खत्म हो जाएगी। फार्मेसी: {{3}}। कृपया समय पर दोबारा मंगवा लें।",
      pa: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ {{1}}, ਤੁਹਾਡੀ ਦਵਾਈ {{2}} ਕੁਝ ਦਿਨਾਂ ਵਿੱਚ ਖਤਮ ਹੋ ਜਾਵੇਗੀ। ਫਾਰਮੇਸੀ: {{3}}। ਕਿਰਪਾ ਕਰਕੇ ਸਮੇਂ ਸਿਰ ਦੁਬਾਰਾ ਮੰਗਵਾ ਲਓ।",
    },
  },
  // ── Loyvexa (dealer / mechanic loyalty) ──
  {
    name: "loyvexa_participant_created", tool: "LOYVEXA", category: "UTILITY", examples: ["Gill Auto Store", "Shree Ganesh Parts"],
    bodies: {
      en: "Hello {{1}}, welcome to {{2}} Rewards! You earn points on every purchase and every product scan. Reply MENU here to see your points.",
      hi: "Namaste {{1}}, {{2}} Rewards mein aapka swagat hai! Har purchase aur har scan pe points milenge. Points dekhne ke liye yahan MENU likho.",
    },
  },
  {
    name: "loyvexa_redemption_paid", tool: "LOYVEXA", category: "UTILITY", examples: ["Raju", "₹500", "raju@upi"],
    bodies: {
      en: "Hello {{1}}, {{2}} has been sent to your UPI ID {{3}}. Thank you for being with us.",
      hi: "Namaste {{1}}, {{2}} aapke UPI {{3}} pe bhej diye gaye hain. Dhanyavaad.",
    },
  },
  {
    name: "loyvexa_redemption_failed", tool: "LOYVEXA", category: "UTILITY", examples: ["Raju", "UPI ID not found"],
    bodies: {
      en: "Hello {{1}}, your payout could not be completed ({{2}}). Your points are back in your wallet. Please check your UPI ID and try again.",
      hi: "Namaste {{1}}, aapka payment nahi ho paya ({{2}}). Points wapas wallet mein aa gaye hain. UPI ID check karke dobara try karo.",
    },
  },
  {
    name: "loyvexa_redemption_rejected", tool: "LOYVEXA", category: "UTILITY", examples: ["Raju", "1200", "duplicate request"],
    bodies: {
      en: "Hello {{1}}, your payout request was not approved and your {{2}} points are back in your wallet. Reason: {{3}}. Reply here for help.",
      hi: "Namaste {{1}}, aapki payout request approve nahi hui aur aapke {{2}} points wapas wallet mein aa gaye. Wajah: {{3}}. Madad ke liye yahan likho.",
    },
  },
  {
    name: "loyvexa_scheme_bonus", tool: "LOYVEXA", category: "UTILITY", examples: ["Gill Auto Store", "500", "Diwali Dhamaka"],
    bodies: {
      en: "Congratulations {{1}}! You have received {{2}} bonus points in the {{3}} scheme. Reply MENU to see your balance.",
      hi: "Badhai ho {{1}}! Aapko {{2}} bonus points mile {{3}} scheme mein. Balance dekhne ke liye MENU likho.",
    },
  },
  {
    name: "loyvexa_purchase_recorded", tool: "LOYVEXA", category: "UTILITY", examples: ["Gill Auto Store", "₹25,000", "250"],
    bodies: {
      en: "Hello {{1}}, your purchase of {{2}} has been recorded and {{3}} points were updated in your wallet. Reply MENU to see your balance.",
      hi: "Namaste {{1}}, aapki {{2}} ki purchase record ho gayi aur {{3}} points wallet mein update hue. Balance ke liye MENU likho.",
    },
  },
  {
    name: "loyvexa_order_sent", tool: "LOYVEXA", category: "UTILITY", examples: ["ORD-1042", "SO-778", "₹18,400"],
    bodies: {
      en: "Your order {{1}} has reached the company (ref {{2}}), total {{3}}. It will be dispatched after approval.",
      hi: "Aapka order {{1}} company tak pahunch gaya (ref {{2}}), total {{3}}. Approval ke baad dispatch hoga.",
    },
  },
  {
    name: "loyvexa_order_failed", tool: "LOYVEXA", category: "UTILITY", examples: ["ORD-1042"],
    bodies: {
      en: "Your order {{1}} could not reach the company. Our team will contact you shortly.",
      hi: "Aapka order {{1}} company tak nahi pahuncha. Hamari team aapse jaldi sampark karegi.",
    },
  },
  {
    name: "loyvexa_points_expiring", tool: "LOYVEXA", category: "UTILITY", examples: ["Raju", "1,500", "7"],
    bodies: {
      en: "Hello {{1}}, {{2}} of your points will expire in the next {{3}} days. Redeem them to UPI from the app before they expire.",
      hi: "Namaste {{1}}, aapke {{2}} points agle {{3}} din mein expire ho jayenge. Expire hone se pehle app se UPI mein nikaal lo.",
    },
  },
  {
    name: "loyvexa_points_expired", tool: "LOYVEXA", category: "UTILITY", examples: ["Raju", "300"],
    bodies: {
      en: "Hello {{1}}, {{2}} of your older points have expired. Keep scanning to earn more.",
      hi: "Namaste {{1}}, aapke {{2}} purane points expire ho gaye. Aur points ke liye scan karte raho.",
    },
  },
  {
    name: "loyvexa_ai_slab", tool: "LOYVEXA", category: "UTILITY", examples: ["Gill", "Diwali Dhamaka", "₹12,000", "2% bonus", "30 Nov"],
    bodies: {
      en: "Hello {{1}}, you are close to the next slab in {{2}}. Just {{3}} more to get {{4}}. Last date: {{5}}. Reply MENU to see your progress.",
      hi: "Namaste {{1}}, {{2}} mein aap agle slab ke bahut paas ho. Sirf {{3}} aur, aur milega {{4}}. Last date: {{5}}. Progress dekhne ke liye MENU likho.",
    },
  },
  {
    name: "loyvexa_ai_mechanic", tool: "LOYVEXA", category: "UTILITY", examples: ["Raju", "850", "Double points on brake pads till 30 Nov"],
    bodies: {
      en: "Hello {{1}}, you have {{2}} points waiting. Live offer: {{3}}. Scan your next product to keep earning.",
      hi: "Namaste {{1}}, aapke {{2}} points pade hain. Abhi ka offer: {{3}}. Agla product scan karke points kamate raho.",
    },
  },
];

const varCount = (text: string) => new Set(text.match(/\{\{\d+\}\}/g) ?? []).size;

/** Every tool template × language, in the shape Meta's message_templates API takes. */
export function toolMetaTemplates(): Array<MetaTemplatePayload & { key: string; lang: string }> {
  const out: Array<MetaTemplatePayload & { key: string; lang: string }> = [];
  for (const d of TOOL_TEMPLATE_DEFS) {
    for (const lang of Object.keys(d.bodies) as ToolLang[]) {
      const text = d.bodies[lang]!;
      out.push({
        key: `${d.tool.toLowerCase()}:${d.name}`, lang, name: d.name, language: lang, category: d.category,
        components: [{ type: "BODY", text, example: { body_text: [d.examples.slice(0, varCount(text)).map((v) => sanitizeParam(v))] } }],
      });
    }
  }
  return out;
}

/** Problems Meta would reject (empty = fine). */
export function lintToolTemplates(): string[] {
  return toolMetaTemplates().flatMap((t) => lintBody(t.components[0].text, varCount(t.components[0].text)).map((p) => `${t.name} (${t.language}): ${p}`));
}

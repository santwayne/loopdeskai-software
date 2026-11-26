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
 * Parameters match backend/src/services/* in santwayne/sehat-saathi.
 */
type ToolLang = "en" | "hi" | "pa";
type ToolDef = { name: string; tool: string; category: "UTILITY"; bodies: Record<ToolLang, string>; examples: string[] };

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
];

const varCount = (text: string) => new Set(text.match(/\{\{\d+\}\}/g) ?? []).size;

/** Every tool template × language, in the shape Meta's message_templates API takes. */
export function toolMetaTemplates(): Array<MetaTemplatePayload & { key: string; lang: string }> {
  const out: Array<MetaTemplatePayload & { key: string; lang: string }> = [];
  for (const d of TOOL_TEMPLATE_DEFS) {
    for (const lang of Object.keys(d.bodies) as ToolLang[]) {
      const text = d.bodies[lang];
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

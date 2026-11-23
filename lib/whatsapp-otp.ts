import { templatePrefix } from "@/lib/whatsapp-templates";

/**
 * The one AUTHENTICATION template (Restaurant Bundle phase 2): the code a
 * customer reads out at the counter before points or wallet money are used.
 *
 * Meta requires one-time codes to use the AUTHENTICATION category, whose body
 * is fixed by Meta ("<code> is your verification code." + security line +
 * expiry footer) with a Copy code button. So it is not in WA_TEMPLATE_DEFS
 * (those have our own bodies); the template sync submits it from here.
 */

export const OTP_TEMPLATE_BASE = "redeem_otp";
export const OTP_EXPIRY_MINUTES = 10;

export function otpTemplateName() {
  return `${templatePrefix()}_${OTP_TEMPLATE_BASE}`;
}

/** Shape Meta's message_templates API takes for an authentication template. */
export function otpTemplatePayload() {
  return {
    name: otpTemplateName(),
    language: "en",
    category: "AUTHENTICATION",
    components: [
      { type: "BODY", add_security_recommendation: true },
      { type: "FOOTER", code_expiration_minutes: OTP_EXPIRY_MINUTES },
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }] },
    ],
  };
}

/** The message body to send it: the code goes in the body and the copy button. */
export function otpMessage(code: string) {
  return {
    type: "template",
    template: {
      name: otpTemplateName(),
      language: { code: "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
      ],
    },
  };
}

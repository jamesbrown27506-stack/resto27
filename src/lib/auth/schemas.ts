import { z } from "zod";

/**
 * One schema per action, shared by the form and the server (§13).
 *
 * Client-side validation is a courtesy; the server copy is the one that
 * matters. Sharing the schema is what stops the two drifting — the classic
 * failure being a client that accepts a 6-character password because someone
 * relaxed the front-end rule and forgot the back-end.
 *
 * The custom messages are DICTIONARY KEYS (`ecu.v.*`), not sentences: a schema
 * is built once at module load and cannot know who is reading, so the action
 * translates each issue with translateIssueMessage (lib/i18n/issue-message).
 * Anything rendering these messages must go through that, or it shows a key.
 */

/** Matches the checklist shown by <PasswordStrength>. Keep the two in step. */
export const passwordSchema = z
  .string()
  .min(8, "ecu.v.passwordMin")
  .regex(/[A-ZÀ-Þ]/, "ecu.v.passwordUpper")
  .regex(/\d/, "ecu.v.passwordDigit")
  .regex(/[^\w\s]/, "ecu.v.passwordSpecial");

export const emailSchema = z
  .string()
  .trim()
  .min(1, "ecu.v.emailRequired")
  .email("ecu.v.emailInvalid")
  .toLowerCase();

/**
 * Cameroonian mobile numbers: +237 6XX XX XX XX, with spaces tolerated.
 * Stored normalised so a lookup by phone actually matches.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s.-]/g, ""))
  .refine(
    (v) => /^(\+?237)?6\d{8}$/.test(v),
    "ecu.v.phoneInvalid",
  )
  .transform((v) => (v.startsWith("+237") ? v : `+237${v.replace(/^237/, "")}`));

export const signInSchema = z.object({
  email: emailSchema,
  // Deliberately NOT passwordSchema. Validating an existing password against
  // the current policy would lock out anyone whose password predates a policy
  // change — and it leaks the policy to an attacker probing the form.
  password: z.string().min(1, "ecu.v.passwordRequired"),
  remember: z.coerce.boolean().optional(),
});

export const signUpCustomerSchema = z.object({
  name: z.string().trim().min(2, "ecu.v.fullNameRequired").max(120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  terms: z.literal(true, { message: "ecu.v.acceptTerms" }),
});

/**
 * The restaurant application.
 *
 * Cuisine and branch label are deliberately absent. Both were asked at signup
 * and neither belongs there: cuisine is a directory facet the owner will want
 * to change once they see how they are listed, and a branch label is
 * meaningless until there is a second branch to distinguish. Every field left
 * here is one we cannot create the tenant without.
 *
 * `serviceAreaId` is the town, and it is an id rather than free text because
 * currency, timezone and whether we are even open for signups all hang off the
 * service area (see 0003). A typed town would leave the restaurant orphaned
 * from all three.
 */
export const signUpRestaurantSchema = z.object({
  ownerName: z.string().trim().min(2, "ecu.v.ownerNameRequired").max(120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  restaurantName: z.string().trim().min(2, "ecu.v.restaurantNameRequired").max(160),
  description: z.string().trim().max(2000).optional(),
  serviceAreaId: z.string().uuid("ecu.v.cityRequired"),
  quartier: z.string().trim().min(1, "ecu.v.quartierRequired").max(120),
  address: z.string().trim().min(4, "ecu.v.addressRequired").max(300),
  restaurantPhone: phoneSchema,
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

/**
 * The code from the reset email. Supabase's length is a project setting
 * (6 by default, up to 10), so any run of 6–10 digits is accepted and the
 * spaces people type between groups are ignored.
 */
export const resetCodeSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .transform((v) => v.replace(/\s/g, ""))
    .refine((v) => /^\d{6,10}$/.test(v), "ecu.v.resetCode"),
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "ecu.v.passwordMismatch",
    path: ["confirm"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpCustomerInput = z.infer<typeof signUpCustomerSchema>;
export type SignUpRestaurantInput = z.infer<typeof signUpRestaurantSchema>;

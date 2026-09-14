import { z } from "zod";

/**
 * One schema per action, shared by the form and the server (§13).
 *
 * Client-side validation is a courtesy; the server copy is the one that
 * matters. Sharing the schema is what stops the two drifting — the classic
 * failure being a client that accepts a 6-character password because someone
 * relaxed the front-end rule and forgot the back-end.
 */

/** Matches the checklist shown by <PasswordStrength>. Keep the two in step. */
export const passwordSchema = z
  .string()
  .min(8, "8 caractères minimum")
  .regex(/[A-ZÀ-Þ]/, "Une majuscule requise")
  .regex(/\d/, "Un chiffre requis")
  .regex(/[^\w\s]/, "Un caractère spécial requis");

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Adresse email requise")
  .email("Adresse email invalide")
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
    "Numéro camerounais invalide (ex. +237 6 99 12 34 56)",
  )
  .transform((v) => (v.startsWith("+237") ? v : `+237${v.replace(/^237/, "")}`));

export const signInSchema = z.object({
  email: emailSchema,
  // Deliberately NOT passwordSchema. Validating an existing password against
  // the current policy would lock out anyone whose password predates a policy
  // change — and it leaks the policy to an attacker probing the form.
  password: z.string().min(1, "Mot de passe requis"),
  remember: z.coerce.boolean().optional(),
});

export const signUpCustomerSchema = z.object({
  name: z.string().trim().min(2, "Nom complet requis").max(120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  terms: z.literal(true, { message: "Vous devez accepter les conditions" }),
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
  ownerName: z.string().trim().min(2, "Nom du responsable requis").max(120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  restaurantName: z.string().trim().min(2, "Nom du restaurant requis").max(160),
  description: z.string().trim().max(2000).optional(),
  serviceAreaId: z.string().uuid("Ville requise"),
  quartier: z.string().trim().min(1, "Quartier requis").max(120),
  address: z.string().trim().min(4, "Adresse requise").max(300),
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
    .refine((v) => /^\d{6,10}$/.test(v), "Saisissez le code à chiffres reçu par email"),
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Les deux mots de passe ne correspondent pas",
    path: ["confirm"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpCustomerInput = z.infer<typeof signUpCustomerSchema>;
export type SignUpRestaurantInput = z.infer<typeof signUpRestaurantSchema>;

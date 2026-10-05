import { defineDict } from "../define";

/**
 * The customer's own profile (/profile).
 *
 * OWNED BY THIS SCREEN - every string in both languages, or the build fails.
 * Prefix every key with `cpf.` so two modules can never collide.
 */
export const custProfileDict = defineDict({
  fr: {
    "cpf.title": "Profil",
    "cpf.subtitle": "Vos informations personnelles.",

    "cpf.photo": "Photo de profil",
    "cpf.pickImage": "Choisir une image",
    "cpf.photoHint": "JPG ou PNG, 2 Mo maximum. Le format est vérifié à l'envoi.",
    "cpf.photoUpdated": "Photo mise à jour.",
    "cpf.photoFailed": "Impossible de mettre à jour la photo.",

    "cpf.info": "Informations",
    "cpf.name": "Nom complet",
    "cpf.phone": "Téléphone",
    "cpf.phoneHint": "Utilisé par le restaurant pour vous joindre.",
    "cpf.email": "Adresse email",
    "cpf.emailHint": "Changer d'adresse demande une vérification par email.",
    "cpf.saveInfo": "Enregistrer les modifications",
    "cpf.saved": "Profil mis à jour.",

    "cpf.password": "Mot de passe",
    "cpf.passwordBody": "Choisissez un mot de passe que vous n'utilisez nulle part ailleurs.",
    "cpf.currentPassword": "Mot de passe actuel",
    "cpf.newPassword": "Nouveau mot de passe",
    "cpf.confirm": "Confirmer",
    "cpf.mismatch": "Les deux mots de passe ne correspondent pas.",
    "cpf.changePassword": "Modifier le mot de passe",
    "cpf.sessionsNote": "Toutes vos autres sessions seront déconnectées.",
    "cpf.passwordChanged": "Mot de passe modifié. Vos autres sessions ont été déconnectées.",
  },
  en: {
    "cpf.title": "Profile",
    "cpf.subtitle": "Your personal information.",

    "cpf.photo": "Profile photo",
    "cpf.pickImage": "Choose an image",
    "cpf.photoHint": "JPG or PNG, 2 MB maximum. The format is checked on upload.",
    "cpf.photoUpdated": "Photo updated.",
    "cpf.photoFailed": "Could not update the photo.",

    "cpf.info": "Information",
    "cpf.name": "Full name",
    "cpf.phone": "Phone",
    "cpf.phoneHint": "Used by the restaurant to reach you.",
    "cpf.email": "Email address",
    "cpf.emailHint": "Changing it requires verification by email.",
    "cpf.saveInfo": "Save changes",
    "cpf.saved": "Profile updated.",

    "cpf.password": "Password",
    "cpf.passwordBody": "Choose a password you do not use anywhere else.",
    "cpf.currentPassword": "Current password",
    "cpf.newPassword": "New password",
    "cpf.confirm": "Confirm",
    "cpf.mismatch": "The two passwords do not match.",
    "cpf.changePassword": "Change the password",
    "cpf.sessionsNote": "All your other sessions will be signed out.",
    "cpf.passwordChanged": "Password changed. Your other sessions have been signed out.",
  },
});

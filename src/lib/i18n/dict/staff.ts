import { defineDict } from "../define";

/**
 * Staff and invitations (/m/staff).
 *
 * OWNED BY THIS SCREEN. Add every string it needs here, in both languages —
 * `defineDict` fails the build if a French key has no English twin, so there
 * is no way to half-translate a page.
 *
 * Prefix every key with `mst.` so two modules can never collide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE ROLE, STATUS AND CAPABILITY LABELS LIVE HERE, NOT IN lib/capabilities.
 *
 *  That module is imported by the permission checks themselves and by Server
 *  Components, so it has to stay a pure data module with no locale in it —
 *  its BRANCH_ROLE_LABEL is French on purpose, for audit lines and outgoing
 *  email. The screen keys off the RAW `role` / `status` value and looks the
 *  wording up here, which is what lets the language toggle reach it.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const staffDict = defineDict({
  fr: {
    "mst.toBranch": "Autre succursale",
    "mst.toBranch.title": "Ajouter {name} à une autre succursale",
    "mst.toBranch.body": "Cette personne fait déjà partie de votre équipe : elle est ajoutée directement, avec le rôle choisi, sans nouvelle invitation.",
    "mst.toBranch.branch": "Succursale",
    "mst.toBranch.role": "Rôle là-bas",
    "mst.toBranch.submit": "Ajouter",
    "mst.title": "Personnel",
    "mst.subtitle": "Qui travaille ici, et ce que chacun peut faire.",

    /* Header — the roster is per branch, so the branch is named. */
    "mst.teamOf": "Équipe de {name}",
    "mst.branchNotice":
      "Le rôle défini ici ne vaut que pour cette succursale. La même personne peut avoir un rôle différent dans un autre de vos établissements.",

    /* Roster */
    "mst.col.person": "Membre",
    "mst.col.role": "Rôle",
    "mst.col.actions": "Actions",
    "mst.you": "Vous",
    "mst.pendingInvite": "Invitation en attente",
    "mst.invitedOn": "Invité le {date}",
    "mst.memberSince": "Dans l'équipe depuis le {date}",
    "mst.roleOf": "Rôle de {name}",
    "mst.empty.title": "Aucun membre",
    "mst.empty.body": "Invitez votre équipe pour qu'elle accède aux commandes et à la cuisine.",

    /* Actions */
    "mst.invite": "Inviter",
    "mst.cancelInvite": "Annuler",
    "mst.cancelInviteFor": "Annuler l'invitation de {name}",
    "mst.suspend": "Suspendre",
    "mst.suspendFor": "Suspendre {name}",
    "mst.reinstate": "Réintégrer",
    "mst.reinstateFor": "Réintégrer {name}",
    "mst.cannotSuspendSelf": "Vous ne pouvez pas vous retirer vous-même.",
    "mst.cannotChangeOwnRole": "Vous ne pouvez pas modifier votre propre rôle.",
    "mst.ownerProtected": "Seul un propriétaire peut modifier un autre propriétaire.",

    /* Suspension — deliberately not a deletion. */
    "mst.suspend.title": "Suspendre {name} ?",
    "mst.suspend.body":
      "Cette personne perd immédiatement l'accès. Son historique de commandes reste intact et vous pourrez la réintégrer.",

    /* Cancelling an invitation IS a deletion — the one staff row that can be,
       because nobody has worked under it yet. Confirmed all the same: on a
       phone the button sits under a thumb. */
    "mst.cancelInvite.title": "Annuler l'invitation de {name} ?",
    "mst.cancelInvite.body":
      "L'invitation sera supprimée et le lien reçu ne fonctionnera plus. Vous pourrez en envoyer une nouvelle à tout moment.",
    "mst.cancelInvite.confirm": "Annuler l'invitation",
    "mst.cancelInvite.keep": "Garder l'invitation",

    /* Invitation */
    "mst.invite.title": "Inviter un membre",
    "mst.invite.email": "Adresse email",
    "mst.invite.emailHint": "Si elle a déjà un compte Resto237, l'accès est immédiat.",
    "mst.invite.emailPh": "collegue@restaurant.cm",
    "mst.invite.emailInvalid": "Cette adresse email n'est pas valide.",
    "mst.invite.name": "Nom",
    "mst.invite.nameHint": "Pour reconnaître l'invitation en attente.",
    "mst.invite.namePh": "Marie Ngo",
    "mst.invite.roleLegend": "Rôle dans cette succursale",
    "mst.invite.grants": "Ce rôle pourra",
    "mst.invite.send": "Envoyer l'invitation",

    /* Toasts */
    "mst.toast.invited": "Invitation envoyée.",
    "mst.toast.inviteCancelled": "Invitation annulée.",
    "mst.toast.roleChanged": "{name} — nouveau rôle : {role}.",
    "mst.toast.reinstated": "{name} a été réintégré(e).",
    "mst.toast.suspended": "{name} a été suspendu(e).",

    /* Branch roles — keyed off the raw `role` column. */
    "mst.role.owner": "Propriétaire",
    "mst.role.manager": "Gérant",
    "mst.role.kitchen": "Cuisine",
    "mst.role.cashier": "Caissier",
    "mst.role.waiter": "Serveur",

    "mst.roleDesc.owner": "Accès complet, y compris la facturation et le personnel.",
    "mst.roleDesc.manager": "Gère le service, le menu et l'équipe. Pas la facturation.",
    "mst.roleDesc.kitchen": "Écran de cuisine et avancement des commandes.",
    "mst.roleDesc.cashier": "Commandes, encaissement et clients.",
    "mst.roleDesc.waiter": "Prise de commande en salle, tables et réservations.",

    /* Staff statuses — keyed off the raw `status` column. */
    "mst.status.invited": "Invitation envoyée",
    "mst.status.active": "Actif",
    "mst.status.suspended": "Suspendu",

    /* What a role actually grants. The names alone are a guess; this is the
       matrix the server enforces, spelled out before the invitation goes. */
    "mst.cap.orders.view": "Voir les commandes",
    "mst.cap.orders.advance": "Faire avancer les commandes",
    "mst.cap.kitchen.display": "Écran de cuisine",
    "mst.cap.menu.view": "Voir le menu",
    "mst.cap.menu.edit": "Modifier le menu",
    "mst.cap.tables.view": "Voir les tables",
    "mst.cap.tables.manage": "Gérer les tables",
    "mst.cap.reservations.view": "Voir les réservations",
    "mst.cap.reservations.decide": "Décider des réservations",
    "mst.cap.promotions.manage": "Gérer les promotions",
    "mst.cap.customers.view": "Voir les clients",
    "mst.cap.reviews.reply": "Répondre aux avis",
    "mst.cap.reports.view": "Voir les rapports",
    "mst.cap.staff.manage": "Gérer le personnel",
    "mst.cap.billing.manage": "Gérer la facturation",
    "mst.cap.profile.edit": "Modifier le profil",
    "mst.cap.settings.manage": "Gérer les paramètres",
  },
  en: {
    "mst.toBranch": "Another branch",
    "mst.toBranch.title": "Add {name} to another branch",
    "mst.toBranch.body": "This person is already on your team: they are added directly, with the chosen role, without a new invitation.",
    "mst.toBranch.branch": "Branch",
    "mst.toBranch.role": "Role there",
    "mst.toBranch.submit": "Add",
    "mst.title": "Staff",
    "mst.subtitle": "Who works here, and what each of them can do.",

    "mst.teamOf": "The {name} team",
    "mst.branchNotice":
      "The role set here applies to this location only. The same person can hold a different role at another of your restaurants.",

    "mst.col.person": "Member",
    "mst.col.role": "Role",
    "mst.col.actions": "Actions",
    "mst.you": "You",
    "mst.pendingInvite": "Invitation pending",
    "mst.invitedOn": "Invited on {date}",
    "mst.memberSince": "On the team since {date}",
    "mst.roleOf": "Role of {name}",
    "mst.empty.title": "No team members",
    "mst.empty.body": "Invite your team so they can reach orders and the kitchen display.",

    "mst.invite": "Invite",
    "mst.cancelInvite": "Cancel",
    "mst.cancelInviteFor": "Cancel the invitation for {name}",
    "mst.suspend": "Suspend",
    "mst.suspendFor": "Suspend {name}",
    "mst.reinstate": "Reinstate",
    "mst.reinstateFor": "Reinstate {name}",
    "mst.cannotSuspendSelf": "You cannot remove yourself.",
    "mst.cannotChangeOwnRole": "You cannot change your own role.",
    "mst.ownerProtected": "Only an owner can change another owner.",

    "mst.suspend.title": "Suspend {name}?",
    "mst.suspend.body":
      "They lose access immediately. Their order history stays intact and you can reinstate them later.",

    "mst.cancelInvite.title": "Cancel the invitation for {name}?",
    "mst.cancelInvite.body":
      "The invitation is deleted and the link they received stops working. You can send a new one at any time.",
    "mst.cancelInvite.confirm": "Cancel the invitation",
    "mst.cancelInvite.keep": "Keep the invitation",

    "mst.invite.title": "Invite a team member",
    "mst.invite.email": "Email address",
    "mst.invite.emailHint": "If they already have a Resto237 account, access is immediate.",
    "mst.invite.emailPh": "colleague@restaurant.cm",
    "mst.invite.emailInvalid": "That email address is not valid.",
    "mst.invite.name": "Name",
    "mst.invite.nameHint": "So you can recognise the pending invitation.",
    "mst.invite.namePh": "Marie Ngo",
    "mst.invite.roleLegend": "Role at this location",
    "mst.invite.grants": "This role will be able to",
    "mst.invite.send": "Send the invitation",

    "mst.toast.invited": "Invitation sent.",
    "mst.toast.inviteCancelled": "Invitation cancelled.",
    "mst.toast.roleChanged": "{name} — new role: {role}.",
    "mst.toast.reinstated": "{name} has been reinstated.",
    "mst.toast.suspended": "{name} has been suspended.",

    "mst.role.owner": "Owner",
    "mst.role.manager": "Manager",
    "mst.role.kitchen": "Kitchen",
    "mst.role.cashier": "Cashier",
    "mst.role.waiter": "Waiter",

    "mst.roleDesc.owner": "Full access, including billing and staff.",
    "mst.roleDesc.manager": "Runs the service, the menu and the team. Not billing.",
    "mst.roleDesc.kitchen": "Kitchen display and moving orders along.",
    "mst.roleDesc.cashier": "Orders, taking payment and customers.",
    "mst.roleDesc.waiter": "Taking orders in the dining room, tables and bookings.",

    "mst.status.invited": "Invitation sent",
    "mst.status.active": "Active",
    "mst.status.suspended": "Suspended",

    "mst.cap.orders.view": "View orders",
    "mst.cap.orders.advance": "Move orders along",
    "mst.cap.kitchen.display": "Kitchen display",
    "mst.cap.menu.view": "View the menu",
    "mst.cap.menu.edit": "Edit the menu",
    "mst.cap.tables.view": "View tables",
    "mst.cap.tables.manage": "Manage tables",
    "mst.cap.reservations.view": "View bookings",
    "mst.cap.reservations.decide": "Accept or decline bookings",
    "mst.cap.promotions.manage": "Manage promotions",
    "mst.cap.customers.view": "View customers",
    "mst.cap.reviews.reply": "Reply to reviews",
    "mst.cap.reports.view": "View reports",
    "mst.cap.staff.manage": "Manage staff",
    "mst.cap.billing.manage": "Manage billing",
    "mst.cap.profile.edit": "Edit the profile",
    "mst.cap.settings.manage": "Manage settings",
  },
});

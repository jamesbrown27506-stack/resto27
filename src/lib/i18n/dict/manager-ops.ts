import { defineDict } from "../define";

/**
 * Service-time strings of the restaurant back office (Sep 2026): the
 * ring-until-accepted alarm, the alert-health banners, the one-tap pause,
 * the accept/pay-first order UI and personal notification settings.
 *
 * Prefix every key with `mops.` — except the `mst.cap.*` labels of the
 * capabilities added in the same change, which the staff screen looks up by
 * capability name and must therefore keep its prefix.
 */
export const managerOpsDict = defineDict({
  fr: {
    /* ── Navigation / personal notifications ─────────────────────────── */
    "mops.nav.notifications": "Mes notifications",
    "mops.notif.title": "Mes notifications",
    "mops.notif.subtitle":
      "Votre sonnerie et vos notifications, à vous seul. Chaque membre de l'équipe règle les siennes.",
    "mops.notif.soundTitle": "Sonnerie des commandes",
    "mops.notif.soundBody":
      "Tant qu'une commande attend d'être acceptée, l'application sonne en continu — si elle est ouverte. Application fermée, seules les notifications push vous préviennent.",
    "mops.notif.soundTest": "Tester le son",
    "mops.notif.soundReady": "Le son est activé sur cette page.",
    "mops.notif.soundBlocked": "Le son est bloqué : touchez l'écran une fois pour l'activer.",

    /* ── Ring until accepted ──────────────────────────────────────────── */
    "mops.alarm.one": "1 commande attend votre acceptation",
    "mops.alarm.many": "{count} commandes attendent votre acceptation",
    "mops.alarm.deadline": "Annulation automatique dans {minutes} min ({time})",
    "mops.alarm.view": "Voir",

    /* ── Alert health ─────────────────────────────────────────────────── */
    "mops.health.sound": "Son bloqué : touchez l'écran une fois pour activer la sonnerie des commandes.",
    "mops.health.push":
      "Notifications push désactivées sur cet appareil : application fermée, vous ne serez pas prévenu.",
    "mops.health.pushFix": "Activer",
    "mops.health.dismiss": "Masquer",
    "mops.health.realtime":
      "Connexion en direct perdue. Les nouvelles commandes s'affichent quand même, avec un peu de retard.",

    /* ── Service pause ────────────────────────────────────────────────── */
    "mops.pause.pause": "Mettre en pause",
    "mops.pause.resume": "Reprendre les commandes",
    "mops.pause.paused": "Commandes en pause. Les clients ne peuvent plus commander.",
    "mops.pause.resumed": "Commandes reprises.",
    "mops.pause.failed": "Impossible de changer l'état du service. Réessayez.",

    /* ── Dashboard ────────────────────────────────────────────────────── */
    "mops.attention.accept": "{count} commande(s) à accepter",

    /* ── Orders: accept / pay-first ───────────────────────────────────── */
    "mops.accept": "Accepter",
    "mops.countdown": "Annulation auto dans {minutes} min",
    "mops.countdownOver": "Délai dépassé — annulation imminente",
    "mops.awaitingPayment": "En attente du paiement du client — expire à {time}.",
    "mops.awaitingPaymentNoTime": "En attente du paiement du client.",
    "mops.awaitingPaymentBody":
      "Ne préparez rien : la commande passe en « payée » dès que le client a payé, et vous êtes prévenu. Sans paiement, elle est annulée automatiquement.",
    "mops.paidOnline": "Payé en ligne",
    "mops.toPayOnline": "À payer en ligne",
    "mops.toCollect": "À encaisser à la livraison",
    "mops.toCollectHint": "Frais de livraison, remis en espèces au livreur.",
    "mops.feeToQuote": "Frais de livraison à indiquer à l'acceptation",
    "mops.fee.label": "Frais de livraison — payés en espèces au livreur",
    "mops.fee.cashNote":
      "Ce montant n'est PAS ajouté au paiement en ligne. Le client paie les plats en ligne et remet les frais de livraison en espèces au livreur.",
    "mops.fee.online": "Payé en ligne (plats)",
    "mops.fee.cash": "Espèces au livreur",
    "mops.fee.confirm": "Accepter la commande",
    "mops.accepted": "Commande acceptée. Le client doit maintenant payer.",
    "mops.cancelRefund": "Commande annulée. Si elle était payée, le client est remboursé automatiquement.",

    /* ── Menu ─────────────────────────────────────────────────────────── */
    "mops.menu.availabilityOnly":
      "Vous pouvez marquer un plat épuisé ou de nouveau disponible. Le reste du menu est géré par le gérant.",

    /* ── Capability labels (staff screen) ────────────────────────────── */
    "mst.cap.orders.cancel": "Annuler les commandes",
    "mst.cap.menu.availability": "Marquer un plat épuisé",
    "mst.cap.reservations.seat": "Installer les clients",
    "mst.cap.payments.collect": "Encaisser à table",
    "mst.cap.service.pause": "Mettre le service en pause",
    "mst.cap.finance.manage": "Portefeuille et retraits",

    /* ── Wallet ───────────────────────────────────────────────────────── */
    "mops.wal.kind.payment": "Paiement reçu",
    "mops.wal.kind.deposit": "Acompte de réservation",
    "mops.wal.kind.withdrawal": "Retrait",
    "mops.wal.kind.adjustment": "Ajustement",
    "mops.wal.status.pending": "À envoyer",
    "mops.wal.status.paid": "Payé",
    "mops.wal.status.rejected": "Échoué",
    "mops.wal.status.processing": "Confirmation",
    "mops.wal.available": "Disponible au retrait",
    "mops.wal.availableHint": "Argent déjà versé au portefeuille de cette succursale.",
    "mops.wal.gross": "Ventes encaissées",
    "mops.wal.grossHint": "Plats après remises, payés en ligne. Les frais de livraison sont payés en espèces au livreur.",
    "mops.wal.fees": "Frais de paiement",
    "mops.wal.feesHint": "Frais du service de paiement en ligne retenus par Resto237.",
    "mops.wal.commission": "Commission due",
    "mops.wal.commissionHint": "Relevés en brouillon ou émis, pas encore réglés.",
    "mops.wal.net": "Net estimé après commission",
    "mops.wal.netHint": "Solde disponible moins la commission restant due.",
    "mops.wal.withdrawTitle": "Retirer de l'argent",
    "mops.wal.withdrawBody":
      "Après votre confirmation, le paiement est envoyé immédiatement au numéro Mobile Money indiqué.",
    "mops.wal.feeNote": "Frais de retrait : {percent} %, retenus sur le montant demandé.",
    "mops.wal.amount": "Montant (FCFA)",
    "mops.wal.availableAmount": "Disponible : {amount}",
    "mops.wal.held": "{amount} retenus jusqu'à la livraison des commandes payées et aux réservations à venir (remboursables en cas d'annulation).",
    "mops.wal.phone": "Numéro Mobile Money",
    "mops.wal.phoneHint": "9 chiffres commençant par 6, sans +237.",
    "mops.wal.debited": "Retiré du portefeuille",
    "mops.wal.feeLine": "Frais ({percent} %)",
    "mops.wal.youReceive": "Vous recevez",
    "mops.wal.withdrawNow": "Retirer maintenant",
    "mops.wal.requests": "Retraits",
    "mops.wal.requestsBody": "Vos retraits, du plus récent au plus ancien.",
    "mops.wal.requestFee": "frais {amount}",
    "mops.wal.sendNow": "Envoyer maintenant",
    "mops.wal.ledger": "Historique du portefeuille",
    "mops.wal.ledgerBody": "Chaque ligne explique le solde.",
    "mops.wal.confirmTitle": "Confirmer le retrait",
    "mops.wal.cancel": "Annuler",
    "mops.wal.confirmSend": "Confirmer et envoyer",
    "mops.wal.confirmBody":
      "Vérifiez le montant et le numéro. Le paiement sera lancé immédiatement après votre confirmation.",
    "mops.wal.balance": "Solde disponible",
    "mops.wal.withdrawn": "Montant retiré",
    "mops.wal.number": "Numéro",
    "mops.wal.covered": "Le solde couvre ce retrait.",
    "mops.wal.notCovered": "Le solde ne couvre pas ce retrait.",
    "mops.wal.pendingTitle": "Retrait en cours de confirmation",
    "mops.wal.background": "Continuer en arrière-plan",
    "mops.wal.pendingBody":
      "CamerPay a accepté le retrait. Le statut restera en cours jusqu'à la confirmation du paiement.",
    "mops.wal.pendingHint": "Vous pouvez fermer cette fenêtre. La vérification continue automatiquement.",
    "mops.wal.gateway": "Opérateur",
    "mops.wal.withdrawal": "Retrait",
    "mops.wal.sent": "Retrait envoyé. Confirmation CamerPay en cours.",
    "mops.wal.done": "Retrait effectué.",
    "mops.wal.confirmed": "CamerPay a confirmé le retrait.",
    "mops.wal.failed": "Le retrait a échoué. Le montant a été recrédité au portefeuille.",
  },
  en: {
    "mops.nav.notifications": "My notifications",
    "mops.notif.title": "My notifications",
    "mops.notif.subtitle":
      "Your own ring and notifications. Every team member sets theirs.",
    "mops.notif.soundTitle": "Order ring",
    "mops.notif.soundBody":
      "While an order is waiting to be accepted, the app rings continuously — as long as it is open. When the app is closed, only push notifications can reach you.",
    "mops.notif.soundTest": "Test the sound",
    "mops.notif.soundReady": "Sound is enabled on this page.",
    "mops.notif.soundBlocked": "Sound is blocked: tap the screen once to enable it.",

    "mops.alarm.one": "1 order is waiting for you to accept it",
    "mops.alarm.many": "{count} orders are waiting for you to accept them",
    "mops.alarm.deadline": "Cancelled automatically in {minutes} min ({time})",
    "mops.alarm.view": "View",

    "mops.health.sound": "Sound blocked: tap the screen once to enable the order ring.",
    "mops.health.push": "Push notifications are off on this device: you won't be alerted when the app is closed.",
    "mops.health.pushFix": "Turn on",
    "mops.health.dismiss": "Hide",
    "mops.health.realtime": "Live connection lost. New orders still appear, a little later.",

    "mops.pause.pause": "Pause orders",
    "mops.pause.resume": "Resume orders",
    "mops.pause.paused": "Orders paused. Customers can no longer order.",
    "mops.pause.resumed": "Orders resumed.",
    "mops.pause.failed": "Could not change the service state. Try again.",

    "mops.attention.accept": "{count} order(s) to accept",

    "mops.accept": "Accept",
    "mops.countdown": "Auto-cancel in {minutes} min",
    "mops.countdownOver": "Time limit passed — cancelling shortly",
    "mops.awaitingPayment": "Waiting for the customer's payment — expires at {time}.",
    "mops.awaitingPaymentNoTime": "Waiting for the customer's payment.",
    "mops.awaitingPaymentBody":
      "Don't prepare anything: the order turns \"paid\" as soon as the customer pays, and you are notified. Unpaid, it is cancelled automatically.",
    "mops.paidOnline": "Paid online",
    "mops.toPayOnline": "To pay online",
    "mops.toCollect": "To collect on delivery",
    "mops.toCollectHint": "Delivery fee, paid in cash to the rider.",
    "mops.feeToQuote": "Delivery fee to set when accepting",
    "mops.fee.label": "Delivery fee — paid in cash to the rider",
    "mops.fee.cashNote":
      "This amount is NOT added to the online payment. The customer pays for the food online and hands the delivery fee to the rider in cash.",
    "mops.fee.online": "Paid online (food)",
    "mops.fee.cash": "Cash to the rider",
    "mops.fee.confirm": "Accept the order",
    "mops.accepted": "Order accepted. The customer must now pay.",
    "mops.cancelRefund": "Order cancelled. If it was paid, the customer is refunded automatically.",

    "mops.menu.availabilityOnly":
      "You can mark a dish sold out or available again. The rest of the menu is managed by the manager.",

    "mst.cap.orders.cancel": "Cancel orders",
    "mst.cap.menu.availability": "Mark dishes sold out",
    "mst.cap.reservations.seat": "Seat guests",
    "mst.cap.payments.collect": "Take payment at the table",
    "mst.cap.service.pause": "Pause the service",
    "mst.cap.finance.manage": "Wallet and withdrawals",

    "mops.wal.kind.payment": "Payment received",
    "mops.wal.kind.deposit": "Reservation deposit",
    "mops.wal.kind.withdrawal": "Withdrawal",
    "mops.wal.kind.adjustment": "Adjustment",
    "mops.wal.status.pending": "To send",
    "mops.wal.status.paid": "Paid",
    "mops.wal.status.rejected": "Failed",
    "mops.wal.status.processing": "Confirming",
    "mops.wal.available": "Available to withdraw",
    "mops.wal.availableHint": "Money already settled to this branch wallet.",
    "mops.wal.gross": "Sales collected",
    "mops.wal.grossHint": "Food after discounts, paid online. Delivery fees are paid in cash to the rider.",
    "mops.wal.fees": "Payment fees",
    "mops.wal.feesHint": "Online payment service fees retained by Resto237.",
    "mops.wal.commission": "Commission due",
    "mops.wal.commissionHint": "Draft and issued statements not yet settled.",
    "mops.wal.net": "Estimated net after commission",
    "mops.wal.netHint": "Available balance less outstanding commission.",
    "mops.wal.withdrawTitle": "Withdraw money",
    "mops.wal.withdrawBody": "Once you confirm, the payment is sent immediately to the Mobile Money number given.",
    "mops.wal.feeNote": "Withdrawal fee: {percent}%, taken from the amount requested.",
    "mops.wal.amount": "Amount (FCFA)",
    "mops.wal.availableAmount": "Available: {amount}",
    "mops.wal.held": "{amount} held until paid orders are delivered and upcoming bookings take place (refundable if cancelled).",
    "mops.wal.phone": "Mobile Money number",
    "mops.wal.phoneHint": "9 digits starting with 6, without +237.",
    "mops.wal.debited": "Taken from the wallet",
    "mops.wal.feeLine": "Fee ({percent}%)",
    "mops.wal.youReceive": "You receive",
    "mops.wal.withdrawNow": "Withdraw now",
    "mops.wal.requests": "Withdrawals",
    "mops.wal.requestsBody": "Your withdrawals, newest first.",
    "mops.wal.requestFee": "fee {amount}",
    "mops.wal.sendNow": "Send now",
    "mops.wal.ledger": "Wallet history",
    "mops.wal.ledgerBody": "Every line explains the balance.",
    "mops.wal.confirmTitle": "Confirm the withdrawal",
    "mops.wal.cancel": "Cancel",
    "mops.wal.confirmSend": "Confirm and send",
    "mops.wal.confirmBody": "Check the amount and the number. The payment starts as soon as you confirm.",
    "mops.wal.balance": "Available balance",
    "mops.wal.withdrawn": "Amount withdrawn",
    "mops.wal.number": "Number",
    "mops.wal.covered": "The balance covers this withdrawal.",
    "mops.wal.notCovered": "The balance does not cover this withdrawal.",
    "mops.wal.pendingTitle": "Withdrawal being confirmed",
    "mops.wal.background": "Continue in the background",
    "mops.wal.pendingBody": "CamerPay accepted the withdrawal. It stays in progress until the payment is confirmed.",
    "mops.wal.pendingHint": "You can close this window. Checking continues automatically.",
    "mops.wal.gateway": "Operator",
    "mops.wal.withdrawal": "Withdrawal",
    "mops.wal.sent": "Withdrawal sent. Waiting for CamerPay to confirm.",
    "mops.wal.done": "Withdrawal completed.",
    "mops.wal.confirmed": "CamerPay confirmed the withdrawal.",
    "mops.wal.failed": "The withdrawal failed. The amount was credited back to the wallet.",
  },
});

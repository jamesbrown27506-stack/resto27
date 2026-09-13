export interface CamerPayNotificationEntry {
  id?: number;
  date?: string;
  numero?: string;
  title?: string;
  message?: string;
}

export interface PaymentInstruction {
  id?: number;
  date?: string;
  message: string;
  code?: string;
}

export interface PaymentInstructionHint {
  phone: string;
  amount: number;
  afterNotificationId?: number;
}

function barePhone(value: string): string {
  return value.replace(/\D/g, "").replace(/^(00)?237/, "");
}

function containsPhone(message: string, phone: string): boolean {
  const digits = barePhone(phone);
  if (!digits) return false;
  const separated = digits
    .split("")
    .map((digit) => digit + "\\D*")
    .join("");
  return new RegExp("(?:^|\\D)" + separated + "(?:$|\\D)").test(message);
}

function containsAmount(message: string, amount: number): boolean {
  return new RegExp("(?:^|\\D)" + amount + "(?:$|\\D)").test(message);
}

/**
 * Finds a post-initiation action notice for this exact customer and amount.
 * The notification envelope's numero is deliberately ignored: live Orange
 * notifications have shown the merchant number there while naming the charged
 * customer inside the message.
 */
export function findPaymentInstruction(
  rows: CamerPayNotificationEntry[],
  hint: PaymentInstructionHint,
): PaymentInstruction | null {
  const match = [...rows]
    .filter((row) => {
      if (!row.message) return false;
      if (
        hint.afterNotificationId !== undefined &&
        (row.id === undefined || row.id <= hint.afterNotificationId)
      ) {
        return false;
      }
      return containsPhone(row.message, hint.phone) && containsAmount(row.message, hint.amount);
    })
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];

  if (!match?.message) return null;

  const code = match.message.match(/[#*][0-9*#]{3,}#/)?.[0];
  return {
    id: match.id,
    date: match.date,
    message: match.message,
    code,
  };
}
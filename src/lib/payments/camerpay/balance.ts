import "server-only";
import { getBalance } from "./client";

/** Unknown is never displayed as zero. This call only reads gateway liquidity. */
export async function readCamerPayBalance(): Promise<number | null> {
  try {
    const response = await getBalance();
    const value = response.data?.credit;
    return response.etat && typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value) : null;
  } catch {
    return null;
  }
}

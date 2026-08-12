"use server";

import { requireCapability } from "@/lib/auth/branch";
import { saveUpload, type UploadKind } from "@/lib/uploads";

/**
 * The dish photo upload.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT WRITES A FILE, NOT A ROW.
 *
 *  The returned URL is put into the editor's draft and reaches the database
 *  through createMenuItem/updateMenuItem, which already re-check `menu.edit`
 *  and scope the row to the active branch. Writing `image_url` here as well
 *  would be a second path to the same column, on a different guard — and two
 *  guards for one column is how they drift apart.
 *
 *  So there is no revalidatePath either: nothing any page renders has changed
 *  until the dish itself is saved.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Like every Server Action it takes NO restaurantId (§6): a Server Action is
 * a public POST endpoint that never passes through the page's guard, so the
 * capability is re-checked here from the session.
 */

/** Mirrors MAX_BYTES in lib/uploads. Checked there too — that is the boundary. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * A reason CODE, not a sentence.
 *
 * Every other action in this codebase returns English prose that the toast
 * shows verbatim; this screen is fully bilingual, so the client translates the
 * code instead of displaying an English string to a French kitchen.
 */
export type MenuImageResult =
  | { ok: true; url: string }
  | { ok: false; reason: "empty" | "tooLarge" | "rejected" };

export async function uploadMenuImage(formData: FormData): Promise<MenuImageResult> {
  await requireCapability("menu.edit");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_BYTES) return { ok: false, reason: "tooLarge" };

  // Files land in public/uploads/menu/, on this server — not in Supabase
  // Storage. saveUpload sniffs the actual bytes and names the file itself,
  // because both `file.type` and `file.name` come from the browser.
  const result = await saveUpload(file, "menu" satisfies UploadKind);
  if (!result.ok) {
    console.error("[menu:uploadMenuImage]", result.error);
    return { ok: false, reason: "rejected" };
  }

  return { ok: true, url: result.url };
}

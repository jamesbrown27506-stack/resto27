import "server-only";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { isSameAddress } from "@/lib/orders/address-match";
import { fetchCustomerAddresses } from "./customer";
import { defaultServiceAreaId, resolveOrCreateQuartier } from "./quartiers";

/**
 * Keep the address a customer just typed at checkout, when they asked to.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ADDRESSES TYPED AT CHECKOUT USED TO VANISH.
 *
 *  The checkout accepted a brand-new address, delivered to it, and forgot it.
 *  The next order started from an empty form again — quartier, street,
 *  landmark, phone, on a phone keyboard — even though the "Mes adresses"
 *  screen existed precisely to avoid that. Now the checkout offers
 *  "Enregistrer cette adresse" and placeOrder calls this after the order row
 *  and its lines are written.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A plain server module (not "use server"): it writes to the caller's own
 * address book given a profile id, so it must only be reachable from
 * placeOrder, which has already authenticated that profile.
 *
 * NEVER THROWS. Saving the address is a convenience for the NEXT order; a
 * failure here must never cost the customer the order they just placed.
 */
export async function saveCheckoutAddress(input: {
  profileId: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  quartier: string | null;
  landmark: string | null;
}): Promise<void> {
  try {
    const addressLine = input.addressLine.trim();
    const quartier = input.quartier?.trim() ?? "";
    if (!addressLine || !quartier) return;

    // An identical address already on file is not saved twice.
    const existing = await fetchCustomerAddresses(input.profileId);
    if (existing.some((a) => isSameAddress(a, { addressLine, quartier }))) return;

    const areaId = await defaultServiceAreaId();
    if (!areaId) return;
    const quartierId = await resolveOrCreateQuartier(quartier, areaId);
    if (!quartierId) return;

    const { error } = await createAdminClient().from("customer_addresses").insert({
      profile_id: input.profileId,
      // The quartier is the label people recognise their own address by in a
      // list ("Bonapriso", "Akwa") — they can rename it under Mes adresses.
      label: quartier.slice(0, 60),
      recipient_name: input.recipientName.trim() || null,
      phone: input.phone.trim() || null,
      address_line: addressLine,
      quartier_id: quartierId,
      landmark: input.landmark?.trim() || null,
      // The first address becomes the default, so the next checkout is
      // pre-filled; later ones never steal the default from a chosen one.
      is_default: existing.length === 0,
    });
    if (error) {
      console.error("[checkout:saveAddress]", error.message);
      return;
    }
    revalidatePath("/addresses");
    revalidatePath("/checkout");
  } catch (cause) {
    console.error("[checkout:saveAddress]", cause);
  }
}

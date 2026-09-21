"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { rateLimit } from "@/lib/rate-limit";
import { initiatePaymentAttempt, checkPaymentAttempt, settlePayment } from "@/lib/payments/collect";
import { normalisePhone } from "@/lib/payments/camerpay/client";
import { notify } from "@/lib/notify";
import { sendGuestDiningPush } from "@/lib/push";
import { canGuestUseDiningSession, diningFeatureAllowed } from "@/lib/dining/access";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenOk = (token: string) => /^[a-f0-9]{64}$/i.test(token);
export type DiningAction = { ok: boolean; error?: string };

async function notifyDiningStaff(
  sessionId: string,
  kind: "access" | "order" | "message",
  guestName: string,
  preview?: string,
) {
  const db = createAdminClient();
  const { data } = await db
    .from("dining_sessions")
    .select("restaurant_id,restaurant_tables(number)")
    .eq("id", sessionId)
    .maybeSingle();
  const tableInfo = data?.restaurant_tables as unknown as { number?: string } | { number?: string }[] | null;
  const tableNumber = Array.isArray(tableInfo) ? tableInfo[0]?.number : tableInfo?.number;
  if (!data?.restaurant_id) return;
  await notify({
    event: "table_service",
    tone: kind === "access" ? "warning" : "info",
    restaurantId: data.restaurant_id,
    href: `/m/table-order?session=${sessionId}`,
    params: { reference: tableNumber ?? "—", customerName: guestName, tableServiceKind: kind, preview },
  });
}
async function notifyTableGuest(
  guestId: string,
  copy: { fr: { title: string; body: string }; en: { title: string; body: string } },
  persist = true,
) {
  const db = createAdminClient();
  const { data } = await db.from("dining_guests")
    .select("locale,session_id,dining_sessions!inner(restaurant_tables(public_token))")
    .eq("id", guestId).maybeSingle();
  if (!data) return;
  const session = Array.isArray(data.dining_sessions) ? data.dining_sessions[0] : data.dining_sessions;
  const table = Array.isArray(session?.restaurant_tables) ? session.restaurant_tables[0] : session?.restaurant_tables;
  const language = data.locale === "en" ? "en" : "fr";
  const message = copy[language];
  if (persist) {
    const { error } = await db.from("dining_messages").insert({
      session_id: data.session_id,
      guest_id: guestId,
      sender_kind: "system",
      kind: "message",
      body: message.body.slice(0, 500),
    });
    if (error) console.error("[dining:guest-message]", error.message);
  }
  if (table?.public_token) {
    await sendGuestDiningPush(guestId, {
      title: message.title,
      body: message.body,
      href: `/table/${table.public_token}`,
      tag: `resto237:table:${guestId}`,
      lang: language,
      tone: "info",
      icon: "/app-icon-192.png",
      badge: "/notification-badge.png",
    });
  }
}

async function notifySessionGuests(
  sessionId: string,
  copy: { fr: { title: string; body: string }; en: { title: string; body: string } },
) {
  const { data } = await createAdminClient().from("dining_guests")
    .select("id").eq("session_id", sessionId).in("status", ["approved", "expired"]);
  await Promise.allSettled((data ?? []).map((guest) => notifyTableGuest(guest.id, copy)));
}

async function enterpriseRestaurant(restaurantId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db.from("subscription_state").select("plan_id,state").eq("restaurant_id", restaurantId).maybeSingle();
  if (!data?.plan_id || !["active", "grace"].includes(data.state)) return false;
  const { data: plan } = await db.from("subscription_plans").select("tier").eq("id", data.plan_id).maybeSingle();
  return diningFeatureAllowed(plan?.tier ?? "", data.state);
}

export async function getTableLanding(tableToken: string) {
  if (!/^[0-9a-f-]{36}$/i.test(tableToken)) return null;
  const db = createAdminClient();
  const { data } = await db.from("restaurant_tables")
    .select("id,number,capacity,status,restaurant_id,restaurants(name,logo_url,status,is_accepting_orders)")
    .eq("public_token", tableToken).maybeSingle();
  const restaurant = Array.isArray(data?.restaurants) ? data.restaurants[0] : data?.restaurants;
  if (!data || restaurant?.status !== "active" || !(await enterpriseRestaurant(data.restaurant_id))) return null;
  const [{ data: categories }, { data: items }, { data: groups }, { data: options }, { data: feeSetting }] = await Promise.all([
    db.from("menu_categories").select("id,name,sort_order").eq("restaurant_id",data.restaurant_id).eq("is_active",true).order("sort_order"),
    db.from("menu_items").select("id,category_id,name,description,price,image_url,is_available,track_stock,stock_quantity,sort_order").eq("restaurant_id",data.restaurant_id).order("sort_order"),
    db.from("menu_option_groups").select("id,menu_item_id,name,min_select,max_select,is_required,sort_order").order("sort_order"),
    db.from("menu_options").select("id,group_id,name,price_delta,is_available,sort_order").order("sort_order"),
    db.from("settings").select("value").eq("key","service_charge_percent").maybeSingle(),
  ]);
  const itemIds = new Set((items??[]).map(x=>x.id));
  const filteredGroups=(groups??[]).filter(x=>itemIds.has(x.menu_item_id));
  const groupIds=new Set(filteredGroups.map(x=>x.id));
  return { table:{id:data.id,token:tableToken,number:data.number,capacity:data.capacity,status:data.status}, restaurant, categories:categories??[], items:items??[], groups:filteredGroups, options:(options??[]).filter(x=>groupIds.has(x.group_id)), serviceChargePercent:Number(feeSetting?.value??0)||0 };
}

export async function requestTableAccess(tableToken: string, displayName: string, locale: "fr" | "en" = "fr") {
  const limited=await rateLimit({key:"dining:join",limit:12,windowMs:60*60_000});
  if(!limited.ok) return {ok:false,error:"Too many requests. Ask a waiter for help."};
  const raw=randomBytes(32).toString("hex");
  const {data,error}=await createAdminClient().rpc("request_dining_access",{p_table_token:tableToken,p_token_hash:hash(raw),p_display_name:displayName});
  if(error){console.error("[dining:join]",error.message);return {ok:false,error:"This table cannot accept guests right now."};}
  const result=data as {status:string;sessionId:string;guestId:string};
  await createAdminClient().from("dining_guests").update({locale}).eq("id",result.guestId);
  await notifyDiningStaff(result.sessionId,"access",displayName.trim().slice(0,60)||"Guest");
  revalidatePath("/m/table-order");
  return {ok:true,guestToken:raw,status:result.status};
}

async function guestContext(raw:string){
  if(!tokenOk(raw)) return null;
  const db=createAdminClient();
  const {data}=await db.from("dining_guests").select("id,status,display_name,session_id,dining_sessions!inner(id,status,restaurant_id,table_id,order_id,restaurant_tables(number,public_token),restaurants(name))").eq("token_hash",hash(raw)).maybeSingle();
  return data;
}

export async function getGuestDiningState(raw:string){
  const ctx=await guestContext(raw); if(!ctx)return null;
  const session=Array.isArray(ctx.dining_sessions)?ctx.dining_sessions[0]:ctx.dining_sessions;
  const db=createAdminClient();
  const [{data:rounds},{data:messages},{data:order}]=await Promise.all([
    db.from("dining_rounds").select("id,status,subtotal,notes,created_at,dining_round_items(id,name,quantity,unit_price,options_label,status,rejection_reason)").eq("guest_id",ctx.id).order("created_at"),
    db.from("dining_messages").select("id,guest_id,sender_kind,kind,body,created_at").eq("session_id",ctx.session_id).or(`guest_id.eq.${ctx.id},guest_id.is.null`).order("created_at").limit(100),
    session?.order_id?db.from("orders").select("id,reference,status,total,subtotal,service_charge,is_paid,payment_method,payment_requested_at,order_items(name,quantity,unit_price,options_label)").eq("id",session.order_id).maybeSingle():Promise.resolve({data:null}),
  ]);
  return {guest:{id:ctx.id,name:ctx.display_name,status:ctx.status},session,rounds:rounds??[],messages:messages??[],order:order??null};
}

export async function submitGuestRound(raw:string,input:{lines:{menuItemId:string;quantity:number;optionIds:string[]}[];notes?:string}):Promise<DiningAction>{
  const limited=await rateLimit({key:"dining:order",limit:10,windowMs:15*60_000,identifier:hash(raw).slice(0,24)}); if(!limited.ok)return{ok:false,error:"Please wait before sending another order."};
  const {error}=await createAdminClient().rpc("submit_dining_round",{p_token_hash:hash(raw),p_lines:input.lines,p_notes:input.notes??null});
  if(error){console.error("[dining:round]",error.message);return{ok:false,error:error.message.includes("session_not_open")?"This table session is closed.":"The order could not be sent. Check the dishes and try again."};}
  const ctx=await guestContext(raw);
  if(ctx) await notifyDiningStaff(ctx.session_id,"order",ctx.display_name);
  revalidatePath("/m/table-order"); return{ok:true};
}

const REQUESTS={call_waiter:"Please come to our table.",water:"Please bring water.",cutlery:"Please bring cutlery.",bill:"We would like the bill.",missing_item:"An item is missing.",allergy:"We need help with an allergy.",help:"We need assistance."} as const;
export async function sendGuestDiningMessage(raw:string,kind:keyof typeof REQUESTS|"message",body?:string):Promise<DiningAction>{
  const ctx=await guestContext(raw); if(!ctx||ctx.status!=="approved")return{ok:false,error:"Your table access is not active."};
  const session=Array.isArray(ctx.dining_sessions)?ctx.dining_sessions[0]:ctx.dining_sessions;
  if(!session||!canGuestUseDiningSession(ctx.status,session.status))return{ok:false,error:"This table session is closed."};
  const text=(kind==="message"?body:REQUESTS[kind])?.trim().slice(0,500);if(!text)return{ok:false,error:"Write a message first."};
  const limited=await rateLimit({key:"dining:message",limit:12,windowMs:5*60_000,identifier:ctx.id});if(!limited.ok)return{ok:false,error:"Please wait before sending another request."};
  const {error}=await createAdminClient().from("dining_messages").insert({session_id:ctx.session_id,guest_id:ctx.id,sender_kind:"guest",kind,body:text});if(error)return{ok:false,error:"Message not sent."};
  await notifyDiningStaff(ctx.session_id,"message",ctx.display_name,text);
  revalidatePath("/m/table-order");return{ok:true};
}

export async function getMyDiningNotifications(): Promise<boolean> {
  const { active, profile } = await requireCapability("orders.view");
  const { data } = await createAdminClient().from("notification_preferences")
    .select("in_app,push")
    .eq("restaurant_id", active.restaurantId)
    .eq("profile_id", profile.id)
    .eq("event_key", "table_service")
    .maybeSingle();
  return data ? Boolean(data.in_app || data.push) : true;
}

export async function setMyDiningNotifications(enabled: boolean): Promise<DiningAction> {
  const { active, profile } = await requireCapability("orders.view");
  const { error } = await createAdminClient().from("notification_preferences").upsert({
    restaurant_id: active.restaurantId,
    profile_id: profile.id,
    event_key: "table_service",
    in_app: enabled,
    email: false,
    push: enabled,
  }, { onConflict: "restaurant_id,profile_id,event_key" });
  if (error) {
    console.error("[dining:notifications]", error.message);
    return { ok: false, error: "Could not save your table alert preference." };
  }
  revalidatePath("/m/table-order");
  revalidatePath("/m/settings");
  return { ok: true };
}
export async function fetchDiningFloor(restaurantId:string){
  const {data,error}=await createAdminClient().from("dining_sessions").select("id,status,order_id,created_at,payment_requested_at,restaurant_tables(id,number,public_token),dining_guests(id,display_name,status,created_at),dining_rounds(id,guest_id,status,subtotal,notes,created_at,dining_round_items(id,name,quantity,unit_price,options_label,status,rejection_reason)),dining_messages(id,guest_id,sender_kind,kind,body,created_at),orders!dining_sessions_order_id_fkey(id,reference,status,total,is_paid,payment_method)").eq("restaurant_id",restaurantId).in("status",["awaiting_staff","open","payment_requested"]).order("created_at");
  if(error){console.error("[dining:floor]",error.message);return[];}return data??[];
}

export async function decideDiningGuest(guestId:string,approve:boolean):Promise<DiningAction>{
  const {active,profile}=await requireCapability("orders.advance"); if(!(await enterpriseRestaurant(active.restaurantId)))return{ok:false,error:"The 25,000 FCFA package is required."};
  const db=createAdminClient();const {data:guest}=await db.from("dining_guests").select("id,status,session_id,dining_sessions!inner(restaurant_id,table_id)").eq("id",guestId).eq("status","pending").maybeSingle();
  const session=Array.isArray(guest?.dining_sessions)?guest?.dining_sessions[0]:guest?.dining_sessions;if(!guest||session?.restaurant_id!==active.restaurantId)return{ok:false,error:"Request not found."};
  const {error}=await db.rpc("decide_dining_guest",{p_guest_id:guestId,p_staff_id:profile.id,p_approve:approve});if(error){console.error("[dining:guest]",error.message);return{ok:false,error:"Could not update access."};}
  await notifyTableGuest(guestId, approve
    ? {
        fr: { title: "Accès à la table accepté", body: "Le restaurant a confirmé votre présence. Vous pouvez consulter le menu et commander." },
        en: { title: "Table access approved", body: "The restaurant confirmed you are at the table. You can browse the menu and order." },
      }
    : {
        fr: { title: "Accès à la table refusé", body: "Le restaurant n’a pas validé cette demande. Demandez de l’aide au personnel si vous êtes sur place." },
        en: { title: "Table access declined", body: "The restaurant did not approve this request. Ask staff for help if you are at the table." },
      });
  revalidatePath("/m/table-order");return{ok:true};
}

export async function decideDiningItem(itemId: string, approve: boolean, reason?: string): Promise<DiningAction> {
  const { active, profile } = await requireCapability("orders.advance");
  if (!approve && (!reason?.trim() || reason.trim().length < 5 || reason.trim().length > 240)) {
    return { ok: false, error: "Give the customer a reason (5–240 characters)." };
  }
  const db = createAdminClient();
  const { data: item } = await db.from("dining_round_items")
    .select("id,dining_rounds!inner(session_id,dining_sessions!inner(restaurant_id))")
    .eq("id", itemId).eq("status", "pending").maybeSingle();
  const round = Array.isArray(item?.dining_rounds) ? item.dining_rounds[0] : item?.dining_rounds;
  const session = Array.isArray(round?.dining_sessions) ? round.dining_sessions[0] : round?.dining_sessions;
  if (!item || session?.restaurant_id !== active.restaurantId) return { ok: false, error: "Dish request not found." };

  const { data, error } = await db.rpc("decide_dining_item", {
    p_item_id: itemId,
    p_staff_id: profile.id,
    p_approve: approve,
    p_reason: approve ? null : reason?.trim(),
  });
  if (error) {
    console.error("[dining:item-decision]", error.message);
    return { ok: false, error: error.message.includes("insufficient_stock")
      ? "Not enough stock for this dish."
      : "Could not update this dish. Refresh and try again." };
  }
  const result = data as { guestId: string; orderId?: string; reference?: string; itemName: string; quantity: number; amount: number };
  if (approve) {
    await notifyTableGuest(result.guestId, {
      fr: { title: "Plat accepté", body: `${result.quantity} × ${result.itemName} a été accepté et envoyé en cuisine.` },
      en: { title: "Dish accepted", body: `${result.quantity} × ${result.itemName} was accepted and sent to the kitchen.` },
    });
    if (result.orderId) {
      await notify({
        event: "new_order", tone: "info", restaurantId: active.restaurantId,
        href: `/m/orders/${result.orderId}`,
        params: { reference: result.reference, customerName: "Dining room", amount: result.amount },
      });
    }
  } else {
    await notifyTableGuest(result.guestId, {
      fr: { title: "Plat indisponible", body: `${result.itemName} refusé : ${reason?.trim()}` },
      en: { title: "Dish declined", body: `${result.itemName} declined: ${reason?.trim()}` },
    });
  }
  revalidatePath("/m/table-order");
  revalidatePath("/m/orders");
  revalidatePath("/m/kitchen");
  return { ok: true };
}

export async function requestDiningPayment(sessionId:string):Promise<DiningAction>{
  const {active,profile}=await requireCapability("finance.manage");const db=createAdminClient();const {data:s}=await db.from("dining_sessions").select("id,order_id").eq("id",sessionId).eq("restaurant_id",active.restaurantId).eq("status","open").maybeSingle();if(!s?.order_id)return{ok:false,error:"There is no bill to collect."};
  const {data:setting}=await db.from("settings").select("value").eq("key","service_charge_percent").maybeSingle();const pct=Number(setting?.value??0)||0;const {error}=await db.rpc("request_dining_payment",{p_session_id:sessionId,p_staff_id:profile.id,p_service_charge_percent:pct});if(error){console.error("[dining:request-payment]",error.message);return{ok:false,error:"The bill could not be moved to payment. Refresh and try again."};}
  await notifySessionGuests(sessionId, {
    fr: { title: "Addition prête à payer", body: "Le restaurant vous propose de régler votre addition en ligne. Ouvrez la table pour voir le total et la commission." },
    en: { title: "Bill ready to pay", body: "The restaurant invited you to pay your bill online. Open your table to review the total and service fee." },
  });
  revalidatePath("/m/table-order");revalidatePath("/m/orders");return{ok:true};
}

export async function closeDiningCash(sessionId:string):Promise<DiningAction>{const {active,profile}=await requireCapability("finance.manage");const db=createAdminClient();const {data:s}=await db.from("dining_sessions").select("id").eq("id",sessionId).eq("restaurant_id",active.restaurantId).maybeSingle();if(!s)return{ok:false,error:"Table session not found."};
  const { data: undecided } = await db.from("dining_round_items")
    .select("id,dining_rounds!inner(session_id)")
    .eq("dining_rounds.session_id", sessionId).eq("status", "pending").limit(1).maybeSingle();
  if (undecided) return { ok: false, error: "Decide every dish before closing the bill." };
  const {error}=await db.rpc("close_dining_cash",{p_session_id:sessionId,p_staff_id:profile.id});if(error){console.error("[dining:cash]",error.message);return{ok:false,error:"Could not record the cash payment."};}
  await notifySessionGuests(sessionId, {
    fr: { title: "Paiement sur place enregistré", body: "Le restaurant a enregistré votre paiement sur place. Merci de votre visite." },
    en: { title: "On-site payment recorded", body: "The restaurant recorded your payment on site. Thank you for visiting." },
  });
  revalidatePath("/m/table-order");revalidatePath("/m/orders");return{ok:true};}

export async function payDiningBill(raw:string,phone:string):Promise<DiningAction&{status?:"pending"|"succeeded";attemptId?:string;instruction?:PaymentInstruction}>{const ctx=await guestContext(raw);const session=Array.isArray(ctx?.dining_sessions)?ctx?.dining_sessions[0]:ctx?.dining_sessions;if(!ctx||ctx.status!=="approved"||session?.status!=="payment_requested"||!session.order_id)return{ok:false,error:"This table is not requesting payment."};const requested=normalisePhone(phone);if(!requested)return{ok:false,error:"Enter a valid Mobile Money number."};const db=createAdminClient();const {data:o}=await db.from("orders").select("id,reference,restaurant_id,total,status,is_paid,payment_method").eq("id",session.order_id).maybeSingle();if(!o)return{ok:false,error:"Bill not found."};if(o.is_paid)return{ok:true,status:"succeeded"};
 const {data:attempts}=await db.from("payment_attempts").select("id,status,transaction_id,phone").eq("raw_response->>orderId",o.id).in("status",["pending","succeeded"]).is("settled_at",null).order("created_at",{ascending:false}).limit(5);const open=(attempts??[]).find(a=>a.status==="succeeded"||Boolean(a.transaction_id));if(open?.status==="succeeded"){const settled=await settlePayment(open.id);return settled.ok?{ok:true,status:"succeeded"}:{ok:false,error:settled.error};}if(open?.transaction_id){const current=await checkPaymentAttempt(open.id);if(current.status==="succeeded")return{ok:true,status:"succeeded"};if(current.status==="pending"){if(normalisePhone(String(open.phone??""))!==requested)return{ok:false,error:"Another Mobile Money request is still active for this bill."};return{ok:true,status:"pending",attemptId:open.id,instruction:current.instruction};}}
 const {data:claimed}=await db.rpc("claim_dining_payment",{p_order_id:o.id});if(!claimed)return{ok:false,error:"A payment request is already active for this bill."};
 const initiated=await initiatePaymentAttempt({kind:"order",restaurantId:o.restaurant_id,orderId:o.id,reference:o.reference,phone:requested,amount:o.total});if(!initiated.ok||!initiated.attemptId){await db.from("orders").update({payment_started_at:null}).eq("id",o.id).eq("is_paid",false);return{ok:false,error:initiated.error??"Payment failed."};}if(initiated.status==="pending")return{ok:true,status:"pending",attemptId:initiated.attemptId,instruction:initiated.instruction};const settled=await settlePayment(initiated.attemptId);return settled.ok?{ok:true,status:"succeeded"}:{ok:false,error:settled.error};}

export async function checkDiningPayment(raw:string,attemptId:string){const ctx=await guestContext(raw);const session=Array.isArray(ctx?.dining_sessions)?ctx?.dining_sessions[0]:ctx?.dining_sessions;if(!ctx||!session?.order_id)return{ok:false as const,error:"Payment not found."};const db=createAdminClient();const {data:a}=await db.from("payment_attempts").select("raw_response").eq("id",attemptId).maybeSingle();if((a?.raw_response as {orderId?:string}|null)?.orderId!==session.order_id)return{ok:false as const,error:"Payment not found."};const result=await checkPaymentAttempt(attemptId);return{ok:result.ok,status:result.status,instruction:result.instruction,error:result.error};}

export async function sendStaffDiningMessage(sessionId: string, guestId: string, body: string): Promise<DiningAction> {
  const { active, profile } = await requireCapability("orders.view");
  const text = body.trim().slice(0, 500);
  if (!text) return { ok: false, error: "Write a message first." };
  const db = createAdminClient();
  const { data: session } = await db.from("dining_sessions").select("id")
    .eq("id", sessionId).eq("restaurant_id", active.restaurantId)
    .in("status", ["awaiting_staff", "open", "payment_requested"]).maybeSingle();
  if (!session) return { ok: false, error: "Table session not found." };
  const { data: guest } = await db.from("dining_guests").select("id")
    .eq("id", guestId).eq("session_id", sessionId).eq("status", "approved").maybeSingle();
  if (!guest) return { ok: false, error: "Choose an approved guest." };
  const { error } = await db.from("dining_messages").insert({
    session_id: sessionId, guest_id: guestId, sender_kind: "staff",
    sender_staff_id: profile.id, kind: "message", body: text,
  });
  if (error) return { ok: false, error: "Message not sent." };
  await notifyTableGuest(guestId, {
    fr: { title: "Message du restaurant", body: text },
    en: { title: "Message from the restaurant", body: text },
  }, false);
  revalidatePath("/m/table-order");
  return { ok: true };
}

export async function saveGuestDiningPush(raw: string, input: { endpoint: string; p256dh: string; auth: string }): Promise<DiningAction> {
  const ctx = await guestContext(raw);
  const session = Array.isArray(ctx?.dining_sessions) ? ctx?.dining_sessions[0] : ctx?.dining_sessions;
  if (!ctx || !session || !["pending", "approved"].includes(ctx.status) || !["awaiting_staff", "open", "payment_requested"].includes(session.status)) {
    return { ok: false, error: "Your table visit is not active." };
  }
  const endpoint = input.endpoint.trim();
  if (!endpoint.startsWith("https://") || endpoint.length > 2048 ||
      !/^[A-Za-z0-9_+/=-]{40,}$/.test(input.p256dh) ||
      !/^[A-Za-z0-9_+/=-]{8,}$/.test(input.auth)) {
    return { ok: false, error: "Invalid browser subscription." };
  }
  const limited = await rateLimit({ key: "dining:push", identifier: ctx.id, limit: 10, windowMs: 60 * 60_000 });
  if (!limited.ok) return { ok: false, error: "Please try again later." };
  const { error } = await createAdminClient().from("dining_guest_push_subscriptions")
    .upsert({ guest_id: ctx.id, endpoint, p256dh: input.p256dh, auth: input.auth, updated_at: new Date().toISOString() }, { onConflict: "endpoint" });
  if (error) {
    console.error("[dining:guest-push]", error.message);
    return { ok: false, error: "Could not enable table alerts." };
  }
  return { ok: true };
}

export async function requestGuestDiningPayment(raw: string): Promise<DiningAction> {
  const ctx = await guestContext(raw);
  const session = Array.isArray(ctx?.dining_sessions) ? ctx?.dining_sessions[0] : ctx?.dining_sessions;
  if (!ctx || ctx.status !== "approved" || !session || !canGuestUseDiningSession(ctx.status, session.status)) {
    return { ok: false, error: "This table visit is not active." };
  }
  const limited = await rateLimit({ key: "dining:checkout", identifier: ctx.id, limit: 4, windowMs: 10 * 60_000 });
  if (!limited.ok) return { ok: false, error: "Please wait before trying again." };
  const { error } = await createAdminClient().rpc("guest_request_dining_payment", { p_token_hash: hash(raw) });
  if (error) {
    console.error("[dining:guest-checkout]", error.message);
    return { ok: false, error: error.message.includes("items_pending")
      ? "Wait until the restaurant answers every dish before paying."
      : "Could not prepare online payment. Ask a waiter for help." };
  }
  await notifyDiningStaff(session.id, "message", ctx.display_name, "Guest chose online payment.");
  return { ok: true };
}

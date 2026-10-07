import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ balance: vi.fn(), rpc: vi.fn(), read: vi.fn(), mode: vi.fn(), provider: vi.fn(), send: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.audit }));
vi.mock("@/lib/data/settings", () => ({ getWithdrawalFeeConfig: async () => ({ enabled: true, percent: 5 }) }));
vi.mock("@/lib/data/billing", () => ({ paymentMode: mocks.mode }));
vi.mock("@/lib/payments/gateway", () => ({ payoutGateway: mocks.provider, gatewayRange: () => ({ min: 500, max: 500_000 }), sendGatewayPayout: mocks.send }));
vi.mock("@/lib/payments/camerpay/client", () => ({ normalisePhone: (phone: string) => phone, recordWithdrawalFee: vi.fn() }));
vi.mock("@/lib/payments/camerpay/balance", () => ({ readCamerPayBalance: mocks.balance }));
vi.mock("@/lib/payments/recipient", () => ({ requireConfirmedRecipient: async () => ({ ok: true, name: "Holder" }) }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }) }) }) }));
import { executeWithdrawal, type Translate } from "./withdraw-execute";
const run = () => executeWithdrawal("request", { id: "owner", email: "owner@example.test", role: "manager" }, ((key: string) => key) as Translate, "restaurant", { verifiedName: "Holder" });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue({ data: { id: "request", restaurant_id: "restaurant", amount: 2000, phone: "699123456", status: "pending", note: null } });
  mocks.mode.mockResolvedValue("live"); mocks.provider.mockResolvedValue("camerpay");
  mocks.balance.mockResolvedValue(2000); mocks.rpc.mockResolvedValue({ data: false, error: null });
});
describe("platform liquidity check before restaurant withdrawal", () => {
  it("leaves the wallet and request untouched when CamerPay cannot cover the net payout", async () => {
    mocks.balance.mockResolvedValue(1899);
    expect(await run()).toMatchObject({ ok: false, reason: "platformFundingNeeded" });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "wallet.withdrawal_funding_needed" }));
  });
  it("leaves the wallet untouched when gateway balance is unknown", async () => {
    mocks.balance.mockResolvedValue(null);
    expect(await run()).toMatchObject({ ok: false, reason: "providerBalanceUnavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("uses the payable net amount and still requires the atomic authorization claim", async () => {
    mocks.balance.mockResolvedValue(1900); await run();
    expect(mocks.rpc).toHaveBeenCalledWith("claim_withdrawal_secure", { p_request_id: "request", p_actor_id: "owner" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(["sandbox", "saspay"])("does not apply the CamerPay balance to %s payouts", async (kind) => {
    if (kind === "sandbox") mocks.mode.mockResolvedValue("sandbox");
    else mocks.provider.mockResolvedValue("saspay");
    await run(); expect(mocks.balance).not.toHaveBeenCalled(); expect(mocks.rpc).toHaveBeenCalled();
  });
});

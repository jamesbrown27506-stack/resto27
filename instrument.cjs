const orig = globalThis.fetch;
globalThis.fetch = async function (...args) {
  const raw = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
  if (raw.includes("supabase.co")) {
    try { process.stderr.write(`[SB] ${new URL(raw).pathname.replace("/rest/v1/", "")}\n`); }
    catch { process.stderr.write("[SB] ?\n"); }
  }
  return orig.apply(this, args);
};

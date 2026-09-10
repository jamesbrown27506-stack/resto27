import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim().toUpperCase();
  const appId = teamId && /^[A-Z0-9]{10}$/.test(teamId)
    ? `${teamId}.online.resto237.app`
    : null;

  return NextResponse.json({
    applinks: {
      apps: [],
      details: appId ? [{ appIDs: [appId], components: [{ "/": "/*" }] }] : [],
    },
  });
}

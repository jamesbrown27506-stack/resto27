import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { absoluteUrl } from "@/lib/site-url";
import { getTableLanding } from "@/lib/data/dining-actions";
export async function GET(_request:Request,{params}:{params:Promise<{token:string}>}){const{token}=await params;const table=await getTableLanding(token);if(!table)return new NextResponse("Not found",{status:404});const svg=await QRCode.toString(await absoluteUrl(`/table/${token}`),{type:"svg",errorCorrectionLevel:"M",margin:2,width:720,color:{dark:"#121712",light:"#ffffff"}});return new NextResponse(svg,{headers:{"Content-Type":"image/svg+xml","Content-Disposition":`inline; filename=table-${table.table.number}.svg`,"Cache-Control":"private, max-age=300","X-Content-Type-Options":"nosniff"}});}

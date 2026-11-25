import { NextResponse } from "next/server";

export function GET() {
  return new NextResponse("Not Found", { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } });
}

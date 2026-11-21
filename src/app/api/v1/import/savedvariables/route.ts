import { NextRequest, NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/db";
import { importSavedVariablesToDb } from "@/ingestion/on-demand-hydrator";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  try {
    let luaContent = "";
    let marketId = "us:0";
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const marketField = form.get("marketId");
      if (typeof marketField === "string" && marketField.trim()) {
        marketId = marketField.trim();
      }
      if (file instanceof File) {
        luaContent = await file.text();
      } else if (typeof file === "string") {
        luaContent = file;
      }
    } else {
      const body = (await request.json()) as {
        luaContent?: string;
        marketId?: string;
      };
      luaContent = body.luaContent ?? "";
      if (body.marketId) marketId = body.marketId;
    }

    if (!luaContent.trim()) {
      return NextResponse.json(
        { error: "No SavedVariables .lua content provided" },
        { status: 400 }
      );
    }

    const summary = await importSavedVariablesToDb(luaContent, marketId);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to parse or import SavedVariables file",
      },
      { status: 400 }
    );
  }
}

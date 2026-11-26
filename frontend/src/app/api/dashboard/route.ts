import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL;

    if (!backendUrl) {
      throw new Error("BACKEND_URL não configurada");
    }

    const response = await fetch(
      `${backendUrl.replace(/\/+$/, "")}/dashboard`,
      {
        headers: {
          cookie: request.headers.get("cookie") ?? "",
        },
        cache: "no-store",
      }
    );

    const contentType =
      response.headers.get("content-type") ?? "application/json";

    const body = await response.text();

    return new NextResponse(body, {
      status: response.status,
      headers: {
        "content-type": contentType,
      },
    });
  } catch (error) {
    console.error("[Dashboard API]", error);

    return NextResponse.json(
      {
        message: "Erro ao consultar o dashboard",
      },
      { status: 500 }
    );
  }
}
import { NextResponse } from "next/server";

import {
  emptyStockFeatureBoard,
  loadStockFeatureBoard,
  processStockFeatureUploads,
  STOCK_BOARD_MAX_FILES,
  stockBoardAdminOk,
  type UploadedWorkbook,
} from "@/lib/stockFeatureBoard";
import { r2Configured } from "@/lib/r2";
import { siteAdminConfigured } from "@/lib/siteAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function unauthorized() {
  return NextResponse.json(
    emptyStockFeatureBoard("관리자만 종목보드를 볼 수 있습니다."),
    { status: 401 },
  );
}

export async function GET(request: Request) {
  if (!siteAdminConfigured()) {
    return NextResponse.json(
      emptyStockFeatureBoard("관리자 비밀번호가 설정되지 않았습니다."),
      { status: 503 },
    );
  }
  if (!stockBoardAdminOk(request)) return unauthorized();

  try {
    const cached = await loadStockFeatureBoard();
    if (cached) return NextResponse.json(cached);
    return NextResponse.json(
      emptyStockFeatureBoard(
        "아직 업로드된 종목보드가 없습니다. 아래에서 xlsx를 올려 주세요.",
      ),
    );
  } catch (exc) {
    return NextResponse.json(
      emptyStockFeatureBoard(
        exc instanceof Error ? exc.message : "종목보드 로드 실패",
      ),
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!r2Configured()) {
    return NextResponse.json(
      emptyStockFeatureBoard("저장소(R2)가 설정되지 않았습니다."),
      { status: 503 },
    );
  }
  if (!siteAdminConfigured()) {
    return NextResponse.json(
      emptyStockFeatureBoard("관리자 비밀번호가 설정되지 않았습니다."),
      { status: 503 },
    );
  }
  if (!stockBoardAdminOk(request)) return unauthorized();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      emptyStockFeatureBoard("업로드 형식이 올바르지 않습니다."),
      { status: 400 },
    );
  }

  const files: UploadedWorkbook[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("file")) continue;
    if (!(value instanceof File)) continue;
    const name = value.name || "upload.xlsx";
    if (!/\.xlsx$/i.test(name)) {
      return NextResponse.json(
        emptyStockFeatureBoard(`${name}: .xlsx만 지원합니다.`),
        { status: 400 },
      );
    }
    const ab = await value.arrayBuffer();
    files.push({ filename: name, buffer: Buffer.from(ab) });
    if (files.length > STOCK_BOARD_MAX_FILES) break;
  }

  if (!files.length) {
    return NextResponse.json(
      emptyStockFeatureBoard("xlsx 파일을 1~4개 선택해 주세요."),
      { status: 400 },
    );
  }

  try {
    const board = await processStockFeatureUploads(files);
    const status = board.ok ? 200 : 400;
    return NextResponse.json(board, { status });
  } catch (exc) {
    return NextResponse.json(
      emptyStockFeatureBoard(
        exc instanceof Error ? exc.message : "처리 실패",
      ),
      { status: 500 },
    );
  }
}

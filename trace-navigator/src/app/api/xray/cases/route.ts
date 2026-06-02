import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { requireApiSession } from '@/lib/api-auth';
import { saveCase, listCases, getUploadsPath, type XrayCase } from '@/lib/xray/case-store';
import { runXrayIRG } from '@/lib/xray/irg-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** GET /api/xray/cases — list all X-ray cases */
export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json({ cases: listCases() });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to list cases', details: String(error) }, { status: 500 });
  }
}

/** POST /api/xray/cases — upload image(s) + run the X-ray IRG */
export async function POST(request: NextRequest) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  try {
    const formData = await request.formData();
    const clinicalQuestion = (formData.get('clinicalQuestion') as string) || '';
    const patientAge = (formData.get('patientAge') as string) || '';
    const patientSymptoms = (formData.get('patientSymptoms') as string) || '';
    const patientHistory = (formData.get('patientHistory') as string) || '';
    const bodyRegion = (formData.get('bodyRegion') as string) || 'chest';
    const modelId = (formData.get('modelId') as string) || 'mock/canned-responses';
    const imageFiles = formData.getAll('images') as File[];

    if (imageFiles.length === 0) {
      const single = formData.get('image') as File | null;
      if (single) imageFiles.push(single);
    }
    if (imageFiles.length === 0) {
      return NextResponse.json({ error: 'No images uploaded' }, { status: 400 });
    }

    const id = randomUUID();
    const uploadsDir = getUploadsPath();
    const imagePaths: string[] = [];
    for (let idx = 0; idx < imageFiles.length; idx++) {
      const file = imageFiles[idx];
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const filename = imageFiles.length === 1 ? `${id}.${ext}` : `${id}_${idx}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      writeFileSync(join(uploadsDir, filename), buffer);
      imagePaths.push(`/xray-uploads/${filename}`);
    }

    const xrayCase: XrayCase = {
      id, clinicalQuestion, patientAge, patientSymptoms, patientHistory, bodyRegion,
      modelId, imagePaths, imagePath: imagePaths[0],
      createdAt: new Date().toISOString(), status: 'processing',
    };
    saveCase(xrayCase);

    // Run the IRG without blocking the response; the case page polls for completion.
    runIRG(xrayCase).catch((err) => {
      console.error(`[xray-IRG] case ${id} failed:`, err);
      xrayCase.status = 'error';
      xrayCase.error = String(err);
      saveCase(xrayCase);
    });

    return NextResponse.json({ case: xrayCase });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to create case', details: String(error) }, { status: 500 });
  }
}

async function runIRG(xrayCase: XrayCase) {
  const result = await runXrayIRG({
    clinicalQuestion: xrayCase.clinicalQuestion,
    patientAge: xrayCase.patientAge,
    patientSymptoms: xrayCase.patientSymptoms,
    patientHistory: xrayCase.patientHistory,
    bodyRegion: xrayCase.bodyRegion,
    imagePaths: xrayCase.imagePaths,
    modelId: xrayCase.modelId || 'mock/canned-responses',
  });
  xrayCase.status = 'completed';
  xrayCase.terminationState = result.terminationState;
  xrayCase.report = result.report;
  xrayCase.provenance = result.provenance;
  xrayCase.trace = {
    history: result.history,
    nodes: result.nodes,
    hypotheses: result.hypotheses,
    metrics: result.metrics,
    iteration: result.iteration,
    terminationState: result.terminationState,
  };
  saveCase(xrayCase);
}

import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { requireApiSession } from '@/lib/api-auth';
import { cleanAllRevisedResponses } from '@/lib/response-cleaner';
import { getRequiredServerEnv } from '@/lib/server-env';
import { extractTraceResponse } from '@/lib/trace-response';
import { traceNavigatorRequestDefaults } from '@/lib/runtime-defaults';

export async function POST(request: NextRequest) {
  try {
    const unauthorized = await requireApiSession();
    if (unauthorized) {
      return unauthorized;
    }

    const body = await request.json();

    const irgEndpoint = getRequiredServerEnv('IRG_ENDPOINT');
    console.log(`API invoked: ${irgEndpoint}`);

    // Call the IRG endpoint
    const irgResponse = await fetch(
      irgEndpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: body.query || traceNavigatorRequestDefaults.query,
          context: body.context || traceNavigatorRequestDefaults.context,
          graph: body.graph || traceNavigatorRequestDefaults.graph,
          maxIterations: body.maxIterations || traceNavigatorRequestDefaults.maxIterations,
          confidenceThreshold: body.confidenceThreshold || traceNavigatorRequestDefaults.confidenceThreshold,
          provider: body.provider,
          model: body.model || traceNavigatorRequestDefaults.model,
          maxTokens: body.maxTokens || traceNavigatorRequestDefaults.maxTokens,
          enableFactCheck: body.enableFactCheck !== false,
          enableImpactPrediction: body.enableImpactPrediction !== false,
          enableAssessor: body.enableAssessor !== false,
          // enableFactCheckPipeline intentionally NOT forwarded —
          // the IRG server derives it from the `graph` field. See
          // irg-api-server.js for the source of truth.
        }),
      }
    );

    // Check if response is ok
    if (!irgResponse.ok) {
      const errorText = await irgResponse.text();
      throw new Error(`IRG webhook returned ${irgResponse.status}: ${errorText}`);
    }

    // Get response text first to debug
    const responseText = await irgResponse.text();
    if (!responseText) {
      throw new Error('IRG webhook returned empty response');
    }

    // Always parse as JSON (workflow now always sends JSON)
    console.log('Parsing response as JSON');
    let traceData;
    try {
      traceData = JSON.parse(responseText);
      console.log('✅ JSON parsed successfully');
    } catch (parseError) {
      throw new Error(`Failed to parse IRG response as JSON: ${responseText.substring(0, 200)}`);
    }

    // Clean up malformed revised_response fields from IRG endpoint
    // Uses unified cleaner utility that handles:
    // - XML wrapper tags (<json_response>, <revised_response>)
    // - Double-encoded JSON strings
    // - Literal newlines in JSON strings
    // - Analysis sections bleeding into response fields
    traceData = cleanAllRevisedResponses(traceData);

    if (!traceData.draft_response) {
      const extractedResponse = extractTraceResponse(traceData);
      if (extractedResponse) {
        traceData.draft_response = extractedResponse;
      }
    }

    // Save trace to file (JSON format only)
    const tracesDir = join(process.cwd(), 'traces');
    mkdirSync(tracesDir, { recursive: true });

    // Generate ISO format filename: YYYY-MM-DD--HH:MM:SS.irg
    const now = new Date();
    const isoDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const isoTime = now.toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
    const filename = `${isoDate}--${isoTime}.irg`;
    const filepath = join(tracesDir, filename);

    // Save as JSON
    console.log('Saving trace as JSON');
    writeFileSync(filepath, JSON.stringify(traceData, null, 2));

    return NextResponse.json({
      success: true,
      trace: traceData,
      filename,
      savedAt: filepath,
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to process trace', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const unauthorized = await requireApiSession();
    if (unauthorized) {
      return unauthorized;
    }

    const fs = require('fs');
    const tracesDir = join(process.cwd(), 'traces');

    // Create directory if it doesn't exist
    if (!fs.existsSync(tracesDir)) {
      mkdirSync(tracesDir, { recursive: true });
      return NextResponse.json({ traces: [] });
    }

    // List all trace files
    const files = fs.readdirSync(tracesDir);
    const traces = files
      .filter((f: string) => f.endsWith('.irg') || f.endsWith('.json') || f.endsWith('.yaml'))
      // Sort filenames (newest first) BEFORE mapping to objects — calling
      // .sort() on an array of objects uses the default string comparator
      // ("[object Object]") and does nothing.
      .sort((a: string, b: string) => b.localeCompare(a))
      .map((f: string) => ({
        filename: f,
        path: `/traces/${f}`,
      }));

    return NextResponse.json({ traces });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to list traces', details: String(error) },
      { status: 500 }
    );
  }
}


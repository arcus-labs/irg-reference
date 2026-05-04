import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { requireApiSession } from '@/lib/api-auth';
import { cleanAllRevisedResponses } from '@/lib/response-cleaner';
import { extractTraceResponse } from '@/lib/trace-response';

// Helper function to unescape markdown content
function unescapeMarkdown(text: string): string {
  if (typeof text !== 'string') return text;
  // The JSON file has \\n, \\-, etc. which become \n, \-, etc. after JSON parsing
  // We need to convert these back to actual newlines and remove the backslashes
  return text
    .replace(/\\n/g, '\n')           // \n -> newline
    .replace(/\\-/g, '-')             // \- -> -
    .replace(/\\\*/g, '*')            // \* -> *
    .replace(/\\\[/g, '[')            // \[ -> [
    .replace(/\\\]/g, ']')            // \] -> ]
    .replace(/\\#/g, '#')             // \# -> #
    .replace(/\\"/g, '"')             // \" -> "
    .replace(/\\([a-zA-Z])/g, '$1')   // \X -> X (remove backslash before any letter)
    .replace(/\\\\/g, '\\');          // \\ -> \
}

// Helper function to recursively unescape all string values in an object
function unescapeObject(obj: any, skipKeys: Set<string> = new Set()): any {
  if (typeof obj === 'string') {
    return unescapeMarkdown(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => unescapeObject(item, skipKeys));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const key in obj) {
      // Skip unescaping for certain fields that contain JSON
      if (skipKeys.has(key)) {
        result[key] = obj[key];
      } else {
        result[key] = unescapeObject(obj[key], skipKeys);
      }
    }
    return result;
  }
  return obj;
}

// Helper function to normalize trace entries
// Flattens node_id and node_type objects into flat properties
function normalizeTraceEntry(entry: any): any {
  if (!entry) return entry;

  const normalized = { ...entry };

  // If node_id is an object, flatten it
  if (normalized.node_id && typeof normalized.node_id === 'object') {
    const nodeIdObj = normalized.node_id;
    normalized.id = nodeIdObj.id;
    normalized.type = nodeIdObj.type;
    normalized.goal = nodeIdObj.goal;
    normalized.content = nodeIdObj.content;
    normalized.raw_output = nodeIdObj.raw_output;
    normalized.status = nodeIdObj.status;
    normalized.confidence = nodeIdObj.confidence;
    normalized.timestamp = nodeIdObj.timestamp || normalized.timestamp;
    delete normalized.node_id;
  }

  // If node_type is an object, flatten it (overwrite with node_type data if present)
  if (normalized.node_type && typeof normalized.node_type === 'object') {
    const nodeTypeObj = normalized.node_type;
    normalized.id = nodeTypeObj.id;
    normalized.type = nodeTypeObj.type;
    normalized.goal = nodeTypeObj.goal;
    normalized.content = nodeTypeObj.content;
    normalized.raw_output = nodeTypeObj.raw_output;
    normalized.status = nodeTypeObj.status;
    normalized.confidence = nodeTypeObj.confidence;
    normalized.timestamp = nodeTypeObj.timestamp || normalized.timestamp;
    delete normalized.node_type;
  }

  return normalized;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const unauthorized = await requireApiSession();
    if (unauthorized) {
      return unauthorized;
    }

    let { filename } = await params;

    // Decode the filename (handles URL-encoded characters like %3A for colons)
    filename = decodeURIComponent(filename);

    // Validate filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/')) {
      return NextResponse.json(
        { error: 'Invalid filename' },
        { status: 400 }
      );
    }

    const tracesDir = join(process.cwd(), 'traces');
    const filepath = join(tracesDir, filename);

    // Read the trace file (JSON format only)
    const fileContent = readFileSync(filepath, 'utf-8');
    const traceData = JSON.parse(fileContent);

    // Clean up malformed revised_response fields from IRG endpoint BEFORE unescaping
    // Uses unified cleaner utility that handles all wrapping issues

    // Parse the response field if it's a JSON string
    if (typeof traceData.response === 'string') {
      try {
        // Try to parse as JSON first
        let parsedResponse = JSON.parse(traceData.response);
        // Unescape all content in the response
        traceData.response = unescapeObject(parsedResponse);
      } catch (e) {
        // If JSON parsing fails, manually extract revised_response
        // The response is a JSON string with actual newlines in it
        const responseStr = traceData.response;
        const startIdx = responseStr.indexOf('"revised_response": "');

        if (startIdx !== -1) {
          const contentStart = startIdx + '"revised_response": "'.length;
          let contentEnd = contentStart;

          // Find the closing quote (not escaped)
          while (contentEnd < responseStr.length) {
            if (responseStr[contentEnd] === '"' && responseStr[contentEnd - 1] !== '\\') {
              break;
            }
            contentEnd++;
          }

          let revised = responseStr.substring(contentStart, contentEnd);
          revised = unescapeMarkdown(revised);

          traceData.response = { revised_response: revised };
        }
      }
    }

    // Unescape all trace nodes, normalize them, then clean them
    if (Array.isArray(traceData.trace)) {
      traceData.trace = traceData.trace.map((node: any) => {
        // First normalize the trace entry (flatten node_id and node_type objects)
        let normalizedNode = normalizeTraceEntry(node);
        // Unescape all fields except raw_output (which contains JSON that needs to stay escaped)
        const skipKeys = new Set(['raw_output']);
        const unescapedNode = unescapeObject(normalizedNode, skipKeys);
        // Then clean up the revised_response fields using unified cleaner
        return cleanAllRevisedResponses(unescapedNode);
      });
    }

    if (!traceData.draft_response) {
      const extractedResponse = extractTraceResponse(traceData);
      if (extractedResponse) {
        traceData.draft_response = extractedResponse;
      }
    }

    return NextResponse.json(traceData);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to load trace', details: String(error) },
      { status: 500 }
    );
  }
}


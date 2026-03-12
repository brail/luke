import { NextRequest, NextResponse } from 'next/server';

import { buildApiUrl } from '@luke/core';

import { auth } from '../../../../auth';

// Allow only safe path segments: alphanumeric, dots, dashes, underscores
// Rejects '..' traversal and any segment with shell-special characters
const SAFE_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Require authentication to prevent unauthenticated SSRF via this proxy
  const session = await auth();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const resolvedParams = await params;
    const segments = resolvedParams.path;

    // Validate each segment to prevent path traversal attacks
    if (
      segments.length === 0 ||
      segments.some(seg => !SAFE_SEGMENT_RE.test(seg))
    ) {
      return new NextResponse('Bad Request', { status: 400 });
    }

    const filePath = segments.join('/');
    const backendUrl = buildApiUrl(`/uploads/${filePath}`);

    // Do NOT forward client cookies to the internal backend service
    const response = await fetch(backendUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      return new NextResponse('File not found', { status: 404 });
    }

    const fileBuffer = await response.arrayBuffer();
    const contentType =
      response.headers.get('content-type') || 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Proxy file error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

import { NextResponse } from 'next/server';

import { buildApiUrl } from '@luke/core';

import { auth } from '../../../../auth';
import { debugError } from '../../../../lib/debug';

// Allow only safe path segments: alphanumeric, dots, dashes, underscores
// Rejects '..' traversal and any segment with shell-special characters
const SAFE_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

export const GET = auth(async function GET(req) {
  if (!req.auth) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const url = new URL(req.url);
    // Strip leading '/api/uploads/' prefix to get the path segments
    const pathSegments = url.pathname.replace(/^\/api\/uploads\//, '').split('/').filter(Boolean);

    // Validate each segment to prevent path traversal attacks
    if (
      pathSegments.length === 0 ||
      pathSegments.some(seg => !SAFE_SEGMENT_RE.test(seg))
    ) {
      return new NextResponse('Bad Request', { status: 400 });
    }

    const filePath = pathSegments.join('/');
    const backendUrl = buildApiUrl(`/uploads/${filePath}`);

    // Do NOT forward client cookies to the internal backend service
    const response = await fetch(backendUrl, { method: 'GET' });

    if (!response.ok) {
      return new NextResponse('File not found', { status: 404 });
    }

    const fileBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    debugError('Proxy file error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
});

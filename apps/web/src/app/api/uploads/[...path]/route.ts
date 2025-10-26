import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolvedParams = await params;
    const filePath = resolvedParams.path.join('/');

    // URL dell'API backend
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const backendUrl = `${apiUrl}/uploads/${filePath}`;

    // Inoltra la richiesta al backend per ottenere il file
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        // Inoltra i cookie di sessione per l'autenticazione se necessario
        Cookie: request.headers.get('cookie') || '',
      },
    });

    if (!response.ok) {
      return new NextResponse('File not found', { status: 404 });
    }

    // Ottieni il contenuto del file
    const fileBuffer = await response.arrayBuffer();
    const contentType =
      response.headers.get('content-type') || 'application/octet-stream';

    // Restituisci il file con gli header appropriati
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable', // Cache per 1 anno
      },
    });
  } catch (error) {
    console.error('Proxy file error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

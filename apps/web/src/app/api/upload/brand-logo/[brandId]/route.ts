import { NextRequest, NextResponse } from 'next/server';

import { auth } from '../../../../../auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
) {
  try {
    // Verifica autenticazione
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Autenticazione richiesta' },
        { status: 401 }
      );
    }

    // Ottieni il FormData dalla richiesta
    const formData = await request.formData();

    // URL dell'API backend
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const resolvedParams = await params;
    const backendUrl = `${apiUrl}/upload/brand-logo/${resolvedParams.brandId}`;

    // Genera trace-id per correlazione log
    const traceId =
      crypto.randomUUID?.() ||
      Math.random().toString(36).substring(2) + Date.now().toString(36);

    // Inoltra la richiesta al backend
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        // Inoltra i cookie di sessione per l'autenticazione
        Cookie: request.headers.get('cookie') || '',
        // Aggiungi trace-id per correlazione
        'x-luke-trace-id': traceId,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          error: 'Upload failed',
          message: errorData.message || 'Errore durante upload',
        },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    // Log strutturato invece di console.error
    console.error('Proxy upload error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      brandId: (await params).brandId,
    });

    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Errore durante upload' },
      { status: 500 }
    );
  }
}

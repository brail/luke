import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';

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

    // Inoltra la richiesta al backend
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        // Inoltra i cookie di sessione per l'autenticazione
        Cookie: request.headers.get('cookie') || '',
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
    console.error('Proxy upload error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Errore durante upload' },
      { status: 500 }
    );
  }
}

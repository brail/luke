import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { config } from '@/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: { brandId: string } }
) {
  try {
    // Verifica autenticazione
    const session = await getServerSession(config);
    if (!session?.accessToken) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Autenticazione richiesta' },
        { status: 401 }
      );
    }

    // Ottieni il FormData dalla richiesta
    const formData = await request.formData();

    // URL dell'API backend
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const backendUrl = `${apiUrl}/upload/brand-logo/${params.brandId}`;

    // Inoltra la richiesta al backend
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: 'Upload failed', message: errorData.message || 'Errore durante upload' },
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

import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    // Ricostruisci il path dell'immagine
    const imagePath = params.path.join('/');
    
    // URL dell'API backend
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const backendUrl = `${apiUrl}/uploads/${imagePath}`;

    // Inoltra la richiesta al backend
    const response = await fetch(backendUrl);

    if (!response.ok) {
      return new NextResponse('Image not found', { status: 404 });
    }

    // Ottieni i dati dell'immagine
    const imageData = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    // Ritorna l'immagine con i header corretti
    return new NextResponse(imageData, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000', // Cache per 1 anno
      },
    });
  } catch (error) {
    console.error('Proxy image error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

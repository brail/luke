'use client';

import { Calendar, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { toast } from 'sonner';

import { buildApiUrl } from '@luke/core';

import { Button } from '../../../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../components/ui/dropdown-menu';

interface Props {
  seasonId: string;
  brandIds: string[];
  view: 'list' | 'week' | 'month' | 'gantt';
  viewDate: Date;
  disabled?: boolean;
}

async function downloadExport(
  path: string,
  filename: string,
  token: string
): Promise<void> {
  const url = buildApiUrl(path);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Export failed: ${res.status}`);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export function ExportButton({ seasonId, brandIds, view, viewDate, disabled }: Props) {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);

  const handleExport = async (format: 'ical' | 'pdf' | 'xlsx') => {
    const token = session?.accessToken;
    if (!token) {
      toast.error('Sessione scaduta, ricarica la pagina');
      return;
    }

    let qs = `seasonId=${encodeURIComponent(seasonId)}&brandIds=${encodeURIComponent(brandIds.join(','))}`;
    if (format === 'pdf') {
      qs += `&view=${encodeURIComponent(view)}&viewDate=${encodeURIComponent(viewDate.toISOString())}`;
    }
    const path = `/season-calendar/export/${format}?${qs}`;
    const ext = format === 'ical' ? 'ics' : format;
    const filename = `luke-calendar-${seasonId}.${ext}`;

    setLoading(true);
    try {
      await downloadExport(path, filename, token);
    } catch {
      toast.error('Esportazione fallita');
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || loading || !brandIds.length}>
          {loading
            ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Esportando…</>
            : <><Download className="h-4 w-4 mr-1" />Esporta</>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('ical')} disabled={loading}>
          <Calendar className="h-4 w-4 mr-2" />
          iCal (.ics)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('pdf')} disabled={loading}>
          <FileText className="h-4 w-4 mr-2" />
          PDF (.pdf)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('xlsx')} disabled={loading}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Excel (.xlsx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

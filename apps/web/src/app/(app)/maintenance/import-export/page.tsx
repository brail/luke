'use client';

import React, { useState } from 'react';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { trpc } from '../../../../lib/trpc';

const EXPORT_TYPES = [
  { value: 'users', label: 'Utenti' },
  { value: 'config', label: 'Configurazioni' },
  { value: 'audit', label: 'Log di Audit' },
] as const;

export default function MaintenanceImportExportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [exportType, setExportType] = useState<string>('users');
  const [importResult, setImportResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [exportResult, setExportResult] = useState<{
    success: boolean;
    message: string;
    url?: string;
  } | null>(null);

  const importMutation = trpc.integrations.importExport.startImport.useMutation(
    {
      onSuccess: (data: any) => {
        setImportResult(data);
      },
      onError: (error: any) => {
        setImportResult({ success: false, message: error.message });
      },
    }
  );

  const exportMutation = trpc.integrations.importExport.startExport.useMutation(
    {
      onSuccess: (data: any) => {
        setExportResult(data);
      },
      onError: (error: any) => {
        setExportResult({ success: false, message: error.message });
      },
    }
  );

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
  };

  const handleImport = () => {
    if (!selectedFile) {
      alert('Seleziona un file da importare');
      return;
    }

    importMutation.mutate({ filename: selectedFile.name });
  };

  const handleExport = () => {
    exportMutation.mutate({ type: exportType });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import/Export Dati"
        description="Importa ed esporta dati del sistema in formato JSON, CSV o XLSX"
      />

      {/* Sezione Import */}
      <SectionCard
        title="Importa Dati"
        description="Carica file per importare dati nel sistema"
      >
        <div>
          <Label htmlFor="import-file">Seleziona File</Label>
          <Input
            id="import-file"
            type="file"
            onChange={handleFileSelect}
            accept=".json,.csv,.xlsx"
            className="mt-1"
          />
          {selectedFile && (
            <p className="text-sm text-gray-600 mt-2">
              File selezionato: <strong>{selectedFile.name}</strong> (
              {Math.round(selectedFile.size / 1024)} KB)
            </p>
          )}
        </div>

        <Button
          onClick={handleImport}
          disabled={!selectedFile || importMutation.isPending}
          className="w-full"
        >
          {importMutation.isPending ? 'Import in corso...' : 'Avvia Import'}
        </Button>

        {/* Risultato Import */}
        {importResult && (
          <div
            className={`p-4 rounded-md ${
              importResult.success
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            <p className="font-medium">
              {importResult.success ? '✅' : '❌'} {importResult.message}
            </p>
          </div>
        )}
      </SectionCard>

      {/* Sezione Export */}
      <SectionCard
        title="Esporta Dati"
        description="Esporta dati dal sistema in formato JSON"
      >
        <div>
          <Label htmlFor="export-type">Tipo di Dati</Label>
          <select
            id="export-type"
            value={exportType}
            onChange={(e: any) => setExportType(e.target.value)}
            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {EXPORT_TYPES.map((type: any) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <Button
          onClick={handleExport}
          disabled={exportMutation.isPending}
          className="w-full"
        >
          {exportMutation.isPending ? 'Export in corso...' : 'Avvia Export'}
        </Button>

        {/* Risultato Export */}
        {exportResult && (
          <div
            className={`p-4 rounded-md ${
              exportResult.success
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            <p className="font-medium">
              {exportResult.success ? '✅' : '❌'} {exportResult.message}
            </p>
            {exportResult.success && exportResult.url && (
              <div className="mt-3">
                <p className="text-sm mb-2">File pronto per il download:</p>
                <a
                  href={exportResult.url}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  download
                >
                  📥 Scarica File
                </a>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* Note Informative */}
      <SectionCard
        title="Note Importanti"
        description="Informazioni sui formati supportati e limitazioni"
      >
        <div className="space-y-3 text-sm text-gray-600">
          <div>
            <h4 className="font-medium text-gray-900">Formati Supportati:</h4>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>
                <strong>JSON:</strong> Formato nativo per configurazioni e dati
                strutturati
              </li>
              <li>
                <strong>CSV:</strong> Per import/export di utenti e dati
                tabulari
              </li>
              <li>
                <strong>XLSX:</strong> Per file Excel con fogli multipli
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Sicurezza:</h4>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>Tutti i file vengono validati prima dell&apos;import</li>
              <li>Le password e credenziali sensibili sono sempre cifrate</li>
              <li>I file di export contengono solo dati non sensibili</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Limitazioni:</h4>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>Dimensione massima file: 10MB</li>
              <li>Gli export sono disponibili per 24 ore</li>
              <li>L&apos;import sovrascrive i dati esistenti</li>
            </ul>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

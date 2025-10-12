# Roadmap Integrazioni Luke

Questo documento descrive come implementare le integrazioni reali per il sistema Luke, attualmente implementate come placeholder.

## 📋 Stato Attuale

### ✅ Implementato (Scaffolding)

- **Backend**: Router tRPC con namespace `storage`, `mail`, `importExport`
- **Frontend**: Pagine UI per configurazione e test
- **Sicurezza**: Crittografia AES-256-GCM per credenziali sensibili
- **Gestione Errori**: Sistema uniforme con logging sicuro
- **Database**: Salvataggio configurazioni in `AppConfig`

### 🔄 Placeholder Attuali

- `storage.testConnection`: Restituisce sempre successo
- `importExport.startImport`: Log del filename
- `importExport.startExport`: URL dummy

## 🎯 Integrazioni da Implementare

### 1. Storage - SMB/Samba

#### Dipendenze

```bash
pnpm add smb2
pnpm add -D @types/smb2
```

#### Implementazione

```typescript
// apps/api/src/lib/storage/smb.ts
import * as smb2 from 'smb2';

export class SMBStorage {
  private client: smb2;

  constructor(config: SMBConfig) {
    this.client = new smb2({
      share: `\\\\${config.host}\\${config.path}`,
      username: config.username,
      password: config.password,
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.readdir('.');
      return true;
    } catch (error) {
      return false;
    }
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const buffer = await fs.readFile(localPath);
    await this.client.writeFile(remotePath, buffer);
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const buffer = await this.client.readFile(remotePath);
    await fs.writeFile(localPath, buffer);
  }

  async listFiles(path: string = '.'): Promise<string[]> {
    return await this.client.readdir(path);
  }
}
```

#### Aggiornamento Router

```typescript
// apps/api/src/routers/integrations.ts
testConnection: publicProcedure
  .input(z.object({ provider: z.string() }))
  .query(async ({ input, ctx }) => {
    if (input.provider === 'smb') {
      const config = await getSMBConfig(ctx.prisma);
      const smb = new SMBStorage(config);
      const success = await smb.testConnection();

      return {
        success,
        message: success ? 'Connessione SMB OK' : 'Connessione SMB fallita',
      };
    }
    // ... altri provider
  });
```

### 2. Storage - Google Drive

#### Dipendenze

```bash
pnpm add googleapis
pnpm add -D @types/googleapis
```

#### Implementazione

```typescript
// apps/api/src/lib/storage/googleDrive.ts
import { google } from 'googleapis';

export class GoogleDriveStorage {
  private drive: any;

  constructor(config: GoogleDriveConfig) {
    const oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      'http://localhost:3000/auth/google/callback'
    );

    oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
    });

    this.drive = google.drive({ version: 'v3', auth: oauth2Client });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.drive.about.get({ fields: 'user' });
      return true;
    } catch (error) {
      return false;
    }
  }

  async uploadFile(localPath: string, fileName: string): Promise<string> {
    const fileMetadata = { name: fileName };
    const media = {
      mimeType: 'application/octet-stream',
      body: fs.createReadStream(localPath),
    };

    const response = await this.drive.files.create({
      requestBody: fileMetadata,
      media: media,
    });

    return response.data.id;
  }

  async downloadFile(fileId: string, localPath: string): Promise<void> {
    const response = await this.drive.files.get(
      {
        fileId: fileId,
        alt: 'media',
      },
      { responseType: 'stream' }
    );

    const writeStream = fs.createWriteStream(localPath);
    response.data.pipe(writeStream);
  }

  async listFiles(): Promise<any[]> {
    const response = await this.drive.files.list({
      pageSize: 100,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
    });

    return response.data.files;
  }
}
```

#### OAuth Flow

```typescript
// apps/api/src/routers/auth.ts
export const authRouter = router({
  google: router({
    getAuthUrl: publicProcedure.query(() => {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'http://localhost:3000/auth/google/callback'
      );

      const scopes = ['https://www.googleapis.com/auth/drive'];

      return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
      });
    }),

    handleCallback: publicProcedure
      .input(z.object({ code: z.string() }))
      .mutation(async ({ input }) => {
        // Scambia code con refresh token
        // Salva refresh token nel database
      }),
  }),
});
```

### 3. Import/Export - Gestione File

#### Dipendenze

```bash
pnpm add multer
pnpm add csv-parser
pnpm add xlsx
pnpm add -D @types/multer
pnpm add -D @types/csv-parser
```

#### Implementazione

```typescript
// apps/api/src/lib/importExport/fileHandler.ts
import multer from 'multer';
import csv from 'csv-parser';
import * as XLSX from 'xlsx';

export class FileHandler {
  private upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  });

  async processCSV(buffer: Buffer): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      const stream = Readable.from(buffer);

      stream
        .pipe(csv())
        .on('data', data => results.push(data))
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }

  async processExcel(buffer: Buffer): Promise<any[]> {
    const workbook = XLSX.read(buffer);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(worksheet);
  }

  async exportToCSV(data: any[], filename: string): Promise<Buffer> {
    const csv = this.convertToCSV(data);
    return Buffer.from(csv, 'utf-8');
  }

  async exportToExcel(data: any[], filename: string): Promise<Buffer> {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];

    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header];
        return typeof value === 'string' ? `"${value}"` : value;
      });
      csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
  }
}
```

#### Aggiornamento Router

```typescript
// apps/api/src/routers/integrations.ts
importExport: router({
  startImport: publicProcedure
    .input(z.object({
      filename: z.string(),
      fileType: z.enum(['csv', 'xlsx', 'json']),
      data: z.array(z.any()),
    }))
    .mutation(async ({ input, ctx }) => {
      const fileHandler = new FileHandler();

      try {
        // Processa i dati in base al tipo
        let processedData: any[];

        switch (input.fileType) {
          case 'csv':
            processedData = await fileHandler.processCSV(Buffer.from(input.data));
            break;
          case 'xlsx':
            processedData = await fileHandler.processExcel(Buffer.from(input.data));
            break;
          case 'json':
            processedData = input.data;
            break;
        }

        // Salva nel database
        await this.saveImportedData(ctx.prisma, processedData);

        return {
          success: true,
          message: `Importati ${processedData.length} record`,
          count: processedData.length,
        };
      } catch (error) {
        throw toTRPCError(IntegrationErrorHandler.handleImportError(error));
      }
    }),

  startExport: publicProcedure
    .input(z.object({
      type: z.enum(['users', 'config', 'logs']),
      format: z.enum(['csv', 'xlsx', 'json']),
    }))
    .mutation(async ({ input, ctx }) => {
      const fileHandler = new FileHandler();

      try {
        // Recupera i dati dal database
        const data = await this.getExportData(ctx.prisma, input.type);

        // Genera il file
        let fileBuffer: Buffer;
        let filename: string;

        switch (input.format) {
          case 'csv':
            fileBuffer = await fileHandler.exportToCSV(data, `${input.type}.csv`);
            filename = `${input.type}.csv`;
            break;
          case 'xlsx':
            fileBuffer = await fileHandler.exportToExcel(data, `${input.type}.xlsx`);
            filename = `${input.type}.xlsx`;
            break;
          case 'json':
            fileBuffer = Buffer.from(JSON.stringify(data, null, 2));
            filename = `${input.type}.json`;
            break;
        }

        // Salva il file temporaneamente
        const tempPath = `/tmp/${filename}`;
        await fs.writeFile(tempPath, fileBuffer);

        return {
          success: true,
          message: 'Export completato',
          downloadUrl: `/api/download/${filename}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 ore
        };
      } catch (error) {
        throw toTRPCError(IntegrationErrorHandler.handleExportError(error));
      }
    }),
}),
```

## 🔧 Configurazione Avanzata

### Variabili d'Ambiente

```bash
# .env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# SMB
SMB_DEFAULT_HOST=192.168.1.100
SMB_DEFAULT_PATH=shared

# File Upload
MAX_FILE_SIZE=10485760  # 10MB
ALLOWED_FILE_TYPES=csv,xlsx,json
```

### Middleware di Sicurezza

```typescript
// apps/api/src/middleware/security.ts
export const fileUploadSecurity = (req: any, res: any, next: any) => {
  // Verifica tipo file
  // Verifica dimensione
  // Scan antivirus (opzionale)
  // Validazione contenuto
  next();
};
```

## 📊 Monitoraggio e Logging

### Metriche da Tracciare

- Connessioni storage (successo/fallimento)
- Tempo di risposta API
- Dimensione file importati/esportati
- Errori di autenticazione OAuth
- Utilizzo storage (quota Google Drive)

### Dashboard di Monitoraggio

```typescript
// apps/api/src/routers/monitoring.ts
export const monitoringRouter = router({
  metrics: publicProcedure.query(async ({ ctx }) => {
    return {
      storageConnections: await getStorageMetrics(ctx.prisma),
      importExportStats: await getImportExportStats(ctx.prisma),
      systemHealth: await getSystemHealth(),
    };
  }),
});
```

## 🚀 Deployment

### Docker

```dockerfile
# Dockerfile.api
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

### Kubernetes

```yaml
# k8s/api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: luke-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: luke-api
  template:
    metadata:
      labels:
        app: luke-api
    spec:
      containers:
        - name: api
          image: luke/api:latest
          ports:
            - containerPort: 3001
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: luke-secrets
                  key: database-url
```

## 📝 Note di Implementazione

### Priorità

1. **Alta**: SMB Storage (più semplice, no OAuth)
2. **Media**: Import/Export file handling
3. **Bassa**: Google Drive (richiede OAuth setup)

### Considerazioni di Sicurezza

- Tutte le credenziali devono essere cifrate
- File temporanei devono essere puliti automaticamente
- Rate limiting per API OAuth
- Validazione rigorosa dei file upload

### Testing

- Unit test per ogni classe di integrazione
- Integration test con servizi mock
- E2E test per flussi completi
- Load testing per import/export

### Performance

- Caching per connessioni storage
- Streaming per file grandi
- Compressione per export
- Background jobs per operazioni lunghe

---

**Nota**: Questo documento fornisce una roadmap completa per l'implementazione delle integrazioni reali. Ogni sezione può essere implementata indipendentemente seguendo le best practice di sicurezza e performance.

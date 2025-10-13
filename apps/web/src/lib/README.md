# Configurazione Applicazione

## File: `config.ts`

Questo file centralizza la configurazione dell'applicazione Luke, rendendo facile l'accesso a informazioni come versione, nome e ambiente.

### Funzioni disponibili:

#### `getAppInfo()`

Restituisce un oggetto con tutte le informazioni dell'app:

```typescript
{
  version: "1.0.0",
  name: "Luke",
  environment: "development",
  isDevelopment: true,
  isProduction: false,
  displayName: "Luke v1.0.0",
  environmentLabel: "(Development)"
}
```

#### `getLoginDemoText()`

Restituisce il testo completo per la pagina di login:

```
"Demo: inserisci qualsiasi username e password - Luke v1.0.0 (Development)"
```

### Variabili d'ambiente supportate:

- `NEXT_PUBLIC_APP_VERSION`: Versione dell'app (default: "1.0.0")
- `NEXT_PUBLIC_APP_NAME`: Nome dell'app (default: "Luke")
- `NODE_ENV`: Ambiente (development/production/test)

### Esempi di utilizzo:

```typescript
import { getAppInfo, getLoginDemoText } from '@/lib/config';

// In un componente
function MyComponent() {
  const appInfo = getAppInfo();

  return (
    <div>
      <h1>{appInfo.displayName}</h1>
      {appInfo.isDevelopment && <p>Modalità sviluppo</p>}
    </div>
  );
}

// Per il testo di login
function LoginPage() {
  return <p>{getLoginDemoText()}</p>;
}
```

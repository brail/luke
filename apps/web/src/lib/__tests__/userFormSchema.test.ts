import { describe, expect, it } from 'vitest';

import { buildUserPayload, type SyncedField } from '../userFormSchema';

const VALID_PASSWORD = 'TestPassw0rd!23';

const CREATE_FORM = {
  email: 'mario@example.com',
  username: 'mario',
  firstName: 'Mario',
  lastName: 'Rossi',
  password: VALID_PASSWORD,
  confirmPassword: VALID_PASSWORD,
  role: 'editor' as const,
  isActive: true,
};

const EDIT_FORM = { ...CREATE_FORM, password: '', confirmPassword: '' };

/**
 * The identity fields are the ones both modes take from `users.core.create`'s input. If create and
 * edit ever stop agreeing on them, an admin can save through one screen what the other refuses —
 * silently, because each screen is self-consistent.
 */
describe('create ed edit giudicano le identità allo stesso modo', () => {
  const cases: { field: 'email' | 'username' | 'role'; value: unknown }[] = [
    { field: 'email', value: 'non-una-email' },
    { field: 'username', value: 'ab' },
    { field: 'role', value: 'superuser' },
  ];

  for (const { field, value } of cases) {
    it(`rifiuta ${field} non valido in entrambe le modalità`, () => {
      const create = buildUserPayload('create', { ...CREATE_FORM, [field]: value }, []);
      const edit = buildUserPayload('edit', { ...EDIT_FORM, [field]: value }, []);
      expect(create.ok).toBe(false);
      expect(edit.ok).toBe(false);
      if (!create.ok && !edit.ok) {
        expect(Object.keys(create.errors)).toContain(field);
        expect(create.errors[field]).toBe(edit.errors[field]);
      }
    });
  }

  for (const field of ['email', 'username', 'role'] as const) {
    it(`rifiuta ${field} mancante in entrambe le modalità`, () => {
      // Edit deriva da `UpdateUserInputSchema`, dove questi campi sono opzionali perché una update
      // parziale è legittima sul filo. Questo form non è una update parziale: manda ogni campo di
      // una riga. Senza questo test il ribasamento avrebbe reso i tre facoltativi in silenzio.
      const { [field]: _omitted, ...createWithout } = CREATE_FORM;
      const { [field]: _omittedEdit, ...editWithout } = EDIT_FORM;
      expect(buildUserPayload('create', createWithout, []).ok).toBe(false);
      expect(buildUserPayload('edit', editWithout, []).ok).toBe(false);
    });
  }

  it('accetta la stessa identità valida in entrambe le modalità', () => {
    expect(buildUserPayload('create', CREATE_FORM, []).ok).toBe(true);
    expect(buildUserPayload('edit', EDIT_FORM, []).ok).toBe(true);
  });
});

describe('confirmPassword non lascia mai il browser', () => {
  it('non compare nel payload di create', () => {
    const result = buildUserPayload('create', CREATE_FORM, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).not.toHaveProperty('confirmPassword');
  });

  it('non compare nel payload di edit, nemmeno quando la password viene cambiata', () => {
    const result = buildUserPayload('edit', {
      ...EDIT_FORM,
      password: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    }, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).not.toHaveProperty('confirmPassword');
  });
});

describe('in edit una password vuota significa «lascia quella che c’è»', () => {
  it('omette la chiave password invece di mandarla vuota', () => {
    const result = buildUserPayload('edit', EDIT_FORM, []);
    expect(result.ok).toBe(true);
    // Non `password: ''`: il router tratterebbe la chiave presente come una password da hashare.
    if (result.ok) expect('password' in result.payload).toBe(false);
  });

  it('manda la password quando è stata davvero digitata', () => {
    const result = buildUserPayload('edit', {
      ...EDIT_FORM,
      password: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    }, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.password).toBe(VALID_PASSWORD);
  });

  it('rifiuta una conferma compilata quando la password è vuota', () => {
    const result = buildUserPayload('edit', { ...EDIT_FORM, confirmPassword: 'qualcosa' }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.confirmPassword).toBe('Le password non coincidono');
  });

  it('in create la password resta obbligatoria', () => {
    const result = buildUserPayload('create', { ...CREATE_FORM, password: '', confirmPassword: '' }, []);
    expect(result.ok).toBe(false);
    // Sul campo, non sul risultato: con entrambi vuoti anche `confirmPassword` fallisce, quindi
    // `ok === false` da solo resterebbe vero anche se la regola sulla password sparisse.
    if (!result.ok) expect(result.errors.password).toBeDefined();
  });

  it('in create una password sotto il prefiltro viene rifiutata sul suo campo', () => {
    // Il confine lato client è il prefiltro statico, 8 caratteri: è il pavimento sotto cui nessuna
    // configurazione può scendere. La lunghezza minima *effettiva* la decide la policy in AppConfig
    // e oggi la applica solo il server — finché il client non la legge, questo è tutto ciò che il
    // form può sapere, e va detto qui invece che scoperto quando l'utente prende un rifiuto.
    const tooShort = 'Ab1!efg';
    const result = buildUserPayload('create', { ...CREATE_FORM, password: tooShort, confirmPassword: tooShort }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.password).toBeDefined();
  });

  it('il prefiltro non replica la complessità: quella la decide la policy', () => {
    // Otto caratteri senza maiuscole né simboli passano il form e vengono rifiutati dal server.
    // Non è una svista: replicare qui le regex significherebbe riscrivere una regola configurabile
    // in un bundle che non sa come è configurata — il difetto che questo batch chiude.
    const simple = 'abcdefgh';
    const result = buildUserPayload('create', { ...CREATE_FORM, password: simple, confirmPassword: simple }, []);
    expect(result.ok).toBe(true);
  });
});

describe('campi gestiti da un provider esterno', () => {
  it('vengono tolti dal payload', () => {
    const synced: SyncedField[] = ['email', 'username'];
    const result = buildUserPayload('create', CREATE_FORM, synced);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).not.toHaveProperty('email');
      expect(result.payload).not.toHaveProperty('username');
      expect(result.payload.role).toBe('editor');
      expect(result.payload.isActive).toBe(true);
    }
  });

  it('la validazione avviene comunque prima della rimozione', () => {
    // Togliere un campo dal payload non lo rende esente dalle regole: altrimenti un provider
    // esterno mal configurato aprirebbe un varco su ciò che il form accetta.
    const result = buildUserPayload('create', { ...CREATE_FORM, email: 'rotta' }, ['email']);
    expect(result.ok).toBe(false);
    // Il messaggio, non solo l'esito: togliendo il campo prima di validare si otterrebbe comunque
    // un fallimento, ma con «expected string, received undefined». Solo l'ordine giusto dà questo.
    if (!result.ok) expect(result.errors.email).toBe('Email non valida');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  enforceDomainReadOnly,
  listCalendarReaders,
  removeCalendarReader,
  syncCalendarReaders,
} from '../acl.js';

/**
 * The ACL is what keeps a season calendar from being readable by people who should not
 * see it. A reconciliation error raises no exception: it just leaves one reader too many,
 * silently.
 */
const { acl, getWorkspaceDomain } = vi.hoisted(() => ({
  acl: {
    insert: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
  },
  getWorkspaceDomain: vi.fn(() => 'example.com'),
}));

vi.mock('../client.js', () => ({
  getClient: () => ({ acl }),
  getWorkspaceDomain,
}));

/** Builds the `acl.list` response the way the Google API returns it. */
function readersResponse(emails: string[]) {
  return {
    data: {
      items: emails.map(value => ({
        role: 'reader',
        scope: { type: 'user', value },
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  acl.insert.mockResolvedValue({});
  acl.delete.mockResolvedValue({});
  acl.update.mockResolvedValue({});
});

describe('listCalendarReaders', () => {
  it('returns only the reader rules of type user', () => {
    acl.list.mockResolvedValue({
      data: {
        items: [
          { role: 'reader', scope: { type: 'user', value: 'a@example.com' } },
          // Noise that must not end up in the reader list
          { role: 'owner', scope: { type: 'user', value: 'owner@example.com' } },
          { role: 'reader', scope: { type: 'domain', value: 'example.com' } },
          { role: 'reader', scope: { type: 'user' } },
        ],
      },
    });

    return expect(listCalendarReaders('cal-1')).resolves.toEqual([
      'a@example.com',
    ]);
  });

  it('handles a response without items', async () => {
    acl.list.mockResolvedValue({ data: {} });

    await expect(listCalendarReaders('cal-1')).resolves.toEqual([]);
  });
});

describe('syncCalendarReaders', () => {
  it('adds the missing ones and removes the extra ones', async () => {
    acl.list.mockResolvedValue(
      readersResponse(['resta@example.com', 'esce@example.com'])
    );

    await syncCalendarReaders('cal-1', [
      'resta@example.com',
      'entra@example.com',
    ]);

    expect(acl.insert).toHaveBeenCalledTimes(1);
    expect(acl.insert).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      requestBody: {
        role: 'reader',
        scope: { type: 'user', value: 'entra@example.com' },
      },
    });

    expect(acl.delete).toHaveBeenCalledTimes(1);
    expect(acl.delete).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      ruleId: 'user:esce@example.com',
    });
  });

  it('touches nothing when the state already matches', async () => {
    acl.list.mockResolvedValue(readersResponse(['a@example.com']));

    await syncCalendarReaders('cal-1', ['a@example.com']);

    expect(acl.insert).not.toHaveBeenCalled();
    expect(acl.delete).not.toHaveBeenCalled();
  });

  it('empties the readers when the expected list is empty', async () => {
    // Critical case: a function with no members must stay without readers, not keep
    // the previous ones.
    acl.list.mockResolvedValue(
      readersResponse(['a@example.com', 'b@example.com'])
    );

    await syncCalendarReaders('cal-1', []);

    expect(acl.delete).toHaveBeenCalledTimes(2);
    expect(acl.insert).not.toHaveBeenCalled();
  });
});

describe('removeCalendarReader', () => {
  it('is idempotent: a 404 is not an error', async () => {
    // Removing a reader that is already absent is the desired state, not a failure.
    acl.delete.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 404 }));

    await expect(
      removeCalendarReader('cal-1', 'a@example.com')
    ).resolves.toBeUndefined();
  });

  it('propagates errors other than 404', async () => {
    acl.delete.mockRejectedValue(Object.assign(new Error('Boom'), { code: 500 }));

    await expect(
      removeCalendarReader('cal-1', 'a@example.com')
    ).rejects.toThrow('Boom');
  });
});

describe('enforceDomainReadOnly', () => {
  it('downgrades an overly permissive domain rule to freeBusyReader', async () => {
    // Google applies the MOST permissive rule among the matching ones: a domain rule
    // with `writer` would override the per-user `reader` grants.
    acl.get.mockResolvedValue({ data: { role: 'writer' } });

    await enforceDomainReadOnly('cal-1');

    expect(acl.update).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      ruleId: 'domain:example.com',
      requestBody: {
        role: 'freeBusyReader',
        scope: { type: 'domain', value: 'example.com' },
      },
    });
  });

  it.each(['freeBusyReader', 'none'])(
    'does not touch a rule already at %s',
    async role => {
      acl.get.mockResolvedValue({ data: { role } });

      await enforceDomainReadOnly('cal-1');

      expect(acl.update).not.toHaveBeenCalled();
    }
  );

  it('does nothing if the domain rule does not exist', async () => {
    acl.get.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 404 }));

    await expect(enforceDomainReadOnly('cal-1')).resolves.toBeUndefined();
    expect(acl.update).not.toHaveBeenCalled();
  });

  it('propagates errors other than 404', async () => {
    acl.get.mockRejectedValue(Object.assign(new Error('Boom'), { code: 500 }));

    await expect(enforceDomainReadOnly('cal-1')).rejects.toThrow('Boom');
  });
});

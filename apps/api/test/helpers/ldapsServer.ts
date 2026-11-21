/**
 * A directory over TLS for the trusted-certificate tests (#281): a self-signed certificate made the
 * way a domain controller's usually is (a leaf, `CA:FALSE`, no certificate-signing key usage, the
 * host in its SAN), and a TLS server that answers every LDAP bind with success. Nothing else of LDAP
 * is spoken: a test only needs the TLS handshake to be judged, then one bind.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:tls';

import type { AddressInfo } from 'node:net';

/** A self-signed leaf for `localhost`, made by the `openssl` CLI, valid for two days. */
export function selfSignedCertificate(): { key: string; certificate: string } {
  const dir = mkdtempSync(join(tmpdir(), 'luke-ldaps-'));
  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
        '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
        '-subj', '/CN=localhost',
        '-addext', 'subjectAltName=DNS:localhost',
        '-addext', 'basicConstraints=critical,CA:FALSE',
        '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
      ],
      { stdio: 'ignore' }
    );
    return {
      key: readFileSync(join(dir, 'key.pem'), 'utf8'),
      certificate: readFileSync(join(dir, 'cert.pem'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The BindResponse (success) to a BindRequest, with the request's messageID, or `null` for any other
 * message. `LDAPMessage ::= SEQUENCE { messageID INTEGER, protocolOp }`; a BindRequest is
 * `[APPLICATION 0]`, constructed (0x60), and its response `[APPLICATION 1]` (0x61) with
 * `resultCode 0, matchedDN "", diagnosticMessage ""`.
 */
function bindResponseTo(request: Buffer): Buffer | null {
  if (request[0] !== 0x30) return null;
  const lengthByte = request[1] ?? 0;
  const idAt = 2 + (lengthByte & 0x80 ? lengthByte & 0x7f : 0);
  if (request[idAt] !== 0x02) return null;
  const idEnd = idAt + 2 + (request[idAt + 1] ?? 0);
  if (request[idEnd] !== 0x60) return null;
  const body = Buffer.concat([
    request.subarray(idAt, idEnd),
    Buffer.from([0x61, 0x07, 0x0a, 0x01, 0x00, 0x04, 0x00, 0x04, 0x00]),
  ]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

export interface LdapsServer {
  port: number;
  /** The server's certificate, PEM: what an admin pastes into the trusted certificates. */
  certificate: string;
  close: () => Promise<void>;
}

/** Starts the server on an ephemeral port, on every interface (`localhost` may resolve to `::1`). */
export async function startLdapsServer(): Promise<LdapsServer> {
  const { key, certificate } = selfSignedCertificate();
  const server: Server = createServer({ key, cert: certificate }, socket => {
    socket.on('data', data => {
      const response = bindResponseTo(data);
      if (response) socket.write(response);
      else socket.end();
    });
    // A client that refuses the certificate drops the socket mid-handshake.
    socket.on('error', () => undefined);
  });
  server.on('tlsClientError', () => undefined);
  await new Promise<void>(resolve => server.listen(0, resolve));
  return {
    port: (server.address() as AddressInfo).port,
    certificate,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

// 自签证书：只生成一次，落在 .certs/（已 gitignore）。
// CN=localtest.me，SAN 覆盖 *.localtest.me / localtest.me / localhost。
// puppeteer 侧带 --ignore-certificate-errors，所以证书不需要进系统信任链。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CERT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.certs');

/**
 * 确保 dir 下有 key.pem / cert.pem，没有就用 openssl 生成。
 * @param {string} [dir]
 * @returns {{ key: string, cert: string, keyPath: string, certPath: string }}
 */
export function ensureCerts(dir = DEFAULT_CERT_DIR) {
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');

  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(dir, { recursive: true });
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
        '-subj', '/CN=localtest.me',
        '-addext', 'subjectAltName=DNS:*.localtest.me,DNS:localtest.me,DNS:localhost',
        '-keyout', keyPath,
        '-out', certPath,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  }

  return {
    key: readFileSync(keyPath, 'utf8'),
    cert: readFileSync(certPath, 'utf8'),
    keyPath,
    certPath,
  };
}

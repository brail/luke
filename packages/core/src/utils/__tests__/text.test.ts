import { describe, expect, it } from 'vitest';

import { versionLabel } from '../text.js';

describe('versionLabel', () => {
  it('prefixes one v to a version number', () => {
    expect(versionLabel('3.0.0-rc.1')).toBe('v3.0.0-rc.1');
  });

  it('leaves the dev sentinel bare — never vdev', () => {
    expect(versionLabel('dev')).toBe('dev');
  });

  it('never doubles a v the value already carries', () => {
    expect(versionLabel('v2.1.4')).toBe('v2.1.4');
  });
});

import { describe, expect, it } from 'vitest';
import { gerberZipFilename, panelConfigFilename } from './filename';

describe('panelConfigFilename', () => {
  it('encodes format and hp for the JSON download (#229)', () => {
    expect(panelConfigFilename({ format: '3U', panelHp: 12 })).toBe('zpd-panel-3U-12hp.json');
    expect(panelConfigFilename({ format: '1U', panelHp: 4 })).toBe('zpd-panel-1U-4hp.json');
  });
});

describe('gerberZipFilename', () => {
  it('encodes format, hp, and material for the Gerber zip download (#229)', () => {
    expect(gerberZipFilename({ format: '3U', panelHp: 12, material: 'fr4' })).toBe(
      'zpd-panel-3U-12hp-fr4-gerber.zip',
    );
    expect(gerberZipFilename({ format: '1U', panelHp: 6, material: 'alumi' })).toBe(
      'zpd-panel-1U-6hp-alumi-gerber.zip',
    );
  });
});

import { describe, it, expect } from 'vitest';
import { buildPluginOpenSrc } from './pluginOpenSrc.js';

const base = {
  apiBaseUrl: 'http://homeglow.local:3000',
  filename: 'FamilyLists.html',
  theme: 'dark',
  device: 'kitchen',
  lang: 'en',
};

describe('buildPluginOpenSrc', () => {
  it('keeps the existing theme/device/lang params, in order, on desktop', () => {
    expect(buildPluginOpenSrc({ ...base, isMobile: false })).toBe(
      'http://homeglow.local:3000/widgets/FamilyLists.html?theme=dark&device=kitchen&lang=en',
    );
  });

  it('appends mobile=1, and nothing else, on a narrow viewport', () => {
    expect(buildPluginOpenSrc({ ...base, isMobile: true })).toBe(
      'http://homeglow.local:3000/widgets/FamilyLists.html?theme=dark&device=kitchen&lang=en&mobile=1',
    );
  });

  it('treats a missing isMobile as desktop: no mobile param', () => {
    expect(buildPluginOpenSrc({ ...base })).toBe(
      'http://homeglow.local:3000/widgets/FamilyLists.html?theme=dark&device=kitchen&lang=en',
    );
  });

  it('encodes the filename and device exactly like the Open view did', () => {
    expect(buildPluginOpenSrc({
      ...base,
      filename: 'My Plugin.html',
      device: 'living room',
      isMobile: true,
    })).toBe(
      'http://homeglow.local:3000/widgets/My%20Plugin.html?theme=dark&device=living%20room&lang=en&mobile=1',
    );
  });
});

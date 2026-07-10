import { describe, expect, test } from 'vitest';

// Importing the classic script runs it against the jsdom window and exposes the
// helpers on window.RealUnitPlatform without any side effects.
import '../public/js/lib/platform-core.js';

const { detectPlatform } = window.RealUnitPlatform;

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0';

describe('detectPlatform', () => {
  test('classifies an Android user-agent as android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile';
    expect(detectPlatform(ua, 5)).toBe('android');
  });

  test('classifies iPhone / iPad / iPod user-agents as ios', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (iPod touch; CPU iPhone OS 17_0 like Mac OS X)', 0)).toBe(
      'ios',
    );
  });

  test('treats a Macintosh UA with more than one touch point as iPadOS (ios)', () => {
    expect(detectPlatform(MAC_UA, 5)).toBe('ios');
  });

  test('a Macintosh UA without enough touch points is desktop (null)', () => {
    expect(detectPlatform(MAC_UA, 1)).toBeNull();
    expect(detectPlatform(MAC_UA, 0)).toBeNull();
  });

  test('a plain desktop user-agent is null', () => {
    expect(detectPlatform(WINDOWS_UA, 0)).toBeNull();
  });
});

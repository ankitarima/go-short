import { describe, expect, it } from 'vitest';
import { Hasher, parseUserAgent, primaryLanguage, referrerHost, utcDay } from '../src/enrich';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36',
  firefoxMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
};

describe('parseUserAgent', () => {
  it('classifies devices, browsers and operating systems (major versions only)', () => {
    expect(parseUserAgent(UA.iphone)).toMatchObject({
      device: 'MOBILE',
      browser: 'Safari',
      os: 'iOS',
      osVersion: '17',
      browserVersion: '17',
      isBot: false,
    });
    expect(parseUserAgent(UA.ipad)).toMatchObject({ device: 'TABLET', os: 'iOS', isBot: false });
    expect(parseUserAgent(UA.chromeWin)).toMatchObject({
      device: 'DESKTOP',
      browser: 'Chrome',
      browserVersion: '124',
      os: 'Windows',
      isBot: false,
    });
    expect(parseUserAgent(UA.androidChrome)).toMatchObject({
      device: 'MOBILE',
      browser: 'Chrome',
      os: 'Android',
      osVersion: '14',
      isBot: false,
    });
    expect(parseUserAgent(UA.firefoxMac)).toMatchObject({
      device: 'DESKTOP',
      browser: 'Firefox',
      os: 'macOS',
    });
  });

  it.each([
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['Bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
    [
      'Facebook crawler',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    ],
    ['Slackbot', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['Discordbot', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['Twitterbot', 'Twitterbot/1.0'],
    ['WhatsApp', 'WhatsApp/2.23.20.0'],
    ['curl', 'curl/8.4.0'],
    ['python-requests', 'python-requests/2.31.0'],
    ['missing UA', null],
    ['empty UA', ''],
  ])('flags %s as a bot', (_n, ua) => {
    expect(parseUserAgent(ua).isBot).toBe(true);
  });

  it.each(Object.entries(UA))('does not flag real browser %s', (_n, ua) => {
    expect(parseUserAgent(ua).isBot).toBe(false);
  });

  it('survives garbage without throwing', () => {
    for (const ua of ['x', '\u0000\u0001', 'a'.repeat(5000), '((((('])
      expect(() => parseUserAgent(ua)).not.toThrow();
  });
});

describe('referrerHost', () => {
  it('keeps only the lowercase host, without www and without path/query secrets', () => {
    expect(referrerHost('https://WWW.News.Example.com/a/b?token=secret#x')).toBe(
      'news.example.com',
    );
    expect(referrerHost('http://t.co/abc')).toBe('t.co');
  });
  it('rejects absent, malformed and non-http referrers', () => {
    for (const r of [
      null,
      '',
      'not a url',
      'android-app://com.google.android.gm',
      'javascript:alert(1)',
      'data:text/html,x',
    ]) {
      expect(referrerHost(r)).toBeNull();
    }
  });
});

describe('primaryLanguage', () => {
  it('takes the first tag and validates it', () => {
    expect(primaryLanguage('en-IN,en;q=0.9,hi;q=0.8')).toBe('en-IN');
    expect(primaryLanguage('fr')).toBe('fr');
    expect(primaryLanguage('*')).toBeNull();
    expect(primaryLanguage('<script>')).toBeNull();
    expect(primaryLanguage(null)).toBeNull();
  });
});

describe('Hasher (privacy-preserving ids)', () => {
  const h = new Hasher('test-secret-test-secret-test-secret');
  const day = '2026-10-01';
  it('is deterministic within a day and never contains the IP', () => {
    const v = h.visitorHash(day, '203.0.113.9', 'UA');
    expect(v).toBe(h.visitorHash(day, '203.0.113.9', 'UA'));
    expect(v).toMatch(/^[0-9a-f]{32}$/);
    expect(h.ipHash(day, '203.0.113.9')).toMatch(/^[0-9a-f]{32}$/);
    expect(v + h.ipHash(day, '203.0.113.9')).not.toContain('203');
  });
  it('rotates daily, so a visitor cannot be linked across days', () => {
    expect(h.visitorHash('2026-10-01', '1.2.3.4', 'UA')).not.toBe(
      h.visitorHash('2026-10-02', '1.2.3.4', 'UA'),
    );
    expect(h.ipHash('2026-10-01', '1.2.3.4')).not.toBe(h.ipHash('2026-10-02', '1.2.3.4'));
  });
  it('differs by IP and by user agent, and by secret', () => {
    const base = h.visitorHash(day, '1.2.3.4', 'UA');
    expect(h.visitorHash(day, '1.2.3.5', 'UA')).not.toBe(base);
    expect(h.visitorHash(day, '1.2.3.4', 'UA2')).not.toBe(base);
    expect(
      new Hasher('another-secret-another-secret-xx').visitorHash(day, '1.2.3.4', 'UA'),
    ).not.toBe(base);
  });
  it('visitor and IP hashes of the same input are different values (domain separated)', () => {
    expect(h.visitorHash(day, '1.2.3.4', '')).not.toBe(h.ipHash(day, '1.2.3.4'));
  });
});

describe('utcDay', () => {
  it('uses UTC boundaries', () => {
    expect(utcDay(Date.UTC(2026, 9, 1, 23, 59, 59, 999))).toBe('2026-10-01');
    expect(utcDay(Date.UTC(2026, 9, 2, 0, 0, 0, 0))).toBe('2026-10-02');
  });
});

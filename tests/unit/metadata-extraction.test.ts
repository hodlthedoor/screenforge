import { describe, it, expect } from 'vitest';
import { extractEnhancedMetadata } from '../../src/renderer/metadata.js';
import { JSDOM } from 'jsdom';

describe('extractEnhancedMetadata', () => {
  it('extracts basic metadata from a simple page', async () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <title>Test Page</title>
          <meta name="description" content="A test page description" />
          <link rel="canonical" href="https://example.com/canonical" />
        </head>
        <body><p>Content</p></body>
      </html>
    `;

    const dom = new JSDOM(html, { url: 'https://example.com' });
    const metadata = await extractEnhancedMetadata(dom.window.document);

    expect(metadata.title).toBe('Test Page');
    expect(metadata.description).toBe('A test page description');
    expect(metadata.canonical).toBe('https://example.com/canonical');
    expect(metadata.language).toBe('en');
  });

  it('extracts Open Graph tags', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="OG Title" />
          <meta property="og:description" content="OG Description" />
          <meta property="og:image" content="https://example.com/og.jpg" />
          <meta property="og:type" content="article" />
          <meta property="og:url" content="https://example.com/og-url" />
        </head>
        <body></body>
      </html>
    `;

    const dom = new JSDOM(html, { url: 'https://example.com' });
    const metadata = await extractEnhancedMetadata(dom.window.document);

    expect(metadata.og).toEqual({
      title: 'OG Title',
      description: 'OG Description',
      image: 'https://example.com/og.jpg',
      type: 'article',
      url: 'https://example.com/og-url',
    });
  });

  it('extracts Twitter Card tags', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="Twitter Title" />
          <meta name="twitter:description" content="Twitter Description" />
          <meta name="twitter:image" content="https://example.com/twitter.jpg" />
          <meta name="twitter:site" content="@example" />
        </head>
        <body></body>
      </html>
    `;

    const dom = new JSDOM(html, { url: 'https://example.com' });
    const metadata = await extractEnhancedMetadata(dom.window.document);

    expect(metadata.twitter).toEqual({
      card: 'summary_large_image',
      title: 'Twitter Title',
      description: 'Twitter Description',
      image: 'https://example.com/twitter.jpg',
      site: '@example',
    });
  });

  it('extracts favicon URL', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="icon" href="/favicon.ico" />
        </head>
        <body></body>
      </html>
    `;

    const dom = new JSDOM(html, { url: 'https://example.com/page' });
    const metadata = await extractEnhancedMetadata(dom.window.document);

    expect(metadata.favicon).toBe('https://example.com/favicon.ico');
  });

  it('extracts locale from meta tags', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:locale" content="en_US" />
        </head>
        <body></body>
      </html>
    `;

    const dom = new JSDOM(html, { url: 'https://example.com' });
    const metadata = await extractEnhancedMetadata(dom.window.document);

    expect(metadata.locale).toBe('en_US');
  });

  it('handles missing metadata gracefully', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head></head>
        <body></body>
      </html>
    `;

    const dom = new JSDOM(html, { url: 'https://example.com' });
    const metadata = await extractEnhancedMetadata(dom.window.document);

    expect(metadata.title).toBe('');
    expect(metadata.description).toBe('');
    expect(metadata.canonical).toBeNull();
    expect(metadata.language).toBeNull();
    expect(metadata.locale).toBeNull();
    expect(metadata.favicon).toBeNull();
    expect(metadata.og).toEqual({});
    expect(metadata.twitter).toEqual({});
  });

  it('resolves relative URLs for favicon and canonical', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="icon" href="../icon.png" />
          <link rel="canonical" href="/canonical-path" />
        </head>
        <body></body>
      </html>
    `;

    const dom = new JSDOM(html, { url: 'https://example.com/sub/page' });
    const metadata = await extractEnhancedMetadata(dom.window.document);

    expect(metadata.favicon).toBe('https://example.com/icon.png');
    expect(metadata.canonical).toBe('https://example.com/canonical-path');
  });

  it('prioritizes shortcut icon over regular icon', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="icon" href="/favicon.ico" />
          <link rel="shortcut icon" href="/shortcut.ico" />
        </head>
        <body></body>
      </html>
    `;

    const dom = new JSDOM(html, { url: 'https://example.com' });
    const metadata = await extractEnhancedMetadata(dom.window.document);

    expect(metadata.favicon).toBe('https://example.com/shortcut.ico');
  });

  it('handles complex OG and Twitter metadata combinations', async () => {
    const html = `
      <!DOCTYPE html>
      <html lang="fr">
        <head>
          <title>Page Title</title>
          <meta name="description" content="Page description" />
          <meta property="og:title" content="OG Title Override" />
          <meta property="og:locale" content="fr_FR" />
          <meta name="twitter:card" content="summary" />
        </head>
        <body></body>
      </html>
    `;

    const dom = new JSDOM(html, { url: 'https://example.com' });
    const metadata = await extractEnhancedMetadata(dom.window.document);

    expect(metadata.title).toBe('Page Title');
    expect(metadata.description).toBe('Page description');
    expect(metadata.language).toBe('fr');
    expect(metadata.locale).toBe('fr_FR');
    expect(metadata.og.title).toBe('OG Title Override');
    expect(metadata.twitter.card).toBe('summary');
  });
});

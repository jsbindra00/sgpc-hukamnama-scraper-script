'use server';

import * as cheerio from 'cheerio';

export interface HukamnamaLine {
  gurmukhi: string;
  translation: string;
}

export interface HukamnamaData {
  date: string;
  ang: string;
  title: string;
  lines: HukamnamaLine[];
}

const isProduction = process.env.NODE_ENV === 'production';

export async function getHukamnama(): Promise<HukamnamaData> {
  let browser = null;
  try {
    let html = '';
    if (isProduction) {
      const chromium = require('@sparticuz/chromium');
      const puppeteer = require('puppeteer-core');
      chromium.setGraphicsMode = false;
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
    } else {
      const puppeteer = require('puppeteer');
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto('https://hs.sgpc.net/', { waitUntil: 'networkidle2', timeout: 60000 });
    html = await page.content();
    await browser.close();
    browser = null;

    const $ = cheerio.load(html);
    const dateText = $('.fs-5.customDate').text().trim();
    
    let gurmukhiCard = $('.hukamnama-card').first();
    if (gurmukhiCard.length === 0) gurmukhiCard = $('.hukamnama-card2').first();
    const title = gurmukhiCard.find('.hukamnama-title').text().trim();
    const gurmukhiRaw = gurmukhiCard.find('.hukamnama-text').text().trim();
    const angText = gurmukhiCard.find('.customDate').last().text().trim();

    let englishRaw = '';
    $('.hukamnama-card, .hukamnama-card2').each((_, element) => {
      const cardTitle = $(element).find('.hukamnama-title').text().trim();
      if (cardTitle.toLowerCase().includes('english translation')) {
        englishRaw = $(element).find('.hukamnama-text').text().trim();
      }
    });

    const clean = (text: string) => text.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

    // --- Improved Parsing Logic with Stanza & Rahau Handling ---

    const splitByStanza = (text: string, isGurmukhi: boolean) => {
      let t = clean(text);
      if (isGurmukhi) {
        // 1. Replace full block markers first
        t = t.replace(/॥\s*[\d\u0A66-\u0A6F]+\s*॥\s*[\d\u0A66-\u0A6F]+\s*॥/g, '###'); 
        t = t.replace(/॥\s*[\d\u0A66-\u0A6F]+\s*॥/g, '###'); 
        t = t.replace(/॥\s*ਰਹਾਉ\s*॥/g, '###'); 
        // 2. Cleanup partials if adjacent markers shared a danda
        t = t.replace(/ਰਹਾਉ\s*॥/g, '###'); 
      } else {
        t = t.replace(/\|\|\s*\d+\s*\|\|\s*\d+\s*\|\|/g, '###'); 
        t = t.replace(/\|\|\s*\d+\s*\|\|/g, '###'); 
        t = t.replace(/\|\|\s*Pause\s*\|\|/gi, '###');
        t = t.replace(/Pause\s*\|\|/gi, '###');
      }
      return t.split('###').map(s => s.trim()).filter(s => s);
    };

    const gStanzas = splitByStanza(gurmukhiRaw, true);
    const eStanzas = splitByStanza(englishRaw, false);

    const lines: HukamnamaLine[] = [];

    // Assume 1:1 mapping of stanzas (usually true for SGPC format)
    const maxStanzas = Math.max(gStanzas.length, eStanzas.length);

    for (let i = 0; i < maxStanzas; i++) {
      const gBlock = gStanzas[i] || '';
      const eBlock = eStanzas[i] || '';

      // Split Gurmukhi block into lines by '॥'
      const gLines = gBlock.split('॥').map(l => l.trim()).filter(l => l);

      // Split English block into sentences
      // Regex: Match sentence excluding .?!, followed by .?!
      const eSentences = eBlock.match(/[^.?!]+[.?!]+/g)?.map(s => s.trim()) || (eBlock ? [eBlock] : []);
      
      let eFinalLines: string[] = [];

      if (gLines.length === 0) continue;

      if (gLines.length === 1) {
        // 1 G line -> All English text
        eFinalLines.push(eBlock);
      } else {
        // Distribute English sentences across Gurmukhi lines
        if (eSentences.length <= gLines.length) {
            eFinalLines = eSentences;
        } else {
            // More sentences than lines -> Distribute
            const perLine = Math.floor(eSentences.length / gLines.length);
            let remainder = eSentences.length % gLines.length;
            let current = 0;
            
            for (let k = 0; k < gLines.length; k++) {
                // Distribute remainder to first few lines (or last)
                const count = perLine + (remainder > 0 ? 1 : 0);
                remainder--;
                
                const chunk = eSentences.slice(current, current + count).join(' ');
                eFinalLines.push(chunk);
                current += count;
            }
        }
      }

      // Add to result
      for (let j = 0; j < gLines.length; j++) {
        lines.push({
          gurmukhi: gLines[j],
          translation: eFinalLines[j] || ''
        });
      }
    }

    return {
      date: dateText,
      ang: angText,
      title,
      lines
    };

  } catch (error) {
    console.error('Error scraping Hukamnama:', error);
    if (browser) {
      await browser.close();
    }
    throw new Error('Failed to load Hukamnama');
  }
}

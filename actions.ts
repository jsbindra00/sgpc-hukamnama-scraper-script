"use server";

import * as cheerio from "cheerio";

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

const isProduction = process.env.NODE_ENV === "production";

export async function getHukamnama(): Promise<HukamnamaData> {
  let browser = null;
  try {
    let html = "";
    if (isProduction) {
      const chromium = require("@sparticuz/chromium");
      const puppeteer = require("puppeteer-core");

      chromium.setGraphicsMode = false;

      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
    } else {
      const puppeteer = require("puppeteer");
      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    }

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.goto("https://hs.sgpc.net/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    html = await page.content();

    await browser.close();
    browser = null;

    const $ = cheerio.load(html);

    const dateText = $(".fs-5.customDate").text().trim();
    let gurmukhiCard = $(".hukamnama-card").first();
    if (gurmukhiCard.length === 0) {
      gurmukhiCard = $(".hukamnama-card2").first();
    }

    const title = gurmukhiCard.find(".hukamnama-title").text().trim();
    const gurmukhiRaw = gurmukhiCard.find(".hukamnama-text").text().trim();
    const angText = gurmukhiCard.find(".customDate").last().text().trim();

    let englishRaw = "";
    $(".hukamnama-card, .hukamnama-card2").each((_, element) => {
      const cardTitle = $(element).find(".hukamnama-title").text().trim();
      if (cardTitle.toLowerCase().includes("english translation")) {
        englishRaw = $(element).find(".hukamnama-text").text().trim();
      }
    });

    const clean = (text: string) =>
      text
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const gurmukhiLines = clean(gurmukhiRaw)
      .split("॥")
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (/^[\d\u0A66-\u0A6F]+$/.test(line)) return false;
        if (line === "ਰਹਾਉ") return false;
        return true;
      });

    const englishBlocks = clean(englishRaw)
      .split("||")
      .map((block) => block.trim())
      .filter((block) => {
        if (!block) return false;
        if (/^\d+$/.test(block)) return false;
        if (block.toLowerCase() === "pause") return false;
        return true;
      });

    const englishLines: string[] = [];
    englishBlocks.forEach((block) => {
      const sentences = block.match(/[^.?!]+[.?!]+/g);
      if (sentences) {
        sentences.forEach((s) => {
          const trimmed = s.trim();
          if (trimmed) englishLines.push(trimmed);
        });
      } else {
        if (block) englishLines.push(block);
      }
    });

    const lines: HukamnamaLine[] = [];
    const maxLength = Math.max(gurmukhiLines.length, englishLines.length);

    for (let i = 0; i < maxLength; i++) {
      lines.push({
        gurmukhi: gurmukhiLines[i] || "",
        translation: englishLines[i] || "",
      });
    }

    return {
      date: dateText,
      ang: angText,
      title,
      lines,
    };
  } catch (error) {
    console.error("Error scraping Hukamnama:", error);
    if (browser) {
      await browser.close();
    }
    throw new Error("Failed to load Hukamnama");
  }
}

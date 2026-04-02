// server.js
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { PDFDocument } = require('pdf-lib'); // using pdf-lib for simple extraction
const puppeteer = require('puppeteer');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper: parse PDF (basic text extraction)
async function extractPdfText(filePath) {
  const data = await fs.promises.readFile(filePath);
  const pdfDoc = await PDFDocument.load(data);
  const pages = pdfDoc.getPages();
  let text = '';
  for (const page of pages) {
    const { width, height } = page.getSize();
    // pdf-lib does not provide direct text extraction; placeholder for real library like pdfjs-dist
    text += `[Page ${pages.indexOf(page) + 1} content]\n`;
  }
  return text;
}

// Endpoint: upload proposal (PDF or DOCX)
app.post('/upload', upload.single('proposal'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = path.extname(file.originalname).toLowerCase();
  let content = '';
  if (ext === '.pdf') {
    content = await extractPdfText(file.path);
  } else if (ext === '.docx') {
    // Simple DOCX extraction using mammoth (not installed yet, fallback to raw buffer)
    const mammoth = require('mammoth');
    const result = await mammoth.convertToHtml({ path: file.path });
    content = result.value;
  } else {
    return res.status(400).json({ error: 'Unsupported file type' });
  }
  // Clean up uploaded file
  await fs.promises.unlink(file.path);
  res.json({ text: content });
});

// Endpoint: generate image via Google API (placeholder)
app.post('/generate-image', async (req, res) => {
  const { prompt } = req.body;
  const apiKey = process.env.GOOGLE_API_KEY;
  // Placeholder: call external image generation service
  const response = await fetch('https://generativeai.googleapis.com/v1beta2/models/gemini-pro-vision:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ prompt })
  });
  const data = await response.json();
  res.json(data);
});

// Endpoint: automate Naver blog posting via Puppeteer
app.post('/post-to-naver', async (req, res) => {
  const { title, content, images } = req.body;
  const { NAVER_ID, NAVER_PW } = process.env;
  if (!NAVER_ID || !NAVER_PW) {
    return res.status(400).json({ error: 'Naver credentials not set' });
  }
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://nid.naver.com/nidlogin.login');
    await page.type('#id', NAVER_ID);
    await page.type('#pw', NAVER_PW);
    await page.click('.btn_login');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    // Navigate to blog editor
    await page.goto('https://blog.naver.com/');
    // The actual selectors depend on Naver UI; this is a simplified placeholder.
    // Insert title and content
    await page.evaluate((t, c) => {
      document.querySelector('#postTitle').value = t;
      document.querySelector('#postContent').innerHTML = c;
    }, title, content);
    // Image upload (skip for simplicity)
    await page.click('#btnPublish');
    await page.waitForTimeout(3000);
    await browser.close();
    res.json({ success: true, message: 'Post submitted via automation' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Automation failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

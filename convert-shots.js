const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const INPUT_DIR = path.join(__dirname, 'screenshots');
const SHOTS = ['1-city', '2-chase', '3-mission', '4-standoff'];
const MAX_BYTES = 256 * 1024; // 256 KiB limit

async function convert() {
  for (const name of SHOTS) {
    const inputPath = path.join(INPUT_DIR, `${name}.png`);
    const outputPath = path.join(INPUT_DIR, `${name}.jpg`);

    if (!fs.existsSync(inputPath)) {
      console.log(`Missing ${inputPath}`);
      continue;
    }

    // Binary search for quality that fits under MAX_BYTES
    let low = 10, high = 90, bestQuality = 50;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const buffer = await sharp(inputPath)
        .jpeg({ quality: mid, mozjpeg: true })
        .toBuffer();
      
      if (buffer.length <= MAX_BYTES) {
        bestQuality = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    await sharp(inputPath)
      .jpeg({ quality: bestQuality, mozjpeg: true })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    console.log(`${name}.jpg: ${stats.size} bytes (${(stats.size / 1024).toFixed(1)} KiB) @ quality ${bestQuality}`);
  }
  console.log('Done!');
}

convert().catch(err => console.error(err));

import http from 'http';
import fs from 'fs';
import path from 'path';

// Known existing file from previous step
const objectKey = 'SOHO/CNCSOHO-1/1745359329945-SOHO - Hans bodt INSURANCE.pdf';
const encodedKey = encodeURIComponent(objectKey);

const options = {
  hostname: 'localhost',
  port: 5000,
  path: `/api/expense-documents/file/${encodedKey}`,
  method: 'GET',
};

console.log(`Testing download for: ${options.path}`);

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`);

  let dataLength = 0;
  res.on('data', (chunk) => {
    dataLength += chunk.length;
  });

  res.on('end', () => {
    console.log(`Downloaded ${dataLength} bytes.`);
    
    // Check if size matches expected
    // approximate size from previous check was 137121
    if (res.statusCode === 200 && dataLength > 1000) {
        console.log("SUCCESS: File downloaded successfully via API.");
        process.exit(0);
    } else {
        console.log("FAILURE: File download failed or empty.");
        process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
  process.exit(1);
});

req.end();

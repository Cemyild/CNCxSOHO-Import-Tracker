
import { Client } from '@replit/object-storage';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Run this script ON REPLIT to export your Object Storage files.
 * Command: npx tsx scripts/export_storage_on_replit.ts
 */

const client = new Client();
const EXPORT_DIR = 'replit_export_files';

// Helper to handle Replit's buffer return types
function getBufferFromResult(value: any): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  } else if (Array.isArray(value) && value.length > 0 && Buffer.isBuffer(value[0])) {
    return value[0];
  } else if (Array.isArray(value) && value.length > 0) {
    return Buffer.from(value[0]);
  }
  return Buffer.from([]);
}

async function exportFiles() {
  console.log('🚀 Starting export from Replit Object Storage...');
  
  // Create export directory
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    console.log(`Created directory: ${EXPORT_DIR}`);
  }

  // List all files
  console.log('Listing all files...');
  const result = await client.list({ prefix: '' });
  
  if (!result.ok) {
    console.error('❌ Failed to list files:', result.error);
    return;
  }

  const files = result.value;
  console.log(`Found ${files.length} files to download.`);

  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    const key = file.name;
    const cleanKey = key.replace(/^\/+/, ''); // Remove leading slashes
    const localPath = path.join(EXPORT_DIR, cleanKey);
    
    // Create nested directories
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    process.stdout.write(`Downloading ${key}... `);
    
    try {
      const download = await client.downloadAsBytes(key);
      
      if (!download.ok) {
        console.log(`❌ Failed: ${download.error.message}`);
        failCount++;
        continue;
      }

      const buffer = getBufferFromResult(download.value);
      fs.writeFileSync(localPath, buffer);
      console.log('✅ OK');
      successCount++;
    } catch (err) {
      console.log(`❌ Error: ${err}`);
      failCount++;
    }
  }
  
  console.log('\n==========================================');
  console.log(`🎉 Export complete!`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`\nFiles are saved in: ${path.resolve(EXPORT_DIR)}`);
  console.log('\nNEXT STEPS:');
  console.log('1. Run: zip -r export.zip replit_export_files');
  console.log('2. Download "export.zip" from the file explorer.');
  console.log('3. Extract contents to your local "uploads" folder.');
  console.log('==========================================');
}

exportFiles().catch(console.error);

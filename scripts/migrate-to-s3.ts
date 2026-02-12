
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
// import dotenv from "dotenv"; // Removed: using native node --env-file
import fs from "fs";
import path from "path";
import mime from "mime-types";

// Load environment variables
// dotenv.config();

const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION || 'auto';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_BUCKET = process.env.S3_BUCKET;

// Use the exact same directory structure as local
const LOCAL_UPLOADS_DIR = path.join(process.cwd(), 'uploads');

async function migrate() {
    console.log("🚀 Starting Migration to S3...");
    
    if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY || !S3_BUCKET) {
        console.error("❌ ERROR: Missing S3 environment variables in .env");
        return;
    }

    const s3Client = new S3Client({
        region: S3_REGION,
        endpoint: S3_ENDPOINT,
        credentials: {
            accessKeyId: S3_ACCESS_KEY,
            secretAccessKey: S3_SECRET_KEY,
        },
        forcePathStyle: true
    });

    // Recursive function to walk directories
    async function processDirectory(dir: string, baseDir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await processDirectory(fullPath, baseDir);
            } else {
                // Create S3 Key
                // 1. Get relative path (e.g., SOHO/Folder/File.pdf)
                // 2. Normalize slashes for S3 (forward slashes)
                const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
                
                // IMPORTANT: In object-storage.ts, we use the prefix 'SOHO/'
                // Since user has 'uploads/SOHO', the relative path will start with 'SOHO/'
                // which matches perfectly.
                const s3Key = relativePath;
                
                await uploadFile(s3Client, fullPath, s3Key);
            }
        }
    }

    async function uploadFile(client: S3Client, filePath: string, key: string) {
        try {
            // Check if exists
            await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
            console.log(`⏭️  Skipping (already exists): ${key}`);
            return;
        } catch (e) {
            // Not found, proceed to upload
        }

        try {
            const fileContent = fs.readFileSync(filePath);
            const mimeType = mime.lookup(filePath) || 'application/octet-stream';

            const cmd = new PutObjectCommand({
                Bucket: S3_BUCKET,
                Key: key,
                Body: fileContent,
                ContentType: mimeType,
            });
            await client.send(cmd);
            console.log(`✅ Uploaded: ${key}`);
        } catch (error) {
            console.error(`❌ Failed to process/upload ${key}:`, error);
        }
    }

    if (fs.existsSync(LOCAL_UPLOADS_DIR)) {
        console.log(`📂 Scanning directory: ${LOCAL_UPLOADS_DIR}`);
        await processDirectory(LOCAL_UPLOADS_DIR, LOCAL_UPLOADS_DIR);
    } else {
        console.log(`❌ Uploads directory not found at ${LOCAL_UPLOADS_DIR}`);
    }
    
    console.log("\n✨ Migration Complete!");
}

migrate();

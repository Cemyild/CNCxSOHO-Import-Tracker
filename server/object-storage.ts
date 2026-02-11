
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"; // Ensure this package is installed
import mime from 'mime-types';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

// We'll use a prefix for all keys to organize files
export const BUCKET_PREFIX = 'SOHO/';

// Configuration from environment variables
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION || 'auto'; // 'auto' or specific region often used for S3 compatible
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_BUCKET = process.env.S3_BUCKET;

// Logic to determine if we should use S3
// We need Endpoint, Access Key, Secret Key, and Bucket to be set.
const USE_S3 = !!(S3_ENDPOINT && S3_ACCESS_KEY && S3_SECRET_KEY && S3_BUCKET);

let s3Client: S3Client | null = null;

if (USE_S3) {
  console.log('Initializing S3 Object Storage client');
  try {
    s3Client = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      credentials: {
        accessKeyId: S3_ACCESS_KEY!,
        secretAccessKey: S3_SECRET_KEY!,
      },
      forcePathStyle: true, // Often needed for S3 compatible storages like MinIO or others
    });
  } catch (e) {
    console.error('Failed to initialize S3 Object Storage client:', e);
    s3Client = null;
  }
} else {
  console.log('S3 configuration missing, falling back to local filesystem storage.');
  console.log('Required env vars: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET');
}

// Local storage directory
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function getLocalPath(objectKey: string): string {
  // Sanitize key but allow spaces and common file characters
  // Keeping it safe from path traversal (..) but allowing normal filenames
  // Remove "SOHO/" prefix for local storage if desired, or keep structure
  // For local, let's keep the folder structure created by prefixes
  const safeKey = objectKey.replace(/(\.\.(\/|\\|$))+/g, '');
  return path.join(UPLOADS_DIR, safeKey);
}

// List all objects with a given prefix
export async function listAllKeys(prefix: string = ''): Promise<string[]> {
  const fullPrefix = BUCKET_PREFIX + prefix;
  console.log(`Listing objects with prefix: ${fullPrefix}`);

  if (s3Client && S3_BUCKET) {
    try {
      const command = new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: fullPrefix,
      });
      const response = await s3Client.send(command);
      
      if (response.Contents) {
        const objects = response.Contents.map(obj => obj.Key).filter(key => key !== undefined) as string[];
        console.log(`Found ${objects.length} objects with prefix ${fullPrefix}`);
        return objects;
      }
      return [];
    } catch (error) {
      console.error("Error listing objects from S3:", error);
      // Don't fall back to local if S3 is configured but fails - that masks errors?
      // Or should we? Let's throw to be explicit.
      throw error;
    }
  } else {
    // Local fallback
    const files: string[] = [];
    
    // Check if directory exists first
    if (!fs.existsSync(UPLOADS_DIR)) {
        return [];
    }

    const traverse = (dir: string, baseDir: string) => {
      let entries;
      try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
          return; // Directory might not exist deep in tree
      }
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          traverse(fullPath, baseDir);
        } else {
          // Construct Key (relative path, replace backslashes with forward slashes)
          const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
          files.push(relPath);
        }
      }
    };
    
    traverse(UPLOADS_DIR, UPLOADS_DIR);
    
    // Filter by prefix
    return files.filter(f => f.startsWith(fullPrefix));
  }
}

// Upload a file
export async function uploadFile(
  fileBuffer: Buffer, 
  fileName: string, 
  mimeType: string,
  procedureReference: string
): Promise<string> {
  // Clean procedure reference for use in path
  const safeProcedureRef = procedureReference.replace(/[^a-zA-Z0-9-_]/g, '_');
  
  const timestamp = Date.now();
  const objectKey = `${BUCKET_PREFIX}${safeProcedureRef}/${timestamp}-${fileName}`;
  
  if (s3Client && S3_BUCKET) {
    try {
      console.log(`Uploading file to S3, key: ${objectKey}`);
      const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: objectKey,
        Body: fileBuffer,
        ContentType: mimeType,
      });
      
      await s3Client.send(command);
      console.log(`File uploaded successfully to S3: ${objectKey}`);
      return objectKey;
    } catch (error) {
      console.error("Error uploading to S3:", error);
      throw error;
    }
  } else {
    // Local fallback
    console.log(`Uploading file locally, key: ${objectKey}`);
    const localPath = getLocalPath(objectKey);
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(localPath, fileBuffer);
    console.log(`File uploaded successfully locally: ${localPath}`);
    return objectKey;
  }
}

// Get a file
export async function getFile(objectKey: string): Promise<{ buffer: Buffer; contentType: string }> {
  console.log(`Retrieving file, key: ${objectKey}`);
  
  if (s3Client && S3_BUCKET) {
    try {
      const command = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: objectKey,
      });
      
      const response = await s3Client.send(command);
      
      // Convert stream to buffer
      if (!response.Body) {
        throw new Error("Empty body in S3 response");
      }
      
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      
      const contentType = response.ContentType || mime.lookup(objectKey) || 'application/octet-stream';
      
      return { buffer, contentType };
    } catch (error) {
      console.error("Error getting file from S3:", error);
      throw error;
    }
  } else {
    // Local fallback
    const localPath = getLocalPath(objectKey);
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found locally: ${localPath}`);
    }
    
    const buffer = fs.readFileSync(localPath);
    const contentType = mime.lookup(localPath) || 'application/octet-stream';
    return { buffer, contentType };
  }
}

// Delete a file
export async function deleteFile(objectKey: string): Promise<boolean> {
  console.log(`Deleting file, key: ${objectKey}`);
  
  if (s3Client && S3_BUCKET) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: objectKey,
      });
      
      await s3Client.send(command);
      return true;
    } catch (error) {
      console.error("Error deleting file from S3:", error);
      throw error; 
    }
  } else {
    // Local fallback
    const localPath = getLocalPath(objectKey);
    if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        console.log(`File deleted locally: ${localPath}`);
        return true;
    }
    console.warn(`File to delete not found locally: ${localPath}`);
    return true; 
  }
}

// Create a URL for accessing a file directly
export async function createSignedUrl(objectKey: string): Promise<string> {
  // Check if we can generate a real signed URL for S3
  // Note: For public or internal use, we might stick to proxying through the backend
  // to maintain authentication checks. 
  // The current route /api/expense-documents/file/:key proxies the content.
  
  // If we wanted to yield a direct S3 URL:
  /*
  if (s3Client && S3_BUCKET) {
     const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: objectKey });
     return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  }
  */

  // Return API endpoint for accessing the file internally (proxied)
  return `/api/expense-documents/file/${encodeURIComponent(objectKey)}`;
}

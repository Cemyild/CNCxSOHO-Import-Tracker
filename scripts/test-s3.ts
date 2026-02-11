
import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION || 'auto';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_BUCKET = process.env.S3_BUCKET;

async function testS3() {
    console.log("Testing S3 Connection...");
    console.log("Endpoint:", S3_ENDPOINT);
    console.log("Bucket:", S3_BUCKET);
    console.log("Region:", S3_REGION);
    
    if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY || !S3_BUCKET) {
        console.error("ERROR: Missing one or more S3 environment variables.");
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

    try {
        console.log("\n1. Listing Objects...");
        const listCmd = new ListObjectsV2Command({ Bucket: S3_BUCKET, MaxKeys: 5 });
        const listRes = await s3Client.send(listCmd);
        console.log("Success! Found objects:", listRes.Contents?.length || 0);

        console.log("\n2. Uploading Test File...");
        const testKey = `test-connection-${Date.now()}.txt`;
        const putCmd = new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: testKey,
            Body: "Hello from CNC SOHO Deployment Script!",
            ContentType: "text/plain"
        });
        await s3Client.send(putCmd);
        console.log(`Success! Uploaded ${testKey}`);

        console.log("\n3. Cleaning up (Deleting Test File)...");
        const delCmd = new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: testKey
        });
        await s3Client.send(delCmd);
        console.log("Success! Deleted test file.");

        console.log("\n✅ S3 Configuration is VALID!");

    } catch (error) {
        console.error("\n❌ S3 Test Failed:", error);
    }
}

testS3();

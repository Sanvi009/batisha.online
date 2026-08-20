import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import Busboy from 'busboy';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  let userId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.id;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { bucket } = req.query;
  if (!bucket || !['product-images', 'shop-images'].includes(bucket)) {
    return res.status(400).json({ error: 'Invalid bucket. Must be "product-images" or "shop-images".' });
  }

  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    let fileBuffer = null;
    let filename = null;
    let mimetype = null;
    let fileUploaded = false;

    busboy.on('file', (fieldname, file, info) => {
      const { filename: originalName, mimeType } = info;
      mimetype = mimeType;
      const ext = originalName.split('.').pop();
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 6);
      filename = `${userId}_${timestamp}_${random}.${ext}`;
      fileUploaded = true;

      const chunks = [];
      file.on('data', (chunk) => {
        chunks.push(chunk);
      });
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on('finish', async () => {
      if (!fileUploaded || !fileBuffer) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      try {
        const { error: uploadError } = await supabaseAdmin.storage
          .from(bucket)
          .upload(filename, fileBuffer, {
            contentType: mimetype,
            upsert: false,
          });

        if (uploadError) {
          console.error('Supabase upload error:', uploadError);
          return res.status(500).json({ error: 'Supabase upload failed: ' + uploadError.message });
        }

        const { data: urlData } = supabaseAdmin.storage
          .from(bucket)
          .getPublicUrl(filename);

        return res.status(200).json({ url: urlData.publicUrl });
      } catch (err) {
        console.error('Upload error:', err);
        return res.status(500).json({ error: 'Upload failed: ' + err.message });
      }
    });

    busboy.on('error', (err) => {
      console.error('Busboy error:', err);
      return res.status(500).json({ error: 'File parsing error: ' + err.message });
    });

    req.pipe(busboy);
  });
}

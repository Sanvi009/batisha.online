import Busboy from 'busboy';

// Inside the handler:
const busboy = Busboy({ headers: req.headers });
let fileBuffer = null;
let filename = null;
let mimetype = null;

busboy.on('file', (fieldname, file, info) => {
  const { filename: originalName, mimeType } = info;
  mimetype = mimeType;
  const ext = originalName.split('.').pop();
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  filename = `${userId}_${timestamp}_${random}.${ext}`;

  const chunks = [];
  file.on('data', (chunk) => chunks.push(chunk));
  file.on('end', () => {
    fileBuffer = Buffer.concat(chunks);
  });
});

busboy.on('finish', async () => {
  if (!fileBuffer) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(filename, fileBuffer, {
      contentType: mimetype,
      upsert: false,
    });

  if (uploadError) {
    return res.status(500).json({ error: uploadError.message });
  }

  const { data: urlData } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(filename);

  return res.status(200).json({ url: urlData.publicUrl });
});

req.pipe(busboy);

/**
 * 公共 multipart/form-data 解析
 * 返回 { files, fields }，供 ai.js（图片上传）、files.js（文件上传）等复用
 */
export async function parseMultipartData(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=([^;]+)/);
    if (!boundaryMatch) {
      reject(new Error('No boundary found'));
      return;
    }
    const boundary = (boundaryMatch[1] || '').trim();

    let data = Buffer.alloc(0);
    const files = [];
    const fields = {};

    req.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
    });

    req.on('end', () => {
      try {
        const parts = data.toString('binary').split(`--${boundary}`);

        for (const part of parts) {
          if (!part.trim() || part.trim() === '--') continue;

          if (part.includes('Content-Disposition: form-data')) {
            const nameMatch = part.match(/name="([^"]+)"/);
            const filenameMatch = part.match(/filename="([^"]+)"/);

            if (filenameMatch) {
              const filename = filenameMatch[1];
              const contentTypeMatch = part.match(/Content-Type: ([^\r\n]+)/);
              const mimetype = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';

              const headerEndIndex = part.indexOf('\r\n\r\n');
              if (headerEndIndex !== -1) {
                const fileStart = headerEndIndex + 4;
                const fileEnd = part.lastIndexOf('\r\n');
                const fileContent = Buffer.from(part.substring(fileStart, fileEnd), 'binary');

                files.push({
                  fieldname: nameMatch ? nameMatch[1] : 'file',
                  originalname: filename,
                  mimetype,
                  buffer: fileContent,
                  size: fileContent.length
                });
              }
            } else if (nameMatch) {
              const fieldName = nameMatch[1];
              const headerEndIndex = part.indexOf('\r\n\r\n');
              if (headerEndIndex !== -1) {
                const fieldStart = headerEndIndex + 4;
                const fieldEnd = part.lastIndexOf('\r\n');
                const fieldBuf = Buffer.from(part.substring(fieldStart, fieldEnd), 'binary');
                fields[fieldName] = fieldBuf.toString('utf8');
              }
            }
          }
        }

        resolve({ files, fields });
      } catch (e) {
        reject(e);
      }
    });

    req.on('error', reject);
  });
}

// dropbox.js — Dropbox API helpers
const { Dropbox } = require('dropbox');
const fetch = require('node-fetch');

function getClient() {
  return new Dropbox({
    clientId: process.env.DROPBOX_APP_KEY,
    clientSecret: process.env.DROPBOX_APP_SECRET,
    refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
    fetch,
  });
}

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.tiff', '.tif',
  '.cr2', '.cr3', '.nef', '.arw', '.orf', '.rw2', '.dng', '.raf',
]);

function isImage(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

function isRaw(filename) {
  const rawExts = new Set(['.cr2', '.cr3', '.nef', '.arw', '.orf', '.rw2', '.dng', '.raf', '.tiff', '.tif']);
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return rawExts.has(ext);
}

async function listImagesFromSharedLink(sharedLink) {
  const dbx = getClient();
  const cleanLink = sharedLink.split('?')[0];
  let entries = [];
  let hasMore = true;
  let cursor = null;

  console.log('Fetching images from Dropbox shared link...');

  try {
    while (hasMore) {
      let result;
      if (!cursor) {
        result = await dbx.filesListFolder({
          path: '',
          shared_link: { url: cleanLink },
          recursive: false,
        });
      } else {
        result = await dbx.filesListFolderContinue({ cursor });
      }
      entries = entries.concat(result.result.entries);
      hasMore = result.result.has_more;
      cursor = result.result.cursor;
    }
  } catch (err) {
    throw new Error(`Dropbox folder listing failed: ${err.message || err.error_summary}`);
  }

  const imageEntries = entries.filter((e) => e['.tag'] === 'file' && isImage(e.name));
  console.log(`Found ${imageEntries.length} image files`);
  
  const results = [];

  for (let i = 0; i < imageEntries.length; i += 25) {
    const batch = imageEntries.slice(i, i + 25);
    const linkPromises = batch.map(async (entry) => {
      try {
        if (isRaw(entry.name)) {
          console.log(`Fetching thumbnail for RAW file: ${entry.name}`);
          try {
            const thumbRes = await dbx.filesGetThumbnailV2({
              resource: { '.tag': 'path', path: entry.path_lower },
              format: 'jpeg',
              size: 'w2048h1536',
              mode: 'bestfit',
            });
            console.log(`✓ Thumbnail generated for ${entry.name}`);
            const base64 = Buffer.from(thumbRes.result.fileBinary).toString('base64');
            const previewUrl = `data:image/jpeg;base64,${base64}`;
            const linkRes = await dbx.filesGetTemporaryLink({ path: entry.path_lower });
            return {
              filename: entry.name,
              path: entry.path_lower,
              size: entry.size,
              isRaw: true,
              previewUrl: previewUrl,
              downloadUrl: linkRes.result.link,
              modified: entry.client_modified,
            };
          } catch (thumbErr) {
            console.warn(`✗ Thumbnail failed for ${entry.name}:`, thumbErr.message);
            const linkRes = await dbx.filesGetTemporaryLink({ path: entry.path_lower });
            return {
              filename: entry.name,
              path: entry.path_lower,
              size: entry.size,
              isRaw: true,
              previewUrl: null,
              downloadUrl: linkRes.result.link,
              modified: entry.client_modified,
            };
          }
        } else {
          const linkRes = await dbx.filesGetTemporaryLink({ path: entry.path_lower });
          return {
            filename: entry.name,
            path: entry.path_lower,
            size: entry.size,
            isRaw: false,
            previewUrl: linkRes.result.link,
            downloadUrl: linkRes.result.link,
            modified: entry.client_modified,
          };
        }
      } catch (e) {
        console.warn(`Could not get link for ${entry.name}:`, e.message);
        return null;
      }
    });
    const batchResults = await Promise.all(linkPromises);
    results.push(...batchResults.filter(Boolean));
  }
  
  console.log('Finished fetching all images');
  return results;
}

async function refreshImageLink(filePath) {
  const dbx = getClient();
  try {
    const linkRes = await dbx.filesGetTemporaryLink({ path: filePath });
    return linkRes.result.link;
  } catch (err) {
    throw new Error(`Could not refresh link for ${filePath}: ${err.message}`);
  }
}

module.exports = { listImagesFromSharedLink, refreshImageLink, isRaw };

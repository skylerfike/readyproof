// server.js — ReadyProof main server
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { listImagesFromSharedLink, refreshImageLink } = require('./dropbox');
const { sendClientInvite, sendEditorBrief, sendClientConfirmation } = require('./email');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure uploads dir exists for logo
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Admin auth middleware ──────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/settings
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const logoPath = db.getSetting.get('logo_path');
  const studioName = db.getSetting.get('studio_name');
  res.json({
    logo_path: logoPath ? logoPath.value : null,
    studio_name: studioName ? studioName.value : process.env.STUDIO_NAME || '',
  });
});

// POST /api/admin/settings/logo — upload logo as base64
app.post('/api/admin/settings/logo', requireAdmin, (req, res) => {
  const { dataUrl, filename } = req.body;
  if (!dataUrl) return res.status(400).json({ error: 'No image data' });

  // Save base64 image to disk
  const ext = filename ? path.extname(filename) : '.png';
  const logoFilename = `logo${ext}`;
  const logoPath = path.join(uploadsDir, logoFilename);
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(logoPath, Buffer.from(base64Data, 'base64'));

  const publicPath = `/uploads/${logoFilename}`;
  db.setSetting.run('logo_path', publicPath);
  res.json({ ok: true, logo_path: publicPath });
});

// DELETE /api/admin/settings/logo
app.delete('/api/admin/settings/logo', requireAdmin, (req, res) => {
  db.setSetting.run('logo_path', '');
  res.json({ ok: true });
});

// POST /api/admin/settings/studio-name
app.post('/api/admin/settings/studio-name', requireAdmin, (req, res) => {
  const { name } = req.body;
  db.setSetting.run('studio_name', name || '');
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN SESSION ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/sessions', requireAdmin, (req, res) => {
  try { res.json(db.getSessions.all()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/sessions', requireAdmin, async (req, res) => {
  const { client_name, client_email, dropbox_link, package_name, num_included, notes, balance_owed, payment_notes } = req.body;
  if (!client_name || !client_email || !dropbox_link)
    return res.status(400).json({ error: 'client_name, client_email, and dropbox_link are required' });

  const id = uuidv4();
  const magic_token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  try {
    db.createSession.run({ id, client_name, client_email, dropbox_link, magic_token,
      package_name: package_name || null, num_included: num_included || 0,
      notes: notes || null, balance_owed: balance_owed || 0, payment_notes: payment_notes || null });
    const session = db.getSessionById.get(id);
    res.json({ ...session, gallery_url: `${process.env.BASE_URL}/gallery/${magic_token}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/admin/sessions/:id — edit all session fields
app.patch('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  const session = db.getSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { status, client_name, client_email, dropbox_link, package_name,
          num_included, notes, payment_status, balance_owed, payment_notes } = req.body;

  if (status) db.updateSessionStatus.run(status, status, session.id);

  if (client_name !== undefined) {
    db.updateSession.run({
      id: session.id,
      client_name: client_name ?? session.client_name,
      client_email: client_email ?? session.client_email,
      dropbox_link: dropbox_link ?? session.dropbox_link,
      package_name: package_name ?? session.package_name,
      num_included: num_included ?? session.num_included,
      notes: notes ?? session.notes,
      payment_status: payment_status ?? session.payment_status,
      balance_owed: balance_owed ?? session.balance_owed,
      payment_notes: payment_notes ?? session.payment_notes,
    });
  }

  res.json(db.getSessionById.get(req.params.id));
});

app.post('/api/admin/sessions/:id/invite', requireAdmin, async (req, res) => {
  const session = db.getSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const galleryUrl = `${process.env.BASE_URL}/gallery/${session.magic_token}`;
  try {
    await sendClientInvite({ clientName: session.client_name, clientEmail: session.client_email,
      galleryUrl, packageName: session.package_name, numIncluded: session.num_included });
    res.json({ ok: true, message: `Invite sent to ${session.client_email}` });
  } catch (err) { res.status(500).json({ error: `Email failed: ${err.message}` }); }
});

app.post('/api/admin/sessions/:id/send-editor', requireAdmin, async (req, res) => {
  const session = db.getSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const selections = db.getSubmittedSelections.all(session.id);
  if (selections.length === 0) return res.status(400).json({ error: 'No selections found' });
  try {
    await sendEditorBrief({ session, selections });
    db.markEditorSent.run(session.id);
    res.json({ ok: true, message: `Editor brief sent for ${selections.length} images` });
  } catch (err) { res.status(500).json({ error: `Email failed: ${err.message}` }); }
});

app.get('/api/admin/sessions/:id/brief', requireAdmin, (req, res) => {
  const session = db.getSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const selections = db.getSubmittedSelections.all(session.id);
  const orders = db.getOrders.all(session.id);
  res.json({ session, selections, orders });
});

app.delete('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  db.deleteSession.run(req.params.id);
  res.json({ ok: true });
});

// ── Order routes ──────────────────────────────────────────────────────────────

app.get('/api/admin/sessions/:id/orders', requireAdmin, (req, res) => {
  res.json(db.getOrders.all(req.params.id));
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const { status } = req.body;
  db.updateOrderStatus.run(status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  db.deleteOrder.run(req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// CLIENT (GALLERY) ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/gallery/:token', async (req, res) => {
  const session = db.getSessionByToken.get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Gallery not found' });

  try {
    if (session.status === 'pending') db.updateSessionStatus.run('reviewing', 'reviewing', session.id);

    const images = await listImagesFromSharedLink(session.dropbox_link);
    const savedSelections = db.getSelections.all(session.id);
    const selectionMap = {};
    savedSelections.forEach(s => { selectionMap[s.filename] = s; });

    const enriched = images.map(img => {
      const saved = selectionMap[img.filename];
      return { ...img,
        is_favorite: saved ? saved.is_favorite === 1 : false,
        is_selected: saved ? saved.is_selected === 1 : false,
        client_note: saved ? saved.client_note : null,
      };
    });

    // Load studio branding
    const logoPath = db.getSetting.get('logo_path');
    const studioName = db.getSetting.get('studio_name');

    res.json({
      session: {
        id: session.id, client_name: session.client_name,
        status: session.status, package_name: session.package_name,
        num_included: session.num_included,
      },
      images: enriched,
      branding: {
        logo_path: logoPath ? logoPath.value : null,
        studio_name: studioName ? studioName.value : (process.env.STUDIO_NAME || 'Gallery'),
      },
    });
  } catch (err) {
    console.error('Gallery load error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gallery/:token/save', async (req, res) => {
  const session = db.getSessionByToken.get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Gallery not found' });
  if (['submitted','editing','complete'].includes(session.status))
    return res.status(400).json({ error: 'Gallery already submitted' });

  const { selections } = req.body;
  try {
    for (const sel of selections) {
      db.upsertSelection.run({ id: uuidv4(), session_id: session.id, filename: sel.filename,
        is_favorite: sel.is_favorite ? 1 : 0, is_selected: sel.is_selected ? 1 : 0,
        client_note: sel.client_note || null });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/gallery/:token/submit', async (req, res) => {
  const session = db.getSessionByToken.get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Gallery not found' });
  if (['submitted','editing','complete'].includes(session.status))
    return res.status(400).json({ error: 'Already submitted' });

  const { selections, orders } = req.body;
  const selectedImages = selections.filter(s => s.is_selected);
  if (selectedImages.length === 0)
    return res.status(400).json({ error: 'Please select at least one image before submitting' });

  try {
    for (const sel of selections) {
      db.upsertSelection.run({ id: uuidv4(), session_id: session.id, filename: sel.filename,
        is_favorite: sel.is_favorite ? 1 : 0, is_selected: sel.is_selected ? 1 : 0,
        client_note: sel.client_note || null });
    }

    // Save any add-on orders
    if (orders && orders.length > 0) {
      for (const order of orders) {
        db.createOrder.run({ id: uuidv4(), session_id: session.id,
          order_type: order.order_type, quantity: order.quantity || 1,
          details: order.details || null, price: order.price || 0, status: 'pending' });
      }
    }

    db.updateSessionStatus.run('submitted', 'submitted', session.id);

    try {
      await sendClientConfirmation({ clientName: session.client_name,
        clientEmail: session.client_email, selectionCount: selectedImages.length });
    } catch (emailErr) { console.warn('Confirmation email failed:', emailErr.message); }

    res.json({ ok: true, selected_count: selectedImages.length,
      message: "Selection submitted! We'll be in touch soon." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/gallery/:token/refresh-link', async (req, res) => {
  const session = db.getSessionByToken.get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Not found' });
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'path is required' });
  try {
    const url = await refreshImageLink(filePath);
    res.json({ url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ZAPIER WEBHOOK — Auto-create session from Acuity booking
// ══════════════════════════════════════════════════════════════════════════════

// Maps Acuity session type strings to package_ids in Google Sheets
// Uses "contains" matching — order matters (more specific first)
const PACKAGE_MAP = [
  // Workplace ONLO
  { contains: 'ONLO 45', package_id: 'onlo_45' },
  { contains: 'ONLO 90', package_id: 'onlo_90' },
  // Actor ONLO
  { contains: 'ONLO 180', package_id: 'onlo_180_actor' },
  { contains: 'ONLO 60', package_id: 'onlo_60_actor' },
  // Book Builder ONLO
  { contains: 'BB ONLO 180', package_id: 'bb_onlo_180' },
  { contains: 'BB ONLO 90', package_id: 'bb_onlo_90' },
  { contains: 'BB ONLO 60', package_id: 'bb_onlo_60' },
  // Book Builder Studio
  { contains: 'BB S 180', package_id: 'bb_studio_180' },
  { contains: 'BB S 90', package_id: 'bb_studio_90' },
  { contains: 'BB S 60', package_id: 'bb_studio_60' },
  // Digitals
  { contains: 'Digital 240', package_id: 'digital_240' },
  { contains: 'Digital 120', package_id: 'digital_120' },
  { contains: 'Digital 60', package_id: 'digital_60' },
  { contains: 'Digitals Day', package_id: 'digitals_day' },
  // Actor Studio
  { contains: 'STUDIO 240', package_id: 'studio_240_actor' },
  { contains: 'STUDIO 120', package_id: 'studio_120_actor' },
  { contains: 'STUDIO 60', package_id: 'studio_60_actor' },
  { contains: 'STUDIO 30', package_id: 'studio_30_actor' },
  // Workplace Studio
  { contains: 'Studio 120', package_id: 'studio_120_workplace' },
  { contains: 'Studio 60', package_id: 'studio_60_workplace' },
  { contains: 'Studio 30', package_id: 'studio_30_workplace' },
  // Executive
  { contains: 'Studio Pro II', package_id: 'studio_pro_2' },
  { contains: 'Studio Pro I', package_id: 'studio_pro_1' },
  // On-Location 60/90/180 (Actor series fallback)
  { contains: 'On-Location 180', package_id: 'onlo_180_actor' },
  { contains: 'On-Location 90', package_id: 'onlo_90_actor' },
  { contains: 'On-Location 60', package_id: 'onlo_60_actor' },
];

function parsePackageId(sessionTypeRaw) {
  if (!sessionTypeRaw) return null;
  for (const entry of PACKAGE_MAP) {
    if (sessionTypeRaw.includes(entry.contains)) return entry.package_id;
  }
  return null;
}

// Parse "Last, First" → "First Last"
function parseClientName(nameRaw) {
  if (!nameRaw) return 'Unknown Client';
  if (nameRaw.includes(',')) {
    const parts = nameRaw.split(',').map(s => s.trim());
    return `${parts[1]} ${parts[0]}`;
  }
  return nameRaw.trim();
}

app.post('/api/webhooks/create-session', async (req, res) => {
  // Verify webhook secret
  const secret = req.headers['x-webhook-secret'] || req.body.webhook_secret;
  if (secret !== process.env.WEBHOOK_SECRET) {
    console.warn('Webhook: unauthorized attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const {
    client_name,
    client_email,
    dropbox_link,
    proofs_link,
    session_type_raw,
  } = req.body;

  // Validate required fields
  if (!client_name || !client_email || !dropbox_link) {
    return res.status(400).json({ error: 'Missing required fields: client_name, client_email, dropbox_link' });
  }

  // Parse name from "Last, First" format
  const parsedName = parseClientName(client_name);

  // Map session type to package_id
  const packageId = parsePackageId(session_type_raw);
  
  console.log(`Webhook: Creating session for ${parsedName} (${client_email})`);
  console.log(`  Session type: ${session_type_raw}`);
  console.log(`  Mapped to package: ${packageId || 'unknown'}`);

  // Create session in database
  const token = uuidv4();
  try {
    db.createSession.run({
      id: uuidv4(),
      client_name: parsedName,
      client_email,
      dropbox_link,
      magic_token: token,
      package_name: packageId || session_type_raw || '',
      num_included: 0,
      notes: proofs_link ? `Proofs link: ${proofs_link}` : '',
      balance_owed: 0,
      payment_notes: '',
    });

    const galleryUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/gallery/${token}`;
    
    console.log(`  ✓ Session created: ${galleryUrl}`);
    
    res.json({
      ok: true,
      token,
      gallery_url: galleryUrl,
      client_name: parsedName,
      package_id: packageId,
      message: `Session created for ${parsedName}`,
    });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Serve frontend pages ───────────────────────────────────────────────────────
app.get('/gallery/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'gallery.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.redirect('/admin'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n📷  ReadyProof running at http://localhost:${PORT}`);
  console.log(`   Admin dashboard: http://localhost:${PORT}/admin\n`);
});

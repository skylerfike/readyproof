// email.js — Nodemailer email helpers
const nodemailer = require('nodemailer');

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Send the client their magic gallery link
 */
async function sendClientInvite({ clientName, clientEmail, galleryUrl, packageName, numIncluded }) {
  const transporter = getTransporter();

  const subject = `Your gallery is ready — ${clientName}`;
  const packageLine = packageName
    ? `<p>Your <strong>${packageName}</strong> package includes <strong>${numIncluded} edited images</strong>.</p>`
    : '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Georgia, serif; max-width: 580px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
      <h1 style="font-size: 26px; margin-bottom: 8px;">${process.env.STUDIO_NAME}</h1>
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
      <p>Hi ${clientName},</p>
      <p>Your gallery is ready! Please click the button below to view your images and make your selections.</p>
      ${packageLine}
      <p>Once you've reviewed your gallery, favorite the images you love most, select your final picks, add any notes, and hit <strong>Submit Selection</strong>.</p>
      <div style="text-align: center; margin: 40px 0;">
        <a href="${galleryUrl}"
           style="background: #1a1a1a; color: #fff; text-decoration: none; padding: 16px 36px;
                  font-family: Georgia, serif; font-size: 16px; letter-spacing: 0.05em;">
          View Your Gallery →
        </a>
      </div>
      <p style="color: #888; font-size: 13px;">This link is unique to you — no password needed. Save this email to return to your gallery at any time.</p>
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
      <p style="color: #888; font-size: 13px;">Questions? Just reply to this email.</p>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"${process.env.STUDIO_NAME}" <${process.env.SMTP_USER}>`,
    to: clientEmail,
    subject,
    html,
  });
}

/**
 * Send the editor their brief — list of selected filenames + notes
 */
async function sendEditorBrief({ session, selections }) {
  const transporter = getTransporter();

  const subject = `Edit brief — ${session.client_name} (${selections.length} images)`;

  // Build the file list
  const fileRows = selections.map((s, i) => {
    const note = s.client_note ? `<br><em style="color:#888;font-size:12px;">Note: ${s.client_note}</em>` : '';
    const fav = s.is_favorite ? ' ★' : '';
    return `
      <tr style="border-bottom: 1px solid #f0f0f0;">
        <td style="padding: 10px 8px; font-size: 13px; color: #888;">${i + 1}</td>
        <td style="padding: 10px 8px; font-family: 'Courier New', monospace; font-size: 14px;">
          ${s.filename}${fav}${note}
        </td>
      </tr>`;
  }).join('');

  const packageInfo = session.package_name
    ? `<p><strong>Package:</strong> ${session.package_name} (${session.num_included} images included)</p>`
    : '';

  const studioNotes = session.notes
    ? `<p><strong>Studio notes:</strong> ${session.notes}</p>`
    : '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
      <h1 style="font-size: 22px;">Edit Brief</h1>
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
      <p><strong>Client:</strong> ${session.client_name}</p>
      <p><strong>Email:</strong> ${session.client_email}</p>
      ${packageInfo}
      <p><strong>Images selected:</strong> ${selections.length}</p>
      <p><strong>Submitted:</strong> ${session.submitted_at || 'N/A'}</p>
      ${studioNotes}
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">
      <h2 style="font-size: 16px; letter-spacing: 0.05em; text-transform: uppercase;">Selected Files</h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
        <thead>
          <tr style="background: #f8f8f8;">
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #888; width: 40px;">#</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #888;">Filename</th>
          </tr>
        </thead>
        <tbody>${fileRows}</tbody>
      </table>
      <p style="margin-top: 24px; font-size: 12px; color: #aaa;">★ = client favorite &nbsp;|&nbsp; Sent by ${process.env.STUDIO_NAME}</p>
    </body>
    </html>
  `;

  // Also build a plain-text version
  const text = [
    `EDIT BRIEF — ${session.client_name}`,
    `${'─'.repeat(40)}`,
    `Client: ${session.client_name} (${session.client_email})`,
    session.package_name ? `Package: ${session.package_name} (${session.num_included} images)` : '',
    `Images selected: ${selections.length}`,
    `Submitted: ${session.submitted_at || 'N/A'}`,
    session.notes ? `Studio notes: ${session.notes}` : '',
    '',
    'SELECTED FILES:',
    ...selections.map((s, i) => {
      const fav = s.is_favorite ? ' [FAVORITE]' : '';
      const note = s.client_note ? ` — ${s.client_note}` : '';
      return `${String(i + 1).padStart(3, ' ')}. ${s.filename}${fav}${note}`;
    }),
  ].filter(line => line !== null && line !== undefined).join('\n');

  await transporter.sendMail({
    from: `"${process.env.STUDIO_NAME}" <${process.env.SMTP_USER}>`,
    to: process.env.STUDIO_EMAIL,
    subject,
    html,
    text,
  });
}

/**
 * Notify client their selection was received
 */
async function sendClientConfirmation({ clientName, clientEmail, selectionCount }) {
  const transporter = getTransporter();

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Georgia, serif; max-width: 580px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
      <h1 style="font-size: 26px;">${process.env.STUDIO_NAME}</h1>
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
      <p>Hi ${clientName},</p>
      <p>We've received your selection of <strong>${selectionCount} images</strong>. Thank you!</p>
      <p>We'll begin editing and will be in touch when your finished images are ready.</p>
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
      <p style="color: #888; font-size: 13px;">${process.env.STUDIO_NAME}</p>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"${process.env.STUDIO_NAME}" <${process.env.SMTP_USER}>`,
    to: clientEmail,
    subject: `Selection received — we're on it!`,
    html,
  });
}

module.exports = { sendClientInvite, sendEditorBrief, sendClientConfirmation };

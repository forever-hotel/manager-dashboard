function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  );
}

function emailLayout(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px 12px;background:#f5f3ef;font-family:Arial,Helvetica,sans-serif;color:#1a1a18;line-height:1.6"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border:1px solid #ddd8cf;border-radius:12px;overflow:hidden;background:#ffffff"><tr><td style="padding:24px 28px;background:#12263a;color:#ffffff"><div style="font-size:20px;font-weight:700">Forever Hotel</div><div style="font-size:12px;color:#e8eef4;letter-spacing:2px">STAFF ACCOUNTS</div></td></tr><tr><td style="height:4px;background:#c9920d"></td></tr><tr><td style="padding:28px"><h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#1a3c5e">${title}</h1>${content}</td></tr><tr><td style="padding:20px 28px;border-top:1px solid #ddd8cf;color:#5a5650;font-size:12px">Forever Hotel &middot; Account security<br>This is an automated message. For assistance, contact your hotel administrator.</td></tr></table></td></tr></table></body></html>`;
}

export function staffAccountEmail(credentials: { email: string; username: string; password: string; role: string }) {
  const role = credentials.role
    .split(/[, ]+/)
    .filter(Boolean)
    .map(value =>
      value
        .toLowerCase()
        .replaceAll('_', ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase())
    )
    .join(', ');
  return {
    subject: 'Welcome to Forever Hotel - your staff account is ready',
    textContent: `Welcome to Forever Hotel!\n\nYour staff account is ready.\nRole(s): ${role}\nSign-in email: ${credentials.email}\nTemporary password: ${credentials.password}\n\nGetting started\n1. Open the staff system address provided by your hotel administrator.\n2. Sign in with the credentials above.\n3. Choose a new password when prompted before accessing your work area.\n\nYour account works in the systems allowed by your assigned roles. Never share your temporary password. If you were not expecting this account, contact your hotel administrator.\n\nForever Hotel | Account security`,
    htmlContent: emailLayout(
      'Your staff account is ready',
      `<p>Welcome to the Forever Hotel team. Your administrator has created your staff account.</p><table role="presentation" width="100%" cellpadding="12" cellspacing="0" style="margin:20px 0;background:#e8eef4;border:1px solid #ddd8cf;border-radius:8px"><tr><td style="font-size:12px;color:#5a5650">ROLE(S)<br><strong style="font-size:15px;color:#1a3c5e">${escapeHtml(role)}</strong></td></tr><tr><td style="border-top:1px solid #ddd8cf;font-size:12px;color:#5a5650">SIGN-IN EMAIL<br><strong style="font-size:16px;color:#1a3c5e;word-break:break-all">${escapeHtml(credentials.email)}</strong></td></tr><tr><td style="border-top:1px solid #ddd8cf;font-size:12px;color:#5a5650">TEMPORARY PASSWORD<br><code style="font-size:16px;color:#1a3c5e;word-break:break-all">${escapeHtml(credentials.password)}</code></td></tr></table><h2 style="font-size:16px;color:#1a3c5e">Get started in three steps</h2><ol style="padding-left:20px"><li>Open the staff system address provided by your hotel administrator.</li><li>Sign in using the credentials above.</li><li><strong>Choose a new password</strong> when prompted before accessing your work area.</li></ol><p style="font-size:13px;color:#5a5650">Your assigned roles determine which systems you can access.</p><p style="padding:14px;background:#fdf6e3;border-left:3px solid #c9920d;font-size:13px"><strong>Keep your account secure.</strong> Never share your temporary password. If you were not expecting this account, contact your hotel administrator.</p>`
    )
  };
}

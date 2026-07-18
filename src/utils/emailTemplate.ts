type EmailSection = {
  html: string;
};

type EmailTemplateOptions = {
  title: string;
  intro?: string;
  sections: EmailSection[];
  cta?: {
    label: string;
    href: string;
    backgroundColor?: string;
  };
  note?: string;
  footerNote?: string;
};

const BRAND_NAME = 'Campo do Bosque';
const BRAND_SUBTITLE = 'Plataforma de Assistência Funeral';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTextAsHtmlParagraphs(text: string): string {
  return String(text)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const html = escapeHtml(block).replace(/\n/g, '<br />');
      return `<p style="margin:0 0 16px;font-size:14px;color:#616161;line-height:1.7;">${html}</p>`;
    })
    .join('');
}

export function buildStandardEmailTemplate(options: EmailTemplateOptions): string {
  const sectionsHtml = options.sections.map((section) => section.html).join('');
  const ctaHtml = options.cta
    ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(options.cta.href)}"
                      style="display:inline-block;background:${options.cta.backgroundColor ?? '#2d7a1f'};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:999px;">
                      ${escapeHtml(options.cta.label)}
                    </a>
                  </td>
                </tr>
              </table>
            `
    : '';
  const noteHtml = options.note
    ? `<p style="margin:0 0 8px;font-size:13px;color:#9e9e9e;text-align:center;line-height:1.6;">${options.note}</p>`
    : '';
  const footerNoteHtml = options.footerNote
    ? `<p style="margin:0;font-size:12px;color:#bdbdbd;line-height:1.6;">${options.footerNote}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">
          <tr>
            <td style="background:linear-gradient(135deg,#2d7a1f 0%,#3a9b28 60%,#1eba4b 100%);padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">${BRAND_NAME}</p>
              <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">${BRAND_SUBTITLE}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#212121;">${escapeHtml(options.title)}</p>
              ${options.intro ? `<p style="margin:0 0 24px;font-size:14px;color:#616161;line-height:1.6;">${options.intro}</p>` : ''}
              ${sectionsHtml}
              ${ctaHtml}
              ${noteHtml}
              ${footerNoteHtml ? `<hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0;" />${footerNoteHtml}` : ''}
            </td>
          </tr>
          <tr>
            <td style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #f0f0f0;text-align:center;">
              <p style="margin:0;font-size:12px;color:#bdbdbd;">
                ${BRAND_NAME} &copy; ${new Date().getFullYear()} — ${BRAND_SUBTITLE}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

import config from '../config';
import { Buffer } from 'buffer';

export async function uploadToFilesApi(
  tenantId: string,
  fileBase64: string,
  filename: string,
  mimeType: string,
): Promise<{ url: string }> {
  const tokenEnv =
    tenantId.toUpperCase() === 'PAX'
      ? process.env.FILES_API_TOKEN_PAX
      : process.env.FILES_API_TOKEN_LIDER || process.env.FILES_API_TOKEN_PAX;

  if (!tokenEnv) {
    throw new Error('Token de arquivos não configurado');
  }

  const buffer = Buffer.from(fileBase64, 'base64');
  const blob = new Blob([buffer], { type: mimeType });
  const form = new FormData();
  form.append('file', blob, filename);

  const baseUrl = process.env.FILES_API_URL || '';
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/file/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenEnv}`,
    },
    body: form as any,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Falha ao enviar arquivo: ${res.status} ${text}`);
  }

  const data = await res.json();
  return { url: data?.url ?? data?.fileUrl ?? data?.data?.url ?? '' };
}

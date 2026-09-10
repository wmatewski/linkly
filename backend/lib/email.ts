import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY
const from = process.env.RESEND_FROM_EMAIL
const resend = apiKey ? new Resend(apiKey) : null

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!)
}

async function send(to: string, subject: string, body: string) {
  if (!resend || !from) {
    console.warn('E-mail was not sent: RESEND_API_KEY or RESEND_FROM_EMAIL is not configured.')
    return
  }
  const { error } = await resend.emails.send({ from, to, subject, html: `<main style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#17221d;line-height:1.6"><h1 style="color:#163c2b">Linkly</h1>${body}<p style="margin-top:32px;color:#65736b;font-size:13px">Wiadomość została wysłana automatycznie przez Linkly.</p></main>` })
  if (error) throw new Error(`Resend: ${error.message}`)
}

export const sendWelcomeEmail = (to: string, name: string) => send(to, 'Witaj w Linkly', `<p>Cześć ${escapeHtml(name)}!</p><p>Twoje konto zostało utworzone. Możesz już tworzyć krótkie linki i przeglądać ich analitykę.</p>`)
export const sendLoginEmail = (to: string, name: string | null) => send(to, 'Nowe logowanie do Linkly', `<p>Cześć ${escapeHtml(name || 'użytkowniku')}!</p><p>Właśnie wykryliśmy nowe logowanie do Twojego konta Linkly. Jeśli to nie Ty, zmień hasło do konta.</p>`)
export const sendPasswordChangedEmail = (to: string, name: string | null) => send(to, 'Hasło do Linkly zostało zmienione', `<p>Cześć ${escapeHtml(name || 'użytkowniku')}!</p><p>Hasło do Twojego konta Linkly zostało właśnie zmienione. Jeśli nie wykonywałeś tej operacji, niezwłocznie zresetuj hasło.</p>`)
export const sendPasswordResetEmail = (to: string, name: string | null, resetUrl: string) => send(to, 'Reset hasła do Linkly', `<p>Cześć ${escapeHtml(name || 'użytkowniku')}!</p><p>Otrzymaliśmy prośbę o zresetowanie hasła. Link jest ważny przez godzinę.</p><p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:12px 18px;background:#163c2b;color:white;text-decoration:none;border-radius:6px">Ustaw nowe hasło</a></p><p>Jeśli nie prosiłeś o reset hasła, zignoruj tę wiadomość.</p>`)

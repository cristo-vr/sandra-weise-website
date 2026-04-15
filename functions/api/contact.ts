/**
 * Cloudflare Pages Function: Contact form handler
 *
 * Validates Cloudflare Turnstile token, then posts the form data
 * to a Notion database via the Notion API.
 *
 * Environment variables required (set in Cloudflare Pages dashboard):
 *   TURNSTILE_SECRET_KEY  — Cloudflare Turnstile secret key
 *   NOTION_API_KEY        — Notion integration token
 *   NOTION_DATABASE_ID    — Notion database ID for contact submissions
 */

interface Env {
  TURNSTILE_SECRET_KEY: string;
  NOTION_API_KEY: string;
  NOTION_DATABASE_ID: string;
}

interface ContactPayload {
  name: string;
  email: string;
  subject: string;
  message: string;
  token: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Parse body
  let body: ContactPayload;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { name, email, subject, message, token } = body;

  // Validate required fields
  if (!name || !email || !subject || !message || !token) {
    return new Response(JSON.stringify({ error: 'All fields are required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify Turnstile token
  const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: request.headers.get('CF-Connecting-IP') || '',
    }),
  });

  const turnstileData = await turnstileRes.json() as { success: boolean };

  if (!turnstileData.success) {
    return new Response(JSON.stringify({ error: 'Verification failed. Please try again.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Post to Notion
  try {
    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: env.NOTION_DATABASE_ID },
        properties: {
          Name: {
            title: [{ text: { content: name } }],
          },
          Email: {
            email: email,
          },
          Subject: {
            select: { name: subject },
          },
          Message: {
            rich_text: [{ text: { content: message.slice(0, 2000) } }],
          },
          'Submitted At': {
            date: { start: new Date().toISOString() },
          },
          Source: {
            select: { name: 'sandraweise.com' },
          },
        },
      }),
    });

    if (!notionRes.ok) {
      const err = await notionRes.text();
      console.error('Notion API error:', err);
      return new Response(JSON.stringify({ error: 'Failed to submit. Please try again.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Notion submission error:', err);
    return new Response(JSON.stringify({ error: 'Server error. Please try again later.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

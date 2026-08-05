// api/notify.js — Vercel Serverless Function
// REST API Key שמור ב-ONESIGNAL_API_KEY Environment Variable ב-Vercel

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://medickids.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ביטול התראה מתוזמנת שעדיין לא נשלחה — נקרא כשמנה נדחית/נמחקת/מוחלפת במנה חדשה
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const response = await fetch(
        `https://onesignal.com/api/v1/notifications/${id}?app_id=${process.env.ONESIGNAL_APP_ID}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Key ${process.env.ONESIGNAL_API_KEY}` },
        }
      );
      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json({ error: data });
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, message, childName, scheduledTime, medEntryId, targetDeviceId, buttons } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: 'title and message are required' });
  }
  // fail closed: never fall back to broadcasting to every subscriber if we don't
  // know who this reminder is for (e.g. an old cached client that hasn't updated yet).
  if (!targetDeviceId) {
    return res.status(400).json({ error: 'targetDeviceId is required — refusing to broadcast to all subscribers' });
  }

  const payload = {
    app_id: process.env.ONESIGNAL_APP_ID,
    include_aliases: { external_id: [targetDeviceId] },
    target_channel: 'push',
    headings: { en: title, he: title },
    contents: { en: message, he: message },
    data: { childName, medEntryId },
  };

  // כפתורי פעולה מהירה
  if (buttons) {
    payload.web_buttons = buttons;
  }

  // תזמון לשעה עתידית
  if (scheduledTime) {
    payload.send_after = scheduledTime; // ISO string: "2024-01-01T10:00:00Z"
  }

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${process.env.ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    return res.status(200).json({ success: true, notificationId: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

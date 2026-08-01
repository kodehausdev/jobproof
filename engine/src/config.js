require('dotenv').config();

const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    liveModel: process.env.GEMINI_LIVE_MODEL || 'gemini-2.0-flash-live-001',
    // Vertex AI path (production / BAA route). Auth is Application Default
    // Credentials — `gcloud auth application-default login` locally, or an
    // attached service account when deployed. No API key, no key file.
    useVertex: process.env.GEMINI_USE_VERTEX === 'true',
    project: process.env.GOOGLE_CLOUD_PROJECT || '',
    location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
  },

  supabase: {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || '',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || '',
    // Outbound SMS fallback From. Usually unneeded: replies go out from the
    // tenant number the inbound text arrived on.
    smsNumber: process.env.TWILIO_SMS_NUMBER || '',
    // Enable on deployed engines (needs the exact public URL to verify).
    validateWebhooks: process.env.TWILIO_VALIDATE_WEBHOOKS === 'true',
  },

  tenant: {
    id: process.env.TENANT_ID || 'default',
    labName: process.env.BUSINESS_NAME || 'Jobproof',
    timezone: process.env.BUSINESS_TIMEZONE || 'America/New_York',
    openHour: Number(process.env.BUSINESS_OPEN_HOUR || 8),
    closeHour: Number(process.env.BUSINESS_CLOSE_HOUR || 17),
    slotCapacity: Number(process.env.SLOT_CAPACITY || 2),
    // Owner/dispatcher phone texted on each new booking (see
    // services/twilio.js notifyOwner()). Blank disables it.
    notifyPhone: process.env.NOTIFY_PHONE || '',
  },
};

module.exports = config;

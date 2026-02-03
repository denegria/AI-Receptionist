# Client Configuration Guide

## Overview
This directory contains client configuration files. Each client has their own JSON file that defines business settings, hours, and AI behavior.

---

## 🚀 Adding a New Client

### Option 1: Via Admin Panel (Recommended - Coming Soon)
Future admin panel will allow adding clients without code changes.

### Option 2: Manual Setup (Current Method)

**Step 1: Create Config File**
```bash
# Create a new file: config/clients/client-{clientId}.json
# Use a short, URL-safe ID (e.g., 'xyz', 'acme', 'smith-hvac')
```

**Step 2: Copy Template**
```json
{
  "clientId": "your-client-id",
  "businessName": "Your Business Name",
  "phoneNumber": "+1234567890",
  "timezone": "America/New_York",
  
  "businessHours": {
    "monday": { "start": "08:00", "end": "17:00", "enabled": true },
    "tuesday": { "start": "08:00", "end": "17:00", "enabled": true },
    "wednesday": { "start": "08:00", "end": "17:00", "enabled": true },
    "thursday": { "start": "08:00", "end": "17:00", "enabled": true },
    "friday": { "start": "08:00", "end": "17:00", "enabled": true },
    "saturday": { "start": "09:00", "end": "13:00", "enabled": true },
    "sunday": { "enabled": false }
  },
  
  "holidays": [
    "2025-12-25",
    "2025-01-01"
  ],
  
  "appointmentTypes": [
    {
      "name": "Service Call",
      "duration": 60,
      "bufferBefore": 0,
      "bufferAfter": 15
    }
  ],
  
  "calendar": {
    "provider": "google",
    "calendarId": "primary",
    "syncEnabled": true,
    "createMeetLinks": false
  },
  
  "routing": {
    "afterHoursAction": "ai_receptionist",
    "fallbackNumber": "+1234567890",
    "voicemailEnabled": true
  },
  
  "aiSettings": {
    "greeting": "Hi! Thanks for calling [Business Name]. How can I help you today?",
    "maxRetries": 3,
    "requireServiceType": false
  }
}
```

**Step 3: Configure Twilio**
1. Buy a Twilio phone number
2. Set webhook URL: `https://your-app.fly.dev/voice?clientId=your-client-id`
3. Set method: `POST`

**Step 4: Authenticate Calendar**
1. Visit: `https://your-app.fly.dev/auth/google/start?clientId=your-client-id`
2. Sign in with Google
3. Grant calendar permissions

**Step 5: Test**
Call the Twilio number to test the AI receptionist!

---

## 📋 Configuration Fields

### Required Fields
- **clientId**: Unique identifier (URL-safe, lowercase)
- **businessName**: Display name for the business
- **phoneNumber**: Twilio phone number in E.164 format
- **timezone**: IANA timezone (e.g., `America/New_York`)

### Business Hours
- **start/end**: 24-hour format (e.g., `"08:00"`, `"17:00"`)
- **enabled**: `true` or `false`

### Appointment Types
- **name**: Service name
- **duration**: Minutes (e.g., 60)
- **bufferBefore**: Minutes before appointment
- **bufferAfter**: Minutes after appointment

### Calendar
- **provider**: `"google"` or `"outlook"`
- **calendarId**: Usually `"primary"`
- **syncEnabled**: Enable calendar sync
- **createMeetLinks**: Add Google Meet links

### AI Settings
- **greeting**: Custom greeting message
- **maxRetries**: Number of retry attempts
- **requireServiceType**: Force service type selection

---

## 🔒 Security Notes

> [!CAUTION]
> **Never commit calendar credentials to this file!**
> 
> Calendar credentials are stored encrypted in the database after OAuth authentication.
> This config file should NOT contain any `credentials` object.

---

## 🗂️ Database Architecture

Each client gets their own isolated database:

```
data/
├── client-abc.db          ← ABC's private data
├── client-xyz.db          ← XYZ's private data
└── shared.db              ← Client registry only
```

**What's in each client DB:**
- Calendar credentials (encrypted)
- Appointments
- Call logs & transcripts
- Voicemails
- Usage metrics

**What's in shared DB:**
- Client registry (who exists, status, phone number)
- No sensitive data

---

## 🚨 Troubleshooting

**Client not found:**
- Check `clientId` matches filename
- Verify Twilio webhook URL includes correct `?clientId=`

**Calendar not working:**
- Re-authenticate: `/auth/google/start?clientId=your-id`
- Check calendar permissions

**Calls not routing:**
- Verify Twilio webhook is set correctly
- Check phone number format (E.164)

---

## 📞 Support

For issues or questions, contact your system administrator.

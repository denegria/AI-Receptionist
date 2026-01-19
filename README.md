# 🤖 AI Receptionist MVP

> A smart voice assistant for HVAC and Service Businesses that handles after-hours calls and books appointments directly into Google or Outlook Calendar.

## 🚀 Features

-   **📞 Smart Voice Interface**: Conversational AI powered by **Deepgram** (STT/TTS) and **LLM** (Claude/GPT).
-   **📅 Calendar Integration**: Seamless booking with **Google Calendar** and **Outlook**.
-   **⚙️ Centralized Configuration**: Robust handling of environment variables and secrets.
-   **🏢 Multi-Client Support**: JSON-based configuration for different business hours and settings.
-   **💾 Local Caching**: SQLite database for high-performance availability checks.
-   **🛡️ Resilience**: STT confidence thresholding and sliding conversation memory pruning.
-   **🗄️ Database Evolution**: Built-in migration runner for seamless schema updates.
-   **🩺 Health Monitoring**: Dedicated `/health` endpoint for DB and API vitality.
-   **🔌 Extensible Architecture**: Modular **Node.js** and **TypeScript** foundation.

## 🛠️ Tech Stack

-   **Runtime**: Node.js v20+
-   **Language**: TypeScript
-   **Server**: Express + `express-ws`
-   **Telephony**: Twilio Media Streams
-   **AI/Voice**: Deepgram Aura & Nova-2
-   **Database**: SQLite (`better-sqlite3`)

## 📦 Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/denegria/AI-Receptionist.git
    cd AI-Receptionist
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Setup Environment**:
    Copy the example env file and fill in your credentials:
    ```bash
    cp .env.example .env
    ```

4.  **Run the Server**:
    ```bash
    npm run dev
    ```

## 🏗️ Project Structure

```text
src/
├── api/                  # Routing & Middleware
├── services/             # Core Logic (Telephony, Voice, AI, Scheduling)
├── db/                   # Database Client & Repositories
├── utils/                # Foundational Utilities (Crypto, Date, Phone)
├── models/               # Domain Models & Interfaces
└── server.ts             # Application Entry Point
```

## 🛠️ Configuration

### 1. Environment Variables (`.env`)
```env
# Core
PORT=3000
ENCRYPTION_KEY=your-32-byte-hex-key

# AI
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=...

# Telephony
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
```

### 2. Client Config (`config/clients/client-abc.json`)
```json
{
  "clientId": "client-abc",
  "businessName": "Comfort HVAC",
  "phoneNumber": "+15551234567",
  "timezone": "America/New_York",
  "calendar": {
    "provider": "google",
    "calendarId": "primary"
  },
  "notifications": {
    "sms": "+15559876543"
  }
}
```

## 📖 How it Works

1.  **Incoming Call**: Twilio sends a webhook to `/voice`.
2.  **Media Stream**: Server establishes a WebSocket connection for bidirectional audio.
3.  **Processing**: Deepgram converts audio to text, Claude determines intent.
4.  **Tool Use**: AI checks calendar availability or books an appointment via the unified `SchedulerService`.
5.  **Fallback**: If AI is confused, the `take_voicemail` tool is triggered for a recording fallback.
6.  **Response**: Text is converted back to audio and streamed to the caller.

---

---

## 🗺️ Project Roadmap

### ✅ Completed
- [x] **Phase 1-5**: Core infrastructure, Voice integration, and Calendar booking.
- [x] **Phase 6**: Production hardening & Modularization.
- [x] **Phase 7**: Resilience & Voicemail Fallback system.
- [x] **Phase 8**: Structured Prompting & Few-Shot Learning.
- [x] **Phase 9**: Final MVP Polish, STT Resilience, and Migration System.
- [x] **Production Readiness (New)**:
    - **Deployment**: Docker, Fly.io config, Rate Limiting.
    - **Reliability**: Call State Machine, 10m limit, ASR confidence gates.
    - **Trust**: Tiered Fallback System (Soft -> Hard -> Crash) & SMS Dispatch.
    - **Observability**: Structural JSON Logging (Console/File) & Fly.io persistence.

### 🚀 Upcoming (Next Steps)

#### Phase 10: Live Staging & QA
- [ ] **End-to-End Testing**: Verify fallbacks and booking limits in a live staged environment.
- [ ] **Load Testing**: Validate rate limits and concurrent call handling.

#### Phase 11: Scaling & Multi-Tenancy
- [ ] **Admin Dashboard**: Web interface for clients to view logs and voicemails.
- [ ] **Self-Serve Auth**: Automated OAuth onboarding flow for Google/Outlook.
- [ ] **RAG for FAQ**: Business-specific knowledge base injection.

#### Phase 12: Advanced Professional Features
- [ ] **Smart Rescheduling**: Two-way SMS interaction for modifying appointments.
- [ ] **Sentiment Analysis**: Post-call analytics for quality assurance.

---
*Built with ❤️ by Alvaro*
# 🤖 AI Receptionist MVP

> A smart voice assistant for HVAC and Service Businesses that handles after-hours calls and books appointments directly into Google or Outlook Calendar.

## 🚀 Features

-   **📞 Smart Voice Interface**: Conversational AI powered by **Deepgram** (STT/TTS) and **Claude 3.5 Sonnet**.
-   **⚡ Low-Latency Architecture**: Streaming pipeline with VAD tuning and immediate greetings (**~0.4s response overhead**).
-   **💰 Cost Efficiency**: **Anthropic Prompt Caching** reduces input token costs by up to **90%**.
-   **📅 Calendar Integration**: Seamless booking with **Google Calendar** and **Outlook**.
-   **🏢 Multi-Client Support**: Multi-tenant architecture with **Database-backed Registry** and partitioned shards.
-   **⚙️ Centralized Configuration**: Robust handling of environment variables, secrets, and client-specific business rules.
-   **🛡️ Resilience**: STT confidence thresholding, sliding memory window, and tiered fallback systems.
-   **🗄️ Database Evolution**: Built-in migration runner for schema updates across all client shards.
-   **🩺 Health Monitoring**: Dedicated `/health` endpoint for DB and API vitality.
-   **🔌 Extensible Architecture**: Modular **Node.js** and **TypeScript** foundation.

## 🛠️ Tech Stack

-   **Runtime**: Node.js v20+
-   **Language**: TypeScript
-   **Server**: Express + `express-ws`
-   **Telephony**: Twilio Media Streams
-   **AI/Voice**: Deepgram (Nova-2 STT / Aura TTS)
-   **LLM**: Claude 3.5 Sonnet (with Prompt Caching)
-   **Database**: SQLite (`better-sqlite3`) with per-client sharding

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
├── api/                  # Routing & Middleware (Twilio, Webhooks, Auth)
├── services/             # Core Logic (Telephony, Voice, AI, Scheduling)
├── db/                   # Global Registry & Per-Client Shards
├── utils/                # Foundational Utilities (Crypto, Date, Phone)
├── models/               # Domain Models & Interfaces
└── server.ts             # Application Entry Point
```

## 🛠️ Configuration

### 1. Environment Variables (`.env`)
```env
# Core
PORT=8080
ENCRYPTION_KEY=your-32-byte-hex-key

# AI
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=...

# Telephony
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
TWILIO_STATUS_CALLBACK_URL=...

# Feature Flags
ENABLE_STREAMING_LLM=true
ENABLE_STREAMING_TTS=true
```

## 🏢 Client Management

### 1. Client Registry (`shared.db`)

Client configurations are stored in the **Global Registry** (`shared.db`). This allows for dynamic updates without restarting the server.

### 2. How to Onboard (No-Deploy Flow)

To add a new client without redeploying the code:

1.  **Prepare Config**: Use the [client-template.json] as a starting point.
2.  **Upload**: Use `fly sftp shell` (or any SFTP tool) to drop the JSON file into the `/app/data/onboarding` folder on the server.
3.  **Automatic Ingestion**:
    *   The `OnboardingWatcher` service polls this folder every 10 seconds.
    *   It validates the JSON, registers it in `shared.db`, and clears the runtime cache.
    *   The file is renamed to `.processed` upon success.
4.  **Live**: The new client is now active! The AI will immediately recognize calls to their specific Twilio number.

...

## 📖 How it Works

1.  **Incoming Call**: Twilio sends a webhook to `/voice`.
2.  **Media Stream**: Server establishes a WebSocket connection.
3.  **Registry Lookup**: The server fetches the client's business rules from the `shared.db` using the `clientId` provided in the stream parameters.
4.  **Processing**: Deepgram converts audio to text, **Claude 3.5 Sonnet** determines intent using cached prompts.
5.  **Data Persistence**: Call logs and turns are saved to the **client-specific database shard**.
6.  **Response**: Text is converted to audio and streamed to the caller with sub-500ms latency.

---

---

## 🗺️ Project Roadmap

### ✅ Completed
- [x] **Phase 1-5**: Core infrastructure, Voice integration, and Calendar booking.
- [x] **Phase 6**: Production hardening & Modularization.
- [x] **Phase 7**: Resilience & Voicemail Fallback system.
- [x] **Phase 8**: Structured Prompting & Few-Shot Learning.
- [x] **Phase 9**: Final MVP Polish, STT Resilience, and Migration System.
- [x] **Production Readiness**:
    - **Deployment**: Docker, Fly.io config, Rate Limiting.
    - **Reliability**: Call State Machine, 10m limit, ASR confidence gates.
    - **Trust**: Tiered Fallback System (Soft -> Hard -> Crash) & SMS Dispatch.
    - **Observability**: Structural JSON Logging & Fly.io persistence.
- [x] **Performance & Unit Economics**:
    - **Latency**: Reduced response overhead to ~400ms via VAD tuning and immediate greeting.
    - **Cost**: Integrated Anthropic Prompt Caching (90% savings on input tokens).
    - **Privacy**: Partitioned all operational data into client-specific databases.

### 🚀 Upcoming (Next Steps)

#### Phase 10: Live Staging & QA
- [ ] **End-to-End Testing**: Verify fallbacks and booking limits in a live staged environment.
- [ ] **Automated Regression**: Build a suite of voice-simulation tests to prevent STT regressions.
- [ ] **Load Testing**: Validate rate limits and concurrent call handling.

#### Phase 11: Scaling & Multi-Tenancy
- [ ] **Admin Dashboard**: Web interface for clients to view logs and voicemails.
- [ ] **Self-Serve Auth**: Automated OAuth onboarding flow for Google/Outlook.
- [ ] **RAG for FAQ**: Business-specific knowledge base injection.

#### Phase 12: Advanced Professional Features
- [ ] **Smart Rescheduling**: Two-way SMS interaction for modifying appointments.
- [ ] **Sentiment Analysis**: Post-call analytics for quality assurance.

---

## 📈 Production Case Study (Jan 24, 2026)

Following the implementation of **Prompt Caching** and **VAD Tuning**, we observed the following results in a real-world test call:

### **1. Latency (The "Human" Factor)**
- **Previous Overhead**: ~1,200ms per turn.
- **Current Overhead**: **~300ms - 500ms**.
- **Impact**: The AI now "breathes" naturally and responds instantly to interjections, making it nearly indistinguishable from a human receptionist for short phrases.

### **2. Economy (The "Scalability" Factor)**
- **Sample Call Duration**: 119 seconds.
- **Tokens (Input)**: 34,276.
- **Traditional Cost**: ~$0.11 / call.
- **Optimized Cost**: **~$0.02 / call**.
- **Savings**: **~80% reduction** in LLM costs for multi-turn conversations through prompt caching.

### **3. Data Isolation**
- Verified that **Voicemails** and **Call Logs** are correctly routed to `client-abc.db`, while system logs remain centralized in `app.db` for observability.

---
*Built with ❤️ by Alvaro*

## 🛡️ Security Hardening & Automated Onboarding (Feb 2026)

This update introduces critical security patches and a streamlined, "no-deploy" client onboarding process.

### 1. Security Patches
*   **Disk Bomb Prevention**: The system no longer automatically creates client-specific database shards upon request. Database connections are now strictly limited to existing client IDs in the registry, preventing malicious actors from exhausting disk space via random ID spoofing.
*   **Wallet Drain Protection**: WebSocket stream connections now require a valid `clientId` registered in the Global Registry. This prevents unauthorized usage of billable AI services (STT, LLM, TTS) by unauthenticated connections.
*   **Voicemail Lock**: All Twilio callbacks, including voicemail processing and status updates, are now protected by **Twilio Signature Validation**. This ensures that only legitimate requests from Twilio can trigger backend logic or modify state.

### 2. Automated Onboarding (No-Deploy Flow)
We have implemented a background watcher service that enables dynamic client registration without code changes or restarts.

*   **Watcher Service**: The `OnboardingWatcher` monitors the `/app/data/onboarding` directory.
*   **Ingestion Logic**: Dropping a valid JSON configuration into the folder triggers automatic validation, database registration, and cache invalidation.
*   **State Management**: Successfully processed files are renamed to `.processed`, while invalid ones are marked `.error` to prevent retry loops.
*   **Live Updates**: New clients become active immediately, and existing configurations can be updated by simply dropping a new JSON file with the same `clientId`.

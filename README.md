# 🤖 AI Receptionist MVP

> A smart voice assistant for HVAC and Service Businesses that handles after-hours calls and books appointments directly into Google or Outlook Calendar.

## 🚀 Features

-   **📞 Smart Voice Interface**: Conversational AI powered by **Deepgram** (STT/TTS) and **LLM** (Claude/GPT).
-   **📅 Calendar Integration**: Seamless booking with **Google Calendar** and **Outlook**.
-   **⚙️ centralized Configuration**: Robust handling of environment variables and secrets.
-   **🏢 Multi-Client Support**: JSON-based configuration for different business hours, holidays, and settings.
-   **💾 Local Caching**: SQLite database for high-performance availability checks and appointment tracking.
-   **🔌 Extensible Architecture**: built with **Node.js**, **Express**, and **TypeScript**.

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
├── config.ts                    # Centralized Config
├── server.ts                    # Entry Point
├── db/                          # SQLite Database
│   ├── client.ts                # DB Connection
│   └── schema.sql               # Tables Definition
├── models/                      # Data Models
│   └── client-config.ts         # Client Settings Loader
└── services/                    # Business Logic
```

## 📝 Roadmap

-   [x] Phase 1: Project Setup & Foundation
-   [x] Phase 2: Configuration & Database Schema
-   [x] Phase 3: Calendar Services (Google/Outlook)
-   [x] Phase 4: Voice & AI Services
-   [ ] Phase 5: Integration Testing

---
*Built with ❤️ by Alvaro*
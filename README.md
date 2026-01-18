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
├── api/                  # Routing & Middleware
├── services/             # Core Logic (Telephony, Voice, AI, Scheduling)
├── db/                   # Database Client & Repositories
├── utils/                # Foundational Utilities (Crypto, Date, Phone)
├── models/               # Domain Models & Interfaces
└── server.ts             # Application Entry Point
```

## 🛠️ Setup & Installation

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/denegria/AI-Receptionist.git
    cd AI-Receptionist
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment Variables**:
    Copy `.env.example` to `.env` and fill in your keys:
    -   Twilio Account SID & Auth Token
    -   Deepgram API Key
    -   Anthropic / OpenAI API Key
    -   Google/Microsoft Client IDs & Secrets
    -   **ENCRYPTION_KEY**: A 64-character hex string (run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` to generate one).

4.  **Database Setup**:
    The SQLite database and schema will automatically initialize on first run.

## 🏁 Running the Application

-   **Development**: `npm run dev` (Runs with nodemon and ts-node)
-   **Test**: `npm test` (Runs Jest unit tests)
-   **Build**: `npm run build`
-   **Production**: `npm start`

## 📖 How it Works

1.  **Incoming Call**: Twilio sends a webhook to `/voice`.
2.  **Media Stream**: Server establishes a WebSocket connection for bidirectional audio.
3.  **Processing**: Deepgram converts audio to text, Claude determines intent.
4.  **Tool Use**: AI checks calendar availability or books an appointment via the unified `SchedulerService`.
5.  **Response**: Text is converted back to audio and streamed to the caller.

---
*Built with ❤️ by Alvaro*
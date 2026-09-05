# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

---

## CampusMate AI enhancements (added)

This project has been extended with a small Express proxy that forwards prompts to the OpenAI Chat API and a front-end integration for the AI assistant. Key additions:

- server/index.js — lightweight Express proxy. Protects your OpenAI API key by keeping it on the server.
- public/logo.svg — small app logo used in the sidebar.
- Front-end assistant now calls POST /api/ai (falls back to the local rule-based replies if the server is unavailable).

Quick start

1. Install dependencies for the front-end (from project root):

   npm install

2. Install server dependencies and start the production server:

   ```powershell
   Set-Location server
   npm install
   Copy-Item ..\.env.example .env
   # Set GEMINI_API_KEY (recommended) or OPENAI_API_KEY and a random JWT_SECRET (32+ chars) in server\.env
   # The assistant uses Gemini first, then OpenAI as a fallback.
   npm start
   ```

   From the project root, use `npm run start-server` for the same server.
   Verify configuration at `http://localhost:5174/api/health`; it must show `"aiConfigured":true`.

3. For local development, start the Vite front-end (in project root):

   npm run dev

Production and security

- The server expects OPENAI_API_KEY to be available in environment or a .env file. Do not commit your real keys.
- The server serves the Vite `dist` build and the API from one origin when `dist` exists. Put it behind HTTPS in production.
- The front-end calls `/api/ai` and `/api/ai-stream`; API access requires a valid login token.
- Optional: set PROXY_KEY in .env and clients must send it in the header x-proxy-key or Authorization: Bearer <PROXY_KEY> to use the API. This is a lightweight protection for the proxy.
- Chat history is persisted server-side in data/messages.json when available and is synchronized on Assistant load.

If you want, I can:
- Add Auth for the server or simple rate-limiting
- Add a richer chat UI with streaming responses
- Add e2e tests or linting rules for the new server code

Tell me which of the above you'd like implemented next.

## Live deployment on Render

This repository includes `render.yaml` for a Render web service and managed
Postgres database. Create a Render Blueprint from the repository, then add
`GEMINI_API_KEY` (recommended) or `OPENAI_API_KEY` in the service environment.
Render supplies `DATABASE_URL` and generates `JWT_SECRET` automatically.
The service runs the Vite build and Express API from the same HTTPS origin.
`GET /api/ping` is an unauthenticated keep-alive endpoint. On Render's free tier,
configure UptimeRobot or a GitHub Action to request it every 10 minutes if you
want to reduce cold starts.

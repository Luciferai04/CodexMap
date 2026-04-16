# CodexMap: Live Deployment Guide

To share your CodexMap dashboard live during the hackathon or with a remote team, we recommend using **Ngrok**. Since CodexMap relies on local file watching and WebSockets, a standard static host (like Vercel) won't work alone.

## 🛠 Prerequisites
1.  **Install Ngrok**: [Download here](https://ngrok.com/download) or use Homebrew: `brew install ngrok`.
2.  **CodexMap Running**: Ensure your `node start.js` is active.

## 🚀 Going Live (Step-by-Step)

### 1. Tunnel the UI (Port 3333)
Open a new terminal and run:
```bash
ngrok http 3333
```
Ngrok will give you a public URL (e.g., `https://a1b2-c3d4.ngrok.io`). This is your **Live Dashboard URL**.

### 2. Tunnel the WebSocket (Port 4242)
*Optional for remote viewing*: Since the frontend connects to `localhost:4242`, a remote user won't see live updates unless you also tunnel the WebSocket. 
*   **Pro Tip**: For the hackathon demo recording, running locally is usually sufficient. 
*   **For Remote Live Demo**: You would need to update `index.html` to point to the Ngrok WebSocket URL.

## 📦 Cloud Hosting Strategy (Advanced)
If you want a "Permanent" live demo:
1.  **Railway.app / Render.com**: Deploy the `serve.js` and `agents/` as a background service.
2.  **Persistence**: Use a cloud storage volume for the `/output` folder so the agents have consistent files to watch.

## 🔒 Security Note
> [!WARNING]
> Ngrok exposes your local server to the internet. Do not share your URL publicly if you have sensitive API keys in your environment variables.

---

**Your CodexMap pipeline is now ready for a world-wide audience!**

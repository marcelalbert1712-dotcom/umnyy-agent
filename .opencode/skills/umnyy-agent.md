---
description: Manus-подобный ИИ-агент с deep research, multi-agent оркестратором, browser automation, веб-поиском, фоновыми задачами и памятью
---

## Umnyy Agent — Skill для работы с проектом

### Запуск
- Dev-сервер: `pm2 restart ecosystem.config.cjs` (или `pm2 start ecosystem.config.cjs`)
- Доступ: http://localhost:5173/
- С телефона: http://192.168.0.101:5173/
- PM2 сохранение: `pm2 save`
- После редактирования server/*.ts: `pm2 restart ecosystem.config.cjs` (сервер сам не перезагружается)

### Ключевые файлы
- `server/polza-client.ts`: SYSTEM_PROMPT, streamText, auto-fact extraction, session memory
- `server/tools.ts`: все инструменты агента (webSearch, browserAgent, invokeAgent, runCode + ещё 10)
- `server/background-agent.ts`: фоновый агент (ручной raw API, 10 раундов)
- `server/task-queue.ts`: очередь фоновых задач
- `server/tasks-api.ts`: CRUD API для задач
- `server/browser-session.ts`: Playwright браузер с полным Chrome
- `server/mcp-manager.ts`: MCP-серверы (StdioClientTransport)
- `server/workspace.ts`: workspace CRUD
- `server/session-memory.ts`: авто-суммаризация диалогов
- `server/upload-api.ts`: загрузка изображений / vision
- `server/research-api.ts`: deep research (3 итерации)
- `server/ws-server.ts`: WebSocket для BrowserPanel

### Архитектура
- React 19 + Vite + TailwindCSS (frontend)
- Vite middleware (backend, встроенный в Vite)
- AI: PolzaAI (OpenAI-совместимый, ключ в `.env:POLZAAI_API_KEY`)
- Playwright Chromium для браузера и fallback веб-поиска

### Инструменты агента (tools.ts)
- `getCurrentTime`, `getWeather`, `webSearch`, `calculator`, `generateImage`, `runCode`
- `saveFile`, `downloadFile`, `browserAgent`, `saveUserFact`/`updateUserFact`/`deleteUserFact`
- `invokeAgent` — делегирование суб-агентам (до 3 раундов, параллельные вызовы)

### Multi-agent оркестрация
- Оркестратор (основной агент) может в одном шаге вызвать invokeAgent несколько раз
- Суб-агенты бегут параллельно через raw PolzaAI API
- Depth limit: invokeAgent исключён из инструментов суб-агента
- Суб-агенты: 3 раунда, temperature 0.3, все инструменты кроме invokeAgent

### Разное
- .env: `POLZAAI_API_KEY`, `POLZAAI_BASE_URL`, `POLZAAI_MODEL`, `POLZAAI_PROVIDER`
- При старте сервера все зависшие задачи (running/pending) сбрасываются в error
- Для юникод-путей: используй короткий `C:\Users\!!!~1\Documents\OPENCO~1\umnyy-agent`

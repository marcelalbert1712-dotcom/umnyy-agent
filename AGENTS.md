# Umnyy Agent — Summary

## Objective
Manus-подобный агент: запуск кода, multi-agent планирование, асинхронные задачи, воркспейсы, Computer Use

## Dev
- http://localhost:5173/ (Vite)
- **Важно**: используй короткий путь `C:\Users\!!!~1\Documents\OPENCO~1\umnyy-agent` вместо длинного с юникодом
- React 19 + TypeScript + Vite + TailwindCSS, бэкенд Vite middleware + Netlify Functions
- AI: PolzaAI, ключ в `.env`: `POLZAAI_API_KEY`
- Git: `C:\Program Files\Git\bin\git.exe`
- Playwright + Chromium (headless) установлены
- `@ai-sdk/react@4.0.18` + `ai@7.0.17` + `@ai-sdk/openai@4.0.8`
- `useChat` с `api="/api/chat"` + `experimental_throttle: 150`

## Completed Features
- **UI**: ползунок температуры, архив чатов, подсветка поиска, хоткеи
- **Код**: `/api/run-code` (JS + Python), кнопка Run на code-блоках
- **Планирование**: SYSTEM_PROMPT (Планируй→Исполняй→Анализируй→Сообщи), multi-agent
- **Асинхронные задачи**: task-queue + API + TaskPanel
- **Воркспейсы**: `/api/workspace` (CRUD), `saveFile` + `downloadFile` tools, WorkspacePanel
- **Computer Use**: Playwright browser, `/api/browser`, `browserAgent` tool, BrowserPanel
- **Веб-поиск**: `webSearch` tool — DuckDuckGo HTML scraping
- **Память**: `saveUserFact`/`updateUserFact`/`deleteUserFact` — facts fed in system prompt
- **Голосовой ввод**: MediaRecorder → Whisper API (`/api/transcribe`)
- **Озвучка**: SpeakButton с SpeechSynthesis на каждом сообщении ассистента
- **Визуализация tool-запросов**: Collapsible Tool-карточки (вход/выход/ошибка)
- **Повтор сообщения**: кнопка Retry на user-сообщениях (удаляет + отправляет заново)

## Tools
- `getCurrentTime`, `getWeather`, `webSearch`, `calculator`, `generateImage`
- `runCode` — JS (node -e) / Python (python или python3)
- `saveFile` — сохранение в workspace, возвращает httpPath
- `downloadFile` — скачать URL → workspace
- `browserAgent` — navigate/screenshot/click/type/scroll/getText/close
- `saveUserFact` / `updateUserFact` / `deleteUserFact` — память о пользователе

### Vite middleware
- `/api/chat` — SSE stream чата
- `/api/run-code` — выполнить код
- `/api/tasks` — CRUD async задач
- `/api/workspace/:chatId/:filename` — файлы workspace
- `/api/browser?chatId=` — управление браузером
- `/api/settings` — температура
- `/api/transcribe` — распознавание голоса (Whisper)

### Netlify Functions
- `netlify/functions/run-code.mts`
- `netlify/functions/tasks.mts`

## Known Issues
- Python может быть не установлен на Windows; перебирает `python` → `python3`
- Browser sessions не очищаются при закрытии чата

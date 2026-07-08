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

## Completed
- Ползунок температуры (0–2, шаг 0.1) в шапке чата
- Архивация/восстановление/удаление чатов
- Подсветка поиска `<mark>` в сообщениях
- Хоткеи: Ctrl+N/E/L, Ctrl+Shift+C, Escape, ?
- `/api/run-code` — выполнение JS на сервере (node -e), кнопка Run на code-блоках
- Multi-agent SYSTEM_PROMPT (Планируй→Исполняй→Анализируй→Сообщи)
- Асинхронные задачи: task-queue + tasks-api + TaskPanel в сайдбаре
- Воркспейсы: `/api/workspace` (CRUD файлов), saveFile tool, WorkspacePanel
- Computer Use: Playwright browser, `/api/browser` (navigate/screenshot/click/type/scroll), browserAgent tool, BrowserPanel с лайв-скриншотами

## Tools & API Endpoints
- `runCode` — JS на сервере
- `saveFile` — сохранение в workspace
- `browserAgent` — управление браузером (navigate/screenshot/click/type/scroll/getText/close)

### Vite middleware
- `/api/run-code` — выполнить код
- `/api/tasks` — CRUD async задач
- `/api/workspace/:chatId/:filename` — файлы workspace
- `/api/browser?chatId=` — управление браузером
- `/api/settings` — температура

### Netlify Functions
- `netlify/functions/run-code.mts`
- `netlify/functions/tasks.mts`

## Known Issues
- Python run-code не работает на Windows
- browserAgent tool использует chatId="agent" а не реальный chatId
- Browser sessions не очищаются при закрытии чата

# Umnyy Agent — Summary

## Objective
Manus-подобный ИИ-агент: deep research, multi-agent оркестрация, асинхронные задачи, воркспейсы, Computer Use

## Dev
- http://localhost:5173/ (Vite через PM2)
- **Важно**: используй короткий путь `C:\Users\!!!~1\Documents\OPENCO~1\umnyy-agent` вместо длинного с юникодом
- React 19 + TypeScript + Vite + TailwindCSS, бэкенд Vite middleware
- AI: PolzaAI, ключ в `.env`: `POLZAAI_API_KEY`
- Git: `C:\Program Files\Git\bin\git.exe`
- Playwright + Chromium (полный chrome.exe)
- `@ai-sdk/react@4.0.18` + `ai@7.0.17` + `@ai-sdk/openai@4.0.8`

## Completed Features

### Multi-agent оркестрация
- **invokeAgent tool**: оркестратор делегирует подзадачи суб-агентам
- **Параллельные суб-агенты**: вызывай несколько invokeAgent в одном шаге
- **Depth limit**: invokeAgent исключён из инструментов суб-агента (нет рекурсии)
- **Суб-агенты**: 3 раунда, raw PolzaAI API, все инструменты кроме invokeAgent
- **SYSTEM_PROMPT**: правила делегирования + примеры

### Deep Research
- `/api/research`: DuckDuckGo + readUrl + 3 итерации + Markdown-отчёт
- Кнопка Research в шапке чата

### Фоновые задачи
- Backend background agent: ручной raw API, 10 раундов, все инструменты + MCP
- TaskPanel в чате: пульсация, прогресс, «Показать результат»
- Кнопка «В фон» в тулбаре отправляет запрос как фоновую задачу
- Сброс зависших задач при старте сервера
- DELETE задач через `/api/tasks`

### Веб-поиск
- DuckDuckGo HTML scraping (прямой fetch)
- Fallback через Playwright + Bing при капче
- Авто-чтение топ-ссылки после поиска (tryReadUrl)
- Умное извлечение цены (JSON-LD → `$число` < $1M)
- Защита от зацикливания: 3 пустых раунда / 6+ webSearch из 8 последних = стоп

### Vision / Upload
- `/api/upload`: сохранение изображений в `.user-data/uploads/`
- Конвертация file → image для AI vision API
- Раздача `/api/uploads/...`

### Session Memory
- Авто-суммаризация 200 символов после каждого ответа
- 5 последних саммари подшиваются в system prompt

### Auto-facts
- fire-and-forget после onFinish: лёгкая модель → saveUserFact (без дубликатов)

### MCP-серверы
- mcp-manager.ts: StdioClientTransport
- Настройки в mcpServers → UserSettings
- Вкладка «MCP» в админке
- Инструменты с префиксом mcp_<id>_<name>

### Интеграции
- **Telegram**: Bot Token + Chat ID в админке; sendTelegram tool
- **GitHub**: Personal Access Token в админке (вкладка GitHub); deployGithubPages создаёт репо, загружает файлы, включает Pages
- **Email (SMTP)**: Host/Port/User/Pass/From в админке (вкладка Email); sendEmail tool
- **Аудит**: auditResult — HEAD-проверка ссылок, валидация JSON, словарь орфографии
- **База знаний**: synthesizeKnowledge — собирает URL/файлы в Markdown/HTML/Obsidian
- **Экспорт**: exportChat — сохраняет диалог (Markdown/HTML) в workspace
- **OCR**: ocrImage (tesseract.js) — распознаёт текст на изображениях (rus+eng)
- **YouTube**: getYoutubeTranscript — извлекает расшифровку видео
- **Финансы**: getExchangeRates (валюты), getCryptoPrice (криптовалюты)
- **Документы**: markdownToPdf (Playwright), zipWorkspace (archiver), generateQrCode (qrcode)
- **Текст**: compareTexts (diff), batchTranslate (AI), factCheck (веб-поиск)
- **RSS**: subscribeRSS + авто-проверка каждые 30 мин, уведомления в Telegram
- **Cron-задачи**: scheduleTask — промпт по расписанию, результат в Telegram (node-cron)
- **Desktop-нотификации**: showNotification + auto-notify при завершении фоновой задачи (node-notifier)
- **Mind Map**: generateMindMap — интерактивный граф фактов памяти (vis-network)

### UI
- Pin чатов (PinIcon, сортировка по pinned)
- Collapsible длинных ответов (>1000 символов)
- Tool-карточки свёрнуты (defaultOpen={false})
- Delete message (Trash2Icon)
- Retry на user-сообщениях
- Visual Plan Panel (reasoning → чеклист)
- Browser Panel с WebSocket + polling fallback
- Workspace Panel
- Голосовой ввод (Whisper)
- Озвучка ответов (SpeechSynthesis)
- Ползунок температуры
- Архив чатов, подсветка поиска, хоткеи

## Tools
- `getCurrentTime`, `getWeather`, `webSearch`, `calculator`, `generateImage`
- `runCode` — JS (node -e) / Python
- `saveFile` / `downloadFile` — workspace
- `readFile` — PDF/Excel/Word/JSON/TXT/код из workspace
- `browserAgent` — navigate/screenshot/click/type/scroll/getText/close
- `saveUserFact` / `updateUserFact` / `deleteUserFact` — память
- `invokeAgent` — делегирование суб-агенту
- `sendTelegram` — отправка в Telegram (Bot Token + Chat ID в админке)
- `auditResult` — проверка файлов: битые ссылки, JSON, орфография
- `synthesizeKnowledge` — сбор информации из URL/файлов в Markdown/HTML
- `deployGithubPages` — публикация папки workspace на GitHub Pages (нужен GitHub Token)
- `exportChat` — экспорт диалога в Markdown/HTML
- `generateQrCode` — QR-код из URL/текста → PNG
- `zipWorkspace` — ZIP-архив файлов из workspace
- `sendEmail` — отправка email через SMTP (настройка в админке, вкладка Email)
- `getExchangeRates` — курсы валют (open.er-api.com)
- `getCryptoPrice` — цены криптовалют (CoinGecko)
- `getYoutubeTranscript` — расшифровка YouTube-видео
- `ocrImage` — OCR на изображении (tesseract.js, rus+eng)
- `markdownToPdf` — Markdown → PDF (Playwright)
- `compareTexts` — построчный diff двух текстов
- `batchTranslate` — массовый перевод через AI
- `factCheck` — проверка достоверности утверждения через веб-поиск
- `subscribeRSS` / `listRSSFeeds` / `checkRSS` / `unsubscribeRSS` — RSS-подписки
- `scheduleTask` / `listScheduledTasks` / `deleteScheduledTask` — cron-задачи (результат → Telegram)
- `showNotification` — системное toast-уведомление на рабочем столе (node-notifier)
- `generateMindMap` — интерактивный Mind Map граф из фактов памяти (vis-network)
- `pythonInfo` / `installPackage` / `runPython` — Python sandbox (persistent venv, pip install)

### Vite middleware
- `/api/chat` — SSE stream
- `/api/run-code` — выполнить код
- `/api/tasks` — CRUD задач
- `/api/browser?chatId=` — управление браузером
- `/api/settings` — температура, Telegram, GitHub токен, SMTP
- `/api/transcribe` — распознавание голоса
- `/api/upload` — загрузка изображений
- `/api/research` — deep research
- `/api/workspace/:chatId/:filename` — файлы workspace
- `/api/uploads/:chatId/:filename` — загруженные изображения
- `/api/rss-feeds` — CRUD RSS-подписок
- `/api/rss-check?id=` — проверка лент
- `/api/cron-tasks` — CRUD cron-задач

## PM2
- `ecosystem.config.cjs` — скрипт `node_modules/vite/bin/vite.js`
- `pm2 start/restart ecosystem.config.cjs`
- `pm2 save` + ярлык в Startup → `pm2-resurrect.bat` → автозапуск при входе
- Используй `pm2` напрямую (не `node bin\pm2`)

## Known Issues
- Python может быть не установлен на Windows
- Browser sessions не очищаются при закрытии чата
- PowerShell ломается на юникоде — команды по одной

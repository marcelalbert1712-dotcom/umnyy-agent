export type CharacterPreset = {
  id: string;
  name: string;
  description: string;
};

export const DEFAULT_PRESET_ID = "default";

export const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    id: DEFAULT_PRESET_ID,
    name: "Нейтральный",
    description: "Сбалансированный помощник по умолчанию.",
  },
  {
    id: "friendly",
    name: "Дружелюбный",
    description: "Тёплый, поддерживающий, на «ты», с лёгкими эмоциями.",
  },
  {
    id: "coach",
    name: "Коуч",
    description: "Помогает думать, задаёт вопросы, ведёт к цели.",
  },
  {
    id: "expert",
    name: "Эксперт",
    description: "Сухой, точный, как технический консультант.",
  },
  {
    id: "creative",
    name: "Креативный",
    description: "Образный, с метафорами и нестандартным углом.",
  },
  {
    id: "strict",
    name: "Строгий",
    description: "Лаконичный, требует точности, без отступлений.",
  },
];

export type UserFact = {
  id: string;
  text: string;
  category:
    | "personal"
    | "work"
    | "preference"
    | "hobby"
    | "goal"
    | "other";
  createdAt: number;
};

export type UserSettings = {
  preset: string;
  customPrompt: string;
  model: string;
  temperature: number | null;
  updatedAt: number;
};

export const CATEGORY_LABELS: Record<UserFact["category"], string> = {
  personal: "Личное",
  work: "Работа",
  preference: "Предпочтения",
  hobby: "Хобби",
  goal: "Цели",
  other: "Прочее",
};

export type ChatTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  systemPrompt: string;
};

export const CHAT_TEMPLATES: ChatTemplate[] = [
  {
    id: "empty",
    name: "Пустой чат",
    description: "Обычный диалог без начальной инструкции",
    icon: "💬",
    systemPrompt: "",
  },
  {
    id: "translator",
    name: "Переводчик",
    description: "Переводит тексты между языками",
    icon: "🌐",
    systemPrompt: "Ты профессиональный переводчик. Переводи текст точно, сохраняя смысл и стиль оригинала. Если просят без объяснений — давай только перевод.",
  },
  {
    id: "code-reviewer",
    name: "Ревьюер кода",
    description: "Проверяет код на ошибки и стиль",
    icon: "🔍",
    systemPrompt: "Ты опытный ревьюер кода. Анализируй код на баги, уязвимости, стиль и производительность. Предлагай конкретные улучшения.",
  },
  {
    id: "writer",
    name: "Писатель",
    description: "Помогает с текстами и контентом",
    icon: "✍️",
    systemPrompt: "Ты креативный писатель и редактор. Помогай создавать увлекательные тексты: статьи, посты, письма, сценарии. Учитывай tone of voice и целевую аудиторию.",
  },
  {
    id: "teacher",
    name: "Учитель",
    description: "Объясняет сложное простыми словами",
    icon: "📚",
    systemPrompt: "Ты терпеливый учитель. Объясняй сложные концепции простыми словами, с примерами из жизни. Задавай наводящие вопросы, чтобы ученик сам пришёл к ответу.",
  },
  {
    id: "brainstorm",
    name: "Мозговой штурм",
    description: "Генерирует идеи и решения",
    icon: "⚡",
    systemPrompt: "Ты фасилитатор мозгового штурма. Предлагай нестандартные идеи, задавай уточняющие вопросы, комбинируй концепции. Никакой критики на этапе генерации.",
  },
];

export const AVAILABLE_MODELS = [
  { id: "", label: "По умолчанию (gpt-4o-mini)" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "openai/o3-mini", label: "O3 Mini" },
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2" },
  { id: "deepseek/deepseek-r1", label: "DeepSeek R1" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

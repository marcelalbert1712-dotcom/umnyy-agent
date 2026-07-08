import type { FC, SVGProps } from "react";

declare global {
  interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((e: SpeechRecognitionEvent) => void) | null;
    onend: (() => void) | null;
    onerror: ((e: { error: string }) => void) | null;
  }

  interface SpeechRecognitionEvent {
    resultIndex: number;
    results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionResultList {
    length: number;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionResult {
    isFinal: boolean;
    [index: number]: SpeechRecognitionAlternative;
  }

  interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
  }

  var SpeechRecognition: { new(): SpeechRecognition } | undefined;
  var webkitSpeechRecognition: { new(): SpeechRecognition } | undefined;
}

type LucideIcon = FC<SVGProps<SVGSVGElement> & { className?: string; size?: number | string }>;

declare module "lucide-react" {
  export const ArrowDownIcon: LucideIcon;
  export const ArrowLeftIcon: LucideIcon;
  export const ArrowUpIcon: LucideIcon;
  export const BrainIcon: LucideIcon;
  export const CheckCircle2Icon: LucideIcon;
  export const CheckCircleIcon: LucideIcon;
  export const CheckIcon: LucideIcon;
  export const ChevronDownIcon: LucideIcon;
  export const CircleAlertIcon: LucideIcon;
  export const CircleIcon: LucideIcon;
  export const CircleSlashIcon: LucideIcon;
  export const ClockIcon: LucideIcon;
  export const CopyIcon: LucideIcon;
  export const DownloadIcon: LucideIcon;
  export const EraserIcon: LucideIcon;
  export const HistoryIcon: LucideIcon;
  export const FileTextIcon: LucideIcon;
  export const LoaderIcon: LucideIcon;
  export const Maximize2Icon: LucideIcon;
  export const Minimize2Icon: LucideIcon;
  export const MenuIcon: LucideIcon;
  export const MessageSquareIcon: LucideIcon;
  export const MicIcon: LucideIcon;
  export const MicOffIcon: LucideIcon;
  export const MessageSquarePlusIcon: LucideIcon;
  export const PanelLeftCloseIcon: LucideIcon;
  export const PanelLeftIcon: LucideIcon;
  export const PencilIcon: LucideIcon;
  export const PinIcon: LucideIcon;
  export const PinOffIcon: LucideIcon;
  export const PlusIcon: LucideIcon;
  export const RefreshCwIcon: LucideIcon;
  export const SaveIcon: LucideIcon;
  export const SearchIcon: LucideIcon;
  export const SettingsIcon: LucideIcon;
  export const SparklesIcon: LucideIcon;
  export const MoonIcon: LucideIcon;
  export const SquareIcon: LucideIcon;
  export const StarIcon: LucideIcon;
  export const SunIcon: LucideIcon;
  export const Trash2Icon: LucideIcon;
  export const Volume2Icon: LucideIcon;
  export const WrenchIcon: LucideIcon;
  export const XCircleIcon: LucideIcon;
  export const XIcon: LucideIcon;
}

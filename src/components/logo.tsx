import { cn } from "@/lib/utils";

type LogoProps = {
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
  className?: string;
};

const sizes = {
  sm: { letter: "text-lg font-bold", tag: "text-[7px]" },
  md: { letter: "text-2xl font-bold", tag: "text-[9px]" },
  lg: { letter: "text-5xl font-bold", tag: "text-xs" },
};

export function Logo({ size = "md", showTagline = true, className }: LogoProps) {
  const s = sizes[size];
  return (
    <div className={cn("flex flex-col items-center leading-none", className)}>
      <div className="flex items-center gap-0.5 tracking-tight">
        <span
          className={cn(
            s.letter,
            "bg-gradient-to-br from-sky-500 via-cyan-400 to-teal-400 bg-clip-text text-transparent",
          )}
        >
          А
        </span>
        <span className={cn(s.letter, "text-muted-foreground/30")}>.</span>
        <span
          className={cn(
            s.letter,
            "bg-gradient-to-br from-violet-500 via-purple-400 to-pink-400 bg-clip-text text-transparent",
          )}
        >
          М
        </span>
        <span className={cn(s.letter, "text-muted-foreground/30")}>.</span>
      </div>
      {showTagline && (
        <span className={cn(s.tag, "text-muted-foreground/60 tracking-wider")}>
          Архитектор / Architeuth
        </span>
      )}
    </div>
  );
}

"use client";

import { Moon, Sun } from "lucide-react";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@bebest/ui";
import { useTheme } from "@/lib/use-theme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}</TooltipContent>
    </Tooltip>
  );
}

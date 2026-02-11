"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function ThemeToggle() {
  const [theme, setThemeState] = React.useState<"light" | "dark" | "system">("dark")

  React.useEffect(() => {
    // Check for saved theme in localStorage
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | "system" | null
    
    if (savedTheme) {
      setTheme(savedTheme)
    } else {
      // If no saved theme, check if the document has dark class
      const isDarkMode = document.documentElement.classList.contains("dark")
      setThemeState(isDarkMode ? "dark" : "light")
    }
    
    // Add listener for system preference changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      if (theme === "system") {
        setTheme("system")
      }
    }
    
    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [])

  function setTheme(theme: "light" | "dark" | "system") {
    setThemeState(theme)
    localStorage.setItem("theme", theme)
    
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else if (theme === "light") {
      document.documentElement.classList.remove("dark")
    } else if (theme === "system") {
      // If using system preference, check user's system preference
      const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
      if (systemPrefersDark) {
        document.documentElement.classList.add("dark")
      } else {
        document.documentElement.classList.remove("dark")
      }
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="bg-background/50 backdrop-blur-sm">
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
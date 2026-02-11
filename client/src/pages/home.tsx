import { 
  User,
  ChevronsUpDown,
  Calendar,
  Home,
  Inbox,
  Search,
  Settings 
} from "lucide-react"
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarTrigger,
  SidebarRail,
  SidebarInset
} from "@/components/ui/sidebar"
import { BackgroundPaths } from "@/components/ui/background-paths"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { Text_03 } from "@/components/ui/wave-text"

// Menu items
const items = [
  {
    title: "Dashboard",
    url: "#",
    icon: Home,
  },
  {
    title: "Procedures",
    url: "#",
    icon: Inbox,
  },
  {
    title: "Expenses",
    url: "#",
    icon: Calendar,
  },
  {
    title: "Payments",
    url: "#",
    icon: Search,
  },
  {
    title: "Reports",
    url: "#",
    icon: Calendar,
  },
  {
    title: "Settings",
    url: "#",
    icon: Settings,
  },
]

export default function HomePage() {
  return (
    <div className="relative w-full min-h-screen">
      {/* Background component - positioned absolutely to fill the entire screen */}
      <div className="absolute inset-0 -z-10">
        <BackgroundPaths />
      </div>

      <div className="relative z-10">
        <SidebarProvider>
          <Sidebar>
            <SidebarContent>
              <SidebarGroup>
                <div className="flex justify-center mt-6 mb-8">
                  <img src="/Company Logo.png" alt="Company Logo" className="w-full px-4 dark:invert" />
                </div>
                <SidebarGroupContent>
                  <SidebarMenu className="pl-[15%]">
                    {items.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild tooltip={item.title} className="text-[1.1em]">
                          <a href={item.url}>
                            <item.icon />
                            <span>{item.title}</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>

            <SidebarFooter>
              <SidebarGroup>
                <SidebarMenuButton className="w-full justify-between gap-3 h-12">
                  <div className="flex items-center gap-2">
                    <User className="h-5 w-5 rounded-md" />
                    <div className="flex flex-col items-start">
                      <span className="text-sm font-medium">John Doe</span>
                      <span className="text-xs text-muted-foreground">john@example.com</span>
                    </div>
                  </div>
                  <ChevronsUpDown className="h-5 w-5 rounded-md" />
                </SidebarMenuButton>
              </SidebarGroup>
            </SidebarFooter>
          </Sidebar>

          <main className="flex-1 min-w-100vh">
            <div className="px-4 py-2 flex justify-between items-center">
              <SidebarTrigger className="h-4 w-4 mt-2" />
              <Text_03 text="Wave" className="text-[1.35rem] font-medium" />
              <div className="mr-4">
                <ThemeToggle />
              </div>
            </div>
            <div className="p-6">
            </div>
          </main>
        </SidebarProvider>
      </div>
    </div>
  )
}
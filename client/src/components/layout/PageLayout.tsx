import React from 'react';
import { User, ChevronsUpDown, LogOut } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, clearAuthToken } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { BackgroundPaths } from '@/components/ui/background-paths';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Text_03 } from '@/components/ui/wave-text';
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarTrigger,
} from '@/components/ui/sidebar';

type PageLayoutProps = {
  title: string;
  children: React.ReactNode;
  navItems: Array<{
    title: string;
    url: string;
    icon: React.ComponentType<any>;
  }>;
};

export function PageLayout({ title, children, navItems }: PageLayoutProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch current user data
  const { data: currentUser } = useQuery({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/auth/me');
      return await response.json();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', '/api/auth/logout');
    },
    onSuccess: () => {
      // Clear the authentication token
      clearAuthToken();
      
      // Clear all cached queries
      queryClient.clear();
      
      // Redirect to login page
      window.location.href = '/';
      
      toast({
        title: "Logged out",
        description: "You have been successfully logged out.",
      });
    },
    onError: (error) => {
      toast({
        title: "Logout failed",
        description: error.message || "Failed to logout",
        variant: "destructive",
      });
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <div className="relative w-full min-h-screen">
      {/* Background component - fixed position to stay in place when scrolling */}
      <div className="fixed inset-0 -z-10">
        <BackgroundPaths />
      </div>

      <div className="relative z-10">
        <SidebarProvider>
          <Sidebar>
            <SidebarContent>
              <SidebarGroup>
                <div className="flex justify-center mt-6 mb-8">
                  <img
                    src="/Company Logo.png"
                    alt="Company Logo"
                    className="w-full px-4 dark:invert"
                  />
                </div>
                <SidebarGroupContent>
                  <SidebarMenu className="pl-[15%]">
                    {navItems.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          tooltip={item.title}
                          className="text-[1.1em]"
                        >
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
                      <span className="text-sm font-medium">
                        {currentUser?.username || 'Loading...'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {currentUser?.email || 'Loading...'}
                      </span>
                    </div>
                  </div>
                  <ChevronsUpDown className="h-5 w-5 rounded-md" />
                </SidebarMenuButton>
                
                {/* Logout Button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  disabled={logoutMutation.isPending}
                  className="w-full justify-start gap-2 mt-2 text-muted-foreground hover:text-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  {logoutMutation.isPending ? 'Logging out...' : 'Logout'}
                </Button>
              </SidebarGroup>
            </SidebarFooter>
          </Sidebar>

          <main className="flex-1 w-full flex flex-col h-screen overflow-hidden">
            {/* Fixed header - sticky position keeps it at the top */}
            <div className="px-4 py-2 flex justify-between items-center bg-background/80 backdrop-blur-sm sticky top-0 z-20 border-b w-full">
              <SidebarTrigger className="h-4 w-4 mt-2" />
              <Text_03 text={title} className="text-[1.35rem] font-medium" />
              <div className="mr-4">
                <ThemeToggle />
              </div>
            </div>
            
            {/* Scrollable content - main page scrollbar */}
            <div className="flex-1 w-full overflow-y-auto">
              <div className="p-6 w-full">
                {children}
              </div>
            </div>
          </main>
        </SidebarProvider>
      </div>
    </div>
  );
}
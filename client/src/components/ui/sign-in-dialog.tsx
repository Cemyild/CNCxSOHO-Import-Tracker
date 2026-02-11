import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, setAuthToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function SignInDialog() {
  const id = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const response = await apiRequest('POST', '/api/auth/login', { username, password });
      return await response.json();
    },
    onSuccess: (data) => {
      // Store the authentication token
      if (data.token) {
        setAuthToken(data.token);
      }
      
      // Invalidate auth queries to refetch user data
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      
      // Close dialog and redirect
      setIsOpen(false);
      window.location.href = '/dashboard';
      
      toast({
        title: "Success",
        description: "Successfully logged in!",
      });
    },
    onError: (error) => {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid credentials",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username && password) {
      loginMutation.mutate({ username, password });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Sign in</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>
            Enter your credentials to login to your account.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4 py-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor={`${id}-username`}>Username</Label>
            <Input 
              id={`${id}-username`} 
              placeholder="Enter your username" 
              type="text" 
              required 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-password`}>Password</Label>
            <Input
              id={`${id}-password`}
              placeholder="Enter your password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex justify-between gap-2">
            <div className="flex items-center gap-2">
              <Checkbox id={`${id}-remember`} />
              <Label htmlFor={`${id}-remember`} className="font-normal text-muted-foreground">
                Remember me
              </Label>
            </div>
            <a className="text-sm underline hover:no-underline" href="#">
              Forgot password?
            </a>
          </div>
          <Button 
            type="submit" 
            className="w-full border-t pt-4 mt-4"
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, AlertCircle, Loader2, Eye, EyeOff, GraduationCap } from "lucide-react";
import mortysLogo from '@/assets/mortys-logo.png';

export default function StudentInvite() {
  const [, params] = useRoute("/student-invite/:token");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const token = params?.token;

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Validate invite token
  const { data: inviteData, isLoading, error } = useQuery({
    queryKey: [`/api/student-invite/${token}`],
    enabled: !!token,
  });

  const acceptMutation = useMutation({
    mutationFn: (data: { password: string }) =>
      apiRequest('POST', `/api/student-invite/${token}/accept`, data),
    onSuccess: () => {
      toast({
        title: "Welcome to Morty's!",
        description: "Your student account has been activated successfully. You can now log in.",
      });
      setLocation("/student/login");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to activate your account",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast({
        title: "Password Too Short",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Passwords Don't Match",
        description: "Please make sure both passwords match",
        variant: "destructive",
      });
      return;
    }

    acceptMutation.mutate({ password });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-secondary via-gray-900 to-secondary">
        <Card className="w-full max-w-md border-2 border-primary/20 shadow-2xl">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Validating your invitation...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !inviteData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-secondary via-gray-900 to-secondary p-4">
        <Card className="w-full max-w-md border-2 border-red-500/20 shadow-2xl">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <AlertCircle className="h-12 w-12 text-red-500" />
              <h2 className="text-xl font-semibold text-secondary">Invalid Invitation</h2>
              <p className="text-muted-foreground">
                This invitation link is invalid or has expired. Please contact the school for assistance.
              </p>
              <Button 
                onClick={() => setLocation("/")} 
                className="bg-primary hover:bg-primary/90 text-secondary"
                data-testid="button-go-home"
              >
                Go to Homepage
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-secondary via-gray-900 to-secondary p-4">
      <Card className="w-full max-w-2xl border-2 border-primary shadow-2xl shadow-primary/20">
        <CardHeader className="text-center border-b border-gray-200 bg-gradient-to-br from-primary/10 to-white">
          <div className="flex justify-center mb-4">
            <img src={mortysLogo} alt="Morty's Driving School" className="h-20 w-auto" data-testid="img-logo" />
          </div>
          <div className="flex justify-center mb-4">
            <div className="w-20 h-20 bg-gradient-to-br from-primary to-primary/80 rounded-full flex items-center justify-center shadow-lg">
              <GraduationCap className="h-10 w-10 text-secondary" />
            </div>
          </div>
          <CardTitle className="text-3xl text-secondary mb-2">Welcome to Morty's Driving School!</CardTitle>
          <CardDescription className="text-base">
            Hi <span className="font-semibold text-primary">{inviteData.firstName}</span>, let's set up your student account
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-8 px-8 pb-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-primary/5 border-2 border-primary/20 rounded-xl p-6 mb-6">
              <h3 className="font-semibold text-secondary mb-2 flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-primary" />
                Your Account Details
              </h3>
              <div className="space-y-2 text-sm text-gray-700">
                <p><span className="font-medium">Name:</span> {inviteData.firstName} {inviteData.lastName}</p>
                <p><span className="font-medium">Email:</span> {inviteData.email}</p>
                <p><span className="font-medium">Course:</span> <span className="capitalize">{inviteData.courseType}</span></p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-secondary text-lg mb-4">Create Your Password</h3>
              
              <div className="space-y-2">
                <Label htmlFor="password" className="text-secondary">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password (min. 6 characters)"
                    required
                    className="pr-10 border-gray-300 focus:border-primary focus:ring-primary"
                    data-testid="input-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-secondary">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    required
                    className="pr-10 border-gray-300 focus:border-primary focus:ring-primary"
                    data-testid="input-confirm-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    data-testid="button-toggle-confirm-password"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-secondary text-sm mb-2">What happens next?</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>✓ Your account will be activated immediately</li>
                <li>✓ You'll get access to your student dashboard</li>
                <li>✓ View your class schedule and track progress</li>
                <li>✓ Review evaluations from your instructors</li>
              </ul>
            </div>

            <Button
              type="submit"
              disabled={acceptMutation.isPending}
              className="w-full bg-primary hover:bg-primary/90 text-secondary font-semibold py-6 text-lg shadow-lg hover:shadow-primary/30"
              data-testid="button-activate-account"
            >
              {acceptMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Activating Your Account...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-5 w-5" />
                  Activate My Account
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

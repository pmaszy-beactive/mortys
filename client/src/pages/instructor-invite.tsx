import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, AlertCircle, Loader2, Eye, EyeOff } from "lucide-react";

export default function InstructorInvite() {
  const [, params] = useRoute("/instructor-invite/:token");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const token = params?.token;

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Validate invite token
  const { data: inviteData, isLoading, error } = useQuery({
    queryKey: [`/api/instructor-invite/${token}`],
    enabled: !!token,
  });

  const acceptMutation = useMutation({
    mutationFn: (data: { password: string; termsAccepted: boolean }) =>
      apiRequest('POST', `/api/instructor-invite/${token}/accept`, data),
    onSuccess: () => {
      toast({
        title: "Welcome!",
        description: "Your account has been activated successfully",
      });
      setLocation("/instructor");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to accept invitation",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      toast({
        title: "Invalid Password",
        description: "Password must be at least 8 characters",
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

    if (!termsAccepted) {
      toast({
        title: "Terms Required",
        description: "You must accept the terms and conditions",
        variant: "destructive",
      });
      return;
    }

    acceptMutation.mutate({ password, termsAccepted });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Validating invitation...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !inviteData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <AlertCircle className="h-12 w-12 text-red-500" />
              <h2 className="text-xl font-semibold">Invalid Invitation</h2>
              <p className="text-muted-foreground">
                {error?.message || "This invitation link is invalid or has expired."}
              </p>
              <Button onClick={() => setLocation("/instructor/login")} variant="outline">
                Go to Login
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          <CardTitle className="text-2xl">Welcome to Morty's Driving School!</CardTitle>
          <CardDescription>
            Hi {inviteData.firstName}, complete your account setup to get started
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-2">
              <h3 className="font-semibold">Your Information</h3>
              <p className="text-sm text-muted-foreground">
                <strong>Name:</strong> {inviteData.firstName} {inviteData.lastName}
              </p>
              <p className="text-sm text-muted-foreground">
                <strong>Email:</strong> {inviteData.email}
              </p>
              {inviteData.phone && (
                <p className="text-sm text-muted-foreground">
                  <strong>Phone:</strong> {inviteData.phone}
                </p>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Create Your Password</h3>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Confirm Password</label>
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    required
                    data-testid="input-confirm-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {password && password.length > 0 && password.length < 8 && (
                <p className="text-sm text-red-500">Password must be at least 8 characters</p>
              )}
              {password && confirmPassword && password !== confirmPassword && (
                <p className="text-sm text-red-500">Passwords do not match</p>
              )}
            </div>

            <div className="border-t pt-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="terms"
                  checked={termsAccepted}
                  onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                  data-testid="checkbox-terms"
                />
                <label
                  htmlFor="terms"
                  className="text-sm text-muted-foreground leading-relaxed cursor-pointer"
                >
                  I agree to the terms and conditions of employment at Morty's Driving School,
                  including adherence to all safety protocols, professional conduct guidelines,
                  and student privacy regulations.
                </label>
              </div>
            </div>

            <div className="flex gap-4">
              <Button
                type="submit"
                className="flex-1"
                disabled={acceptMutation.isPending}
                data-testid="button-accept-invite"
              >
                {acceptMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting up account...
                  </>
                ) : (
                  "Complete Setup & Login"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

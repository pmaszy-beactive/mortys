import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, GraduationCap, AlertCircle, Home, Mail, Lock, Eye, EyeOff, CheckCircle, Clock, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const signupSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SignupFormData = z.infer<typeof signupSchema>;

type FlowStep = "signup" | "verify" | "redirect";

export default function StudentSignup() {
  const [step, setStep] = useState<FlowStep>("signup");
  const [registrationId, setRegistrationId] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Calculate remaining seconds from expiresAt
  const calculateSecondsRemaining = useCallback(() => {
    if (!expiresAt) return 0;
    const diff = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  }, [expiresAt]);

  // Countdown timer effect
  useEffect(() => {
    if (step !== "verify" || !expiresAt) return;

    // Initial calculation
    setSecondsRemaining(calculateSecondsRemaining());

    // Update every second
    const interval = setInterval(() => {
      const remaining = calculateSecondsRemaining();
      setSecondsRemaining(remaining);
      
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [step, expiresAt, calculateSecondsRemaining]);

  const isCodeExpired = secondsRemaining <= 0 && expiresAt !== null;
  
  // Format seconds as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      return await apiRequest("POST", "/api/student/register", data);
    },
    onSuccess: (response) => {
      setRegistrationId(response.registrationId);
      setEmail(form.getValues("email"));
      
      if (response.step === "verify") {
        // Set expiration time from server response
        if (response.expiresAt) {
          setExpiresAt(new Date(response.expiresAt));
        }
        setVerificationCode(""); // Clear any old code
        setStep("verify");
        toast({
          title: "Check your email",
          description: "We've sent a verification code to your email address. It expires in 2 minutes.",
        });
      } else if (response.step === "onboarding") {
        setLocation(`/student/onboarding/${response.registrationId}`);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Registration failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (data: { registrationId: number; code: string }) => {
      return await apiRequest("POST", "/api/student/verify-email", data);
    },
    onSuccess: () => {
      setStep("redirect");
      toast({
        title: "Email verified!",
        description: "Let's complete your profile.",
      });
      setTimeout(() => {
        setLocation(`/student/onboarding/${registrationId}`);
      }, 1500);
    },
    onError: (error: any) => {
      toast({
        title: "Verification failed",
        description: error.message || "Invalid code. Please try again.",
        variant: "destructive",
      });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/student/resend-verification", { registrationId });
    },
    onSuccess: (response) => {
      // Update expiration time with new code
      if (response.expiresAt) {
        setExpiresAt(new Date(response.expiresAt));
      }
      setVerificationCode(""); // Clear old code
      toast({
        title: "New code sent!",
        description: "Check your email for the new verification code. It expires in 2 minutes.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to resend",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: SignupFormData) => {
    registerMutation.mutate({ email: data.email, password: data.password });
  };

  const handleVerify = () => {
    if (registrationId && verificationCode.length === 6) {
      verifyMutation.mutate({ registrationId, code: verificationCode });
    }
  };

  if (step === "redirect") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4">
        <Card className="w-full max-w-md backdrop-blur-lg bg-white/95 shadow-2xl border-0">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="mx-auto h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-[#111111] mb-2">Email Verified!</h2>
            <p className="text-gray-600 mb-4">Redirecting to complete your profile...</p>
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-[#ECC462]" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse delay-700"></div>
        </div>

        <div className="w-full max-w-md space-y-8 relative z-10">
          <div className="text-center">
            <div className="mx-auto h-20 w-20 bg-[#ECC462] rounded-2xl shadow-2xl flex items-center justify-center mb-6">
              <Mail className="h-10 w-10 text-[#111111]" />
            </div>
            <h2 className="text-3xl font-bold text-[#111111] mb-2">Verify Your Email</h2>
            <p className="text-amber-900">
              We sent a 6-digit code to <strong>{email}</strong>
            </p>
          </div>

          <Card className="backdrop-blur-lg bg-white/95 shadow-2xl border-0 overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#ECC462] via-amber-400 to-[#ECC462]"></div>
            
            <CardContent className="pt-8 pb-8">
              <div className="flex flex-col items-center space-y-6">
                {/* Countdown Timer Display */}
                {expiresAt && (
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${
                    isCodeExpired 
                      ? 'bg-red-100 text-red-700' 
                      : secondsRemaining <= 30 
                        ? 'bg-amber-100 text-amber-700' 
                        : 'bg-green-100 text-green-700'
                  }`}>
                    <Clock className="h-4 w-4" />
                    {isCodeExpired ? (
                      <span className="font-medium">Code expired</span>
                    ) : (
                      <span className="font-medium">
                        Time remaining: {formatTime(secondsRemaining)}
                      </span>
                    )}
                  </div>
                )}

                {/* Expired State Alert */}
                {isCodeExpired && (
                  <Alert variant="destructive" className="border-red-200 bg-red-50">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Your verification code has expired. Please request a new one.
                    </AlertDescription>
                  </Alert>
                )}

                <InputOTP
                  maxLength={6}
                  value={verificationCode}
                  onChange={(value) => setVerificationCode(value)}
                  disabled={isCodeExpired}
                  data-testid="input-verification-code"
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>

                {/* Verify Button - disabled when expired */}
                {!isCodeExpired ? (
                  <Button
                    onClick={handleVerify}
                    className="w-full bg-[#ECC462] hover:bg-[#d4b058] text-[#111111] font-semibold h-12"
                    disabled={verificationCode.length !== 6 || verifyMutation.isPending}
                    data-testid="button-verify"
                  >
                    {verifyMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Verify Email"
                    )}
                  </Button>
                ) : (
                  /* Prominent Resend Button when expired */
                  <Button
                    onClick={() => resendMutation.mutate()}
                    disabled={resendMutation.isPending}
                    className="w-full bg-[#ECC462] hover:bg-[#d4b058] text-[#111111] font-semibold h-12"
                    data-testid="button-resend-expired"
                  >
                    {resendMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending new code...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Send New Code
                      </>
                    )}
                  </Button>
                )}

                {/* Regular resend link (when not expired) */}
                {!isCodeExpired && (
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mb-2">Didn't receive the code?</p>
                    <Button
                      variant="ghost"
                      onClick={() => resendMutation.mutate()}
                      disabled={resendMutation.isPending}
                      className="text-[#ECC462] hover:text-[#d4b058]"
                      data-testid="button-resend"
                    >
                      {resendMutation.isPending ? "Sending..." : "Resend Code"}
                    </Button>
                  </div>
                )}

                <Button
                  variant="ghost"
                  onClick={() => setStep("signup")}
                  className="text-gray-500"
                  data-testid="button-back-to-signup"
                >
                  Use a different email
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#ECC462]/10 rounded-full blur-3xl animate-pulse delay-700"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#111111]/5 rounded-full blur-3xl"></div>
      </div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center">
          <div className="mx-auto h-20 w-20 bg-[#ECC462] rounded-2xl shadow-2xl flex items-center justify-center mb-6 transform hover:scale-105 transition-transform duration-300">
            <GraduationCap className="h-10 w-10 text-[#111111]" />
          </div>
          <h2 className="text-4xl font-bold text-[#111111] mb-2 drop-shadow-lg">
            Create Account
          </h2>
          <p className="text-amber-900 text-lg mb-4">
            Join Morty's Driving School
          </p>
          <Link href="/">
            <Button 
              variant="ghost" 
              className="text-amber-900 hover:text-[#111111] hover:bg-[#ECC462]/20"
              data-testid="link-home"
            >
              <Home className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>

        <Card className="backdrop-blur-lg bg-white/95 shadow-2xl border-0 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#ECC462] via-amber-400 to-[#ECC462]"></div>
          
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl text-center text-[#111111]">Sign Up</CardTitle>
            <CardDescription className="text-center">
              Start your driving journey today
            </CardDescription>
          </CardHeader>
          
          <CardContent className="pb-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#111111] font-medium">Email</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                          <Input 
                            {...field} 
                            type="email"
                            placeholder="you@example.com" 
                            className="pl-10 h-12 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                            data-testid="input-email"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#111111] font-medium">Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                          <Input 
                            {...field} 
                            type={showPassword ? "text" : "password"}
                            placeholder="At least 8 characters" 
                            className="pl-10 pr-10 h-12 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                            data-testid="input-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#111111] font-medium">Confirm Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                          <Input 
                            {...field} 
                            type={showConfirmPassword ? "text" : "password"}
                            placeholder="Confirm your password" 
                            className="pl-10 pr-10 h-12 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                            data-testid="input-confirm-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button 
                  type="submit" 
                  className="w-full bg-[#ECC462] hover:bg-[#d4b058] text-[#111111] font-semibold h-12 text-lg shadow-lg hover:shadow-xl transition-all duration-300"
                  disabled={registerMutation.isPending}
                  data-testid="button-signup"
                >
                  {registerMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Creating Account...
                    </>
                  ) : (
                    "Create Account"
                  )}
                </Button>

                <div className="text-center pt-4 border-t border-gray-100">
                  <p className="text-gray-600">
                    Already have an account?{" "}
                    <Link href="/student/login">
                      <span className="text-[#ECC462] hover:text-[#d4b058] font-semibold cursor-pointer" data-testid="link-login">
                        Log in
                      </span>
                    </Link>
                  </p>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-amber-900/70">
          By signing up, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}
